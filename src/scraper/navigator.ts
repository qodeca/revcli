import type { Page, Dialog } from "playwright";
import type { ParsedUrl } from "../utils/url.js";
import {
  extractPlaceIdFromUrl,
  placeIdsMatch,
  canVerifyPlaceIdFormat,
} from "../utils/url.js";
import type { Business, SortOrder } from "../core/schema.js";
import { logger } from "../utils/logger.js";
import { UnrecoverableError } from "../core/errors.js";
import { SELECTORS } from "./selectors.js";
import { clearVolatileBrowserState } from "./browser.js";
import { handleConsent, ensureEnglishLocale, appendHlParam } from "./consent.js";
import { extractBusinessInfo } from "./business-extractor.js";
import { hasLimitedView } from "./auth.js";

const SORT_OPTIONS: Record<SortOrder, number> = {
  relevant: 0,
  newest: 1,
  highest: 2,
  lowest: 3,
};

const GOOGLE_MAPS_ORIGIN = "https://www.google.com";

async function acceptDialog(dialog: Dialog): Promise<void> {
  await dialog.accept();
}

export async function navigateToReviews(
  page: Page,
  parsed: ParsedUrl,
  sortOrder: SortOrder,
): Promise<Omit<Business, "scrapeDate" | "headerTotalReviews">> {
  // Use `off` then `on` so re-entering this function (e.g., after auth retry
  // in scrape-location.ts) does not stack multiple listeners on the same page.
  page.off("dialog", acceptDialog);
  page.on("dialog", acceptDialog);

  // Prepare URL with hl=en to avoid double navigation
  const targetUrl = appendHlParam(parsed.url);

  // Evict stale Google Maps SPA state (service workers, cache, IndexedDB,
  // localStorage) before navigating. Without this, sequential scrapes can
  // replay a previously-loaded location. Cookies are preserved so auth stays
  // intact. See issue #4.
  await clearVolatileBrowserState(page, GOOGLE_MAPS_ORIGIN);

  const waitUntil = parsed.isShortUrl ? "networkidle" : "domcontentloaded";
  logger.debug(`Navigating to ${targetUrl}`);
  await page.goto(targetUrl, { waitUntil, timeout: 30000 });

  // Handle Google consent page
  await handleConsent(page);

  // Force English locale if consent redirect stripped hl=en
  await ensureEnglishLocale(page);

  // Wait for the place panel to load
  await page.waitForSelector("h1", { timeout: 15000 });

  // Extract placeId from the resolved URL (useful for short URLs)
  const resolvedUrl = page.url();
  const placeIdFromUrl = extractPlaceIdFromUrl(resolvedUrl);

  // Verify the loaded page corresponds to the requested location. If Google
  // Maps served a cached SPA shell for a previous place (despite the state
  // eviction above), the resolved URL will point at a different placeId.
  // Skipped for:
  //   - Short URLs (parsed.placeId === null before redirect resolves)
  //   - CID URLs (parsed.placeId === null; CID has no !1s/ftid embedding)
  //   - ChIJ Place ID strings (different format space than !1s/ftid)
  // canVerifyPlaceIdFormat narrows this to the 0x... format that
  // extractPlaceIdFromUrl actually produces.
  if (canVerifyPlaceIdFormat(parsed.placeId)) {
    if (!placeIdsMatch(parsed.placeId, placeIdFromUrl)) {
      throw new UnrecoverableError(
        "NAV_VERIFY",
        `Navigation verification failed: expected placeId "${parsed.placeId}" but loaded page resolves to "${placeIdFromUrl ?? "unknown"}" (resolved URL: ${resolvedUrl})`,
      );
    }
    logger.debug(`Navigation verified: placeId=${parsed.placeId}`);
  } else {
    // No upfront placeId to verify against – log the resolved placeId so the
    // operator can audit it post-hoc. Downstream `extractBusinessInfo` uses
    // the resolved placeId so the output carries authoritative identity.
    logger.debug(
      `Skipping placeId verification (no verifiable upfront placeId). Resolved placeId: ${placeIdFromUrl ?? "unknown"}`,
    );
  }

  const businessInfo = await extractBusinessInfo(page, {
    ...parsed,
    placeId: parsed.placeId ?? placeIdFromUrl,
    url: resolvedUrl,
  });

  await openReviewsTab(page);

  if (sortOrder !== "relevant") {
    await setSortOrder(page, sortOrder);
  }

  return businessInfo;
}

async function openReviewsTab(page: Page): Promise<void> {
  await page.waitForSelector(SELECTORS.tab, { timeout: 10000 });
  await page.waitForTimeout(1000);

  // Check for limited view before attempting to find Reviews tab
  if (await hasLimitedView(page)) {
    logger.warn("Limited view detected – Reviews tab is hidden");
    return;
  }

  // Content-based tab detection – find the tab containing "Review" text
  const tabs = page.locator(SELECTORS.tab);
  const tabCount = await tabs.count();
  let clicked = false;

  for (let i = 0; i < tabCount; i++) {
    const text = (await tabs.nth(i).textContent()) ?? "";
    if (/review/i.test(text)) {
      logger.debug(`Clicking tab: "${text.trim()}"`);
      await tabs.nth(i).click();
      clicked = true;
      break;
    }
  }

  if (!clicked) {
    // Fallback for non-English locale remnants
    const reviewsTab = page.locator(
      'button:has-text("Reviews"), button:has-text("Opinie"), button:has-text("Bewertungen")',
    );
    try {
      await reviewsTab.first().click({ timeout: 5000 });
    } catch {
      logger.warn(
        "Could not find Reviews tab – reviews may already be visible",
      );
    }
  }

  await page.waitForSelector(SELECTORS.reviewCard, { timeout: 15000 });
  await page.waitForTimeout(1000);
  logger.debug("Reviews panel loaded");
}

const SORT_VERIFY_TEXT: Record<SortOrder, string> = {
  newest: "newest",
  highest: "highest",
  lowest: "lowest",
  relevant: "relevant",
};

export async function setSortOrder(page: Page, sortOrder: SortOrder): Promise<void> {
  const sortIndex = SORT_OPTIONS[sortOrder];
  if (sortIndex === undefined) {
    logger.warn(`Unknown sort order "${sortOrder}", using default`);
    return;
  }

  const sortButton = page.locator(SELECTORS.sortButton);
  await sortButton.first().click({ timeout: 5000 });

  await page.waitForSelector(SELECTORS.sortMenuItem, { timeout: 3000 });

  const menuItems = page.locator(SELECTORS.sortMenuItem);
  const count = await menuItems.count();
  if (sortIndex >= count) {
    throw new Error(
      `Sort verification failed: sort menu has ${count} items but "${sortOrder}" requires index ${sortIndex}`,
    );
  }
  await menuItems.nth(sortIndex).click();

  // Wait for the sort menu to close
  await page.waitForSelector(SELECTORS.sortMenuItem, { state: "hidden", timeout: 3000 }).catch(() => {});

  const expectedKeyword = SORT_VERIFY_TEXT[sortOrder];

  // Google Maps announces sort changes via an ARIA live region
  // e.g., "The reviews are now sorted from newest to oldest."
  try {
    await page.waitForFunction(
      ({ sel, keyword }) => {
        const liveRegion = document.querySelector(sel);
        if (!liveRegion) return false;
        return (liveRegion.textContent ?? "").trim().toLowerCase().includes(keyword);
      },
      { sel: SELECTORS.sortLiveRegion, keyword: expectedKeyword },
      { timeout: 5000 },
    );
  } catch {
    // Matched by isUnrecoverable() in retry.ts
    throw new Error(
      `Sort verification failed: expected "${sortOrder}" but no ARIA announcement found containing "${expectedKeyword}"`,
    );
  }

  // Wait for reviews to reload after sort change
  await page.waitForSelector(SELECTORS.reviewCard, { timeout: 10000 });
  await page.waitForTimeout(1000);

  logger.debug(`Sort order verified: ${sortOrder}`);
}
