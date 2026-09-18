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

// Named timeout literals so the wait strategy is auditable in one place.
const PAGE_LOAD_TIMEOUT_MS = 30000;
const REVIEW_PANEL_TIMEOUT_MS = 15000;
const SHORT_SETTLE_MS = 1000;
const SCROLL_SETTLE_MS = 1500;
const SORT_CLICK_TIMEOUT_MS = 5000;
const SORT_MENU_TIMEOUT_MS = 3000;
const SORT_ANNOUNCE_TIMEOUT_MS = 5000;

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

  // Google Maps' SPA keeps polling, so `networkidle` is never reached and a
  // short URL (redirected via HTTP 3xx) times out after 30s. `domcontentloaded`
  // resolves once the redirect target's DOM is loaded; the `waitForSelector`
  // below confirms the place panel is actually present.
  const waitUntil = "domcontentloaded";
  logger.debug(`Navigating to ${targetUrl}`);
  await page.goto(targetUrl, { waitUntil, timeout: PAGE_LOAD_TIMEOUT_MS });

  // Handle Google consent page
  await handleConsent(page);

  // Force English locale if consent redirect stripped hl=en
  await ensureEnglishLocale(page);

  // Wait for the place panel to load
  await page.waitForSelector("h1", { timeout: REVIEW_PANEL_TIMEOUT_MS });

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

/**
 * Google Maps virtualizes the review list: after the Reviews tab is clicked it
 * renders only the summary and filter chips and defers the first batch of
 * review cards until a real mouse-wheel scroll fires on the scroll container.
 * Nudge the container once so `reviewCard` nodes exist before we wait on them,
 * otherwise openReviewsTab blocks until its 15s waitForSelector times out.
 */
async function scrollReviewsIntoView(page: Page): Promise<void> {
  const containerSel = await page.evaluate((candidates) => {
    for (const sel of candidates) {
      const el = document.querySelector(sel);
      if (el && el.scrollHeight > el.clientHeight) return sel;
    }
    return null;
  }, SELECTORS.scrollContainers);

  if (!containerSel) return;

  const box = await page.locator(containerSel).first().boundingBox();
  if (!box) return;

  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.wheel(0, 800);
  await page.waitForTimeout(SCROLL_SETTLE_MS);
}

async function openReviewsTab(page: Page): Promise<void> {
  await page.waitForSelector(SELECTORS.tab, { timeout: 10000 });
  await page.waitForTimeout(SHORT_SETTLE_MS);

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
    // Fallback for non-English locale remnants. Scope to `[role="tab"]` so the
    // `:has-text` substring cannot match review-card text or reviewer names.
    const reviewsTab = page.locator(SELECTORS.tab).filter({
      hasText: /review|opinie|bewertungen/i,
    });
    try {
      await reviewsTab.first().click({ timeout: 5000 });
    } catch {
      logger.warn(
        "Could not find Reviews tab – reviews may already be visible",
      );
    }
  }

  // The review list is virtualized – the first batch of cards only renders
  // after a real scroll event, so nudge the container before waiting.
  await scrollReviewsIntoView(page);

  await page.waitForSelector(SELECTORS.reviewCard, { timeout: REVIEW_PANEL_TIMEOUT_MS });
  await page.waitForTimeout(SHORT_SETTLE_MS);
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
  await sortButton.first().click({ timeout: SORT_CLICK_TIMEOUT_MS });

  await page.waitForSelector(SELECTORS.sortMenuItem, { timeout: SORT_MENU_TIMEOUT_MS });

  const menuItems = page.locator(SELECTORS.sortMenuItem);
  const count = await menuItems.count();
  if (sortIndex >= count) {
    throw new UnrecoverableError(
      "SORT_VERIFY",
      `Sort verification failed: sort menu has ${count} items but "${sortOrder}" requires index ${sortIndex}`,
    );
  }
  await menuItems.nth(sortIndex).click();

  // Wait for the sort menu to close
  await page.waitForSelector(SELECTORS.sortMenuItem, { state: "hidden", timeout: SORT_MENU_TIMEOUT_MS }).catch(() => {});

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
      { timeout: SORT_ANNOUNCE_TIMEOUT_MS },
    );
  } catch {
    // Thrown as a typed UnrecoverableError so withRetry does not mask it.
    throw new UnrecoverableError(
      "SORT_VERIFY",
      `Sort verification failed: expected "${sortOrder}" but no ARIA announcement found containing "${expectedKeyword}"`,
    );
  }

  // Wait for reviews to reload after sort change
  await page.waitForSelector(SELECTORS.reviewCard, { timeout: 10000 });
  await page.waitForTimeout(SHORT_SETTLE_MS);

  logger.debug(`Sort order verified: ${sortOrder}`);
}
