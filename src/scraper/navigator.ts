import type { Page, Dialog } from "playwright";
import type { ParsedUrl } from "../utils/url.js";
import {
  extractPlaceIdFromUrl,
  placeIdsMatch,
  canVerifyPlaceIdFormat,
  isSearchResultsUrl,
  isShortLinkUrl,
  SHORT_LINK_HOST,
} from "../utils/url.js";
import type { Business, SortOrder } from "../core/schema.js";
import { logger } from "../utils/logger.js";
import { UnrecoverableError } from "../core/errors.js";
import { SELECTORS } from "./selectors.js";
import { clearVolatileBrowserState } from "./browser.js";
import { handleConsent, ensureEnglishLocale, appendHlParam } from "./consent.js";
import { extractBusinessInfo } from "./business-extractor.js";
import { authRequiredError, hasLimitedView } from "./auth.js";

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
/** Extra wait for the sort menu once the sign-in dialog showed up first. */
const SORT_MENU_GRACE_MS = 500;
const SORT_ANNOUNCE_TIMEOUT_MS = 5000;
const TAB_TIMEOUT_MS = 10000;

/**
 * Message M3. Deliberately does not echo the URL: batch already prints it next
 * to each failure, and for Place ID input the built URL would be misleading.
 */
export const NOT_A_PLACE_MESSAGE =
  "This link opened a Google Maps search results page, not a single place. Open the place in Google Maps, copy its link (Share → Copy link) and run the command again.";

async function acceptDialog(dialog: Dialog): Promise<void> {
  await dialog.accept();
}

/**
 * Called when the place panel (h1 or tabs) did not appear in time. A search
 * results URL means the link is not a place: fail once with M3. Anything else
 * is rethrown unchanged so real network flakiness is still retried.
 */
function notAPlaceOr(err: unknown, page: Page): never {
  if (isSearchResultsUrl(page.url())) {
    throw new UnrecoverableError("NOT_A_PLACE", NOT_A_PLACE_MESSAGE);
  }
  throw err;
}

/** Throw AUTH_REQUIRED when Google shows the limited-view banner. */
async function throwIfLimitedView(page: Page): Promise<void> {
  if (await hasLimitedView(page)) {
    logger.debug("Limited view banner detected");
    throw authRequiredError();
  }
}

/**
 * Wait until a short link (maps.app.goo.gl) has redirected to its destination.
 * Google redirects these links in page script, not with an HTTP 3xx, so the
 * `domcontentloaded` of `page.goto` can fire on the short-link page itself.
 * A timeout is left to the place-panel wait below, which reports it.
 */
async function waitForShortLinkRedirect(page: Page): Promise<void> {
  if (!isShortLinkUrl(page.url())) return;
  await page
    .waitForURL((url) => url.hostname !== SHORT_LINK_HOST, {
      waitUntil: "domcontentloaded",
      timeout: PAGE_LOAD_TIMEOUT_MS,
    })
    .catch(() => {
      logger.debug("Short link did not redirect in time");
    });
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

  // Google Maps' SPA keeps polling, so `networkidle` is never reached.
  // `domcontentloaded` can fire before a short link's script redirect;
  // `waitForShortLinkRedirect` below handles that, and the `waitForSelector`
  // further down confirms the place panel is actually present.
  const waitUntil = "domcontentloaded";
  logger.debug(`Navigating to ${targetUrl}`);
  await page.goto(targetUrl, { waitUntil, timeout: PAGE_LOAD_TIMEOUT_MS });

  // A short link redirects in page script, so `goto` can resolve while the
  // page is still on maps.app.goo.gl. Wait for the real destination first:
  // forcing hl=en on the short link itself is lost in the redirect.
  await waitForShortLinkRedirect(page);

  // Handle Google consent page
  await handleConsent(page);

  // Force English locale if consent redirect stripped hl=en
  // The destination of a short link still carries entry/g_ep (they could not
  // be stripped before the load), so strip them here in that case only. The
  // flag follows the input, not the redirect timing, so a slow redirect that
  // lands later is still covered.
  await ensureEnglishLocale(page, { stripLimitedViewParams: parsed.isShortUrl });

  // Wait for the place panel to load. Search results pages have no h1.
  try {
    await page.waitForSelector("h1", { timeout: REVIEW_PANEL_TIMEOUT_MS });
  } catch (err) {
    notAPlaceOr(err, page);
  }

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

/**
 * Open the Reviews tab and wait for the first review cards. Throws
 * AUTH_REQUIRED when the limited-view banner is shown – checked once after the
 * tabs appear and again after the cards appear, because the banner can render
 * late (and with sort "relevant" there is no Sort click to catch it).
 */
async function openReviewsTab(page: Page): Promise<void> {
  try {
    await page.waitForSelector(SELECTORS.tab, { timeout: TAB_TIMEOUT_MS });
  } catch (err) {
    notAPlaceOr(err, page);
  }
  await page.waitForTimeout(SHORT_SETTLE_MS);

  await throwIfLimitedView(page);

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

  await throwIfLimitedView(page);
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

  // In a limited view Sort opens a sign-in dialog instead of the menu. Wait for
  // whichever becomes visible first (visible-filtered, so a hidden template
  // item earlier in the DOM cannot stall the wait). A visible menu always
  // wins: AUTH_REQUIRED only when the dialog is shown and no menu item is,
  // even after a short grace for a menu that renders after the dialog.
  const signInDialog = page.locator(SELECTORS.signInDialog);
  const menuItems = page.locator(SELECTORS.sortMenuItem).filter({ visible: true });
  await page
    .locator(SELECTORS.sortMenuItem)
    .or(signInDialog)
    .filter({ visible: true })
    .first()
    .waitFor({ state: "visible", timeout: SORT_MENU_TIMEOUT_MS });
  if ((await menuItems.count()) === 0) {
    const menuAppeared = await menuItems
      .first()
      .waitFor({ state: "visible", timeout: SORT_MENU_GRACE_MS })
      .then(
        () => true,
        () => false,
      );
    if (!menuAppeared && (await signInDialog.filter({ visible: true }).count()) > 0) {
      logger.debug("Sort opened the sign-in dialog (limited view)");
      throw authRequiredError();
    }
  }

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
