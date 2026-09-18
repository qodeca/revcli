import type { Page } from "playwright";
import type { Review } from "../core/schema.js";
import {
  captureOriginalTexts,
  enrichReviews,
  expandAllReviews,
  extractReviews,
  restoreTranslations,
  type RawReview,
} from "./extractor.js";
import { parseReview } from "./parser.js";
import { logger } from "../utils/logger.js";
import { SELECTORS } from "./selectors.js";

const MAX_STALE_SCROLLS = 6;
const MAX_SPINNER_WITHOUT_PROGRESS = 3;
// Named magic numbers for the scroll-collect loop so the wait/scroll strategy
// is auditable in one place (C6).
const DEFAULT_DELAY_MS = 3000;
const DOM_SETTLE_MS = 500;
const LOADING_CHECK_TIMEOUT_MS = 100;
const LOADING_WAIT_TIMEOUT_MS = 5000;
const SCROLL_DISTANCE = 800;
const SCROLL_STEP = 1000;

/** Progress counters threaded through the scroll-collect state machine. */
interface CycleState {
  staleScrollCount: number;
  spinnerWithoutProgressCount: number;
}

export interface ScrollOptions {
  maxReviews?: number;
  delayMs: number;
}

/**
 * Calculate delay for a stale scroll using exponential backoff.
 * Formula: baseDelay * 2^max(0, staleCount - 1), capped at baseDelay * maxMultiplier
 */
export function calculateStaleDelay(
  staleScrollCount: number,
  baseDelay: number,
  maxMultiplier: number = 4,
): number {
  const multiplier = Math.pow(2, Math.max(0, staleScrollCount - 1));
  return Math.min(baseDelay * multiplier, baseDelay * maxMultiplier);
}

/**
 * Determine if scrolling should continue based on stale scroll count.
 */
export function shouldContinueScrolling(
  staleScrollCount: number,
  maxStaleScrolls: number = MAX_STALE_SCROLLS,
): boolean {
  return staleScrollCount < maxStaleScrolls;
}

/**
 * Check if a loading indicator is visible in the reviews panel.
 * Best-effort check – if selector doesn't match, returns false (graceful degradation).
 */
async function isLoadingVisible(page: Page): Promise<boolean> {
  try {
    return await page
      .locator(SELECTORS.loadingIndicator)
      .first()
      .isVisible({ timeout: LOADING_CHECK_TIMEOUT_MS });
  } catch {
    return false;
  }
}

/**
 * Wait for the loading indicator to disappear.
 * Gracefully degrades if the selector doesn't match or times out.
 */
async function waitForLoadingComplete(
  page: Page,
  timeout: number = LOADING_WAIT_TIMEOUT_MS,
): Promise<void> {
  try {
    await page
      .locator(SELECTORS.loadingIndicator)
      .first()
      .waitFor({ state: "hidden", timeout });
  } catch {
    // Timeout or selector not found – graceful degradation, continue
  }
}

/**
 * Scroll the reviews panel and collect reviews incrementally.
 * Uses deduplication to avoid collecting the same review twice.
 */
export async function scrollAndCollectReviews(
  page: Page,
  options: ScrollOptions,
): Promise<Review[]> {
  const collectedIds = new Set<string>();
  const reviews: Review[] = [];

  const scrollContainer = await findScrollContainer(page);
  if (!scrollContainer) {
    logger.warn("Could not find reviews scroll container");
    return reviews;
  }

  logger.info("Scrolling to collect reviews...");
  await collectFromCurrentSort(
    page,
    scrollContainer,
    collectedIds,
    reviews,
    options,
  );
  return reviews;
}

/**
 * Extract, parse, deduplicate, and collect new reviews from raw DOM data.
 * Returns the count of newly collected reviews, or -1 if maxReviews was reached.
 */
function collectNewReviews(
  rawReviews: RawReview[],
  collectedIds: Set<string>,
  reviews: Review[],
  maxReviews?: number,
): number {
  let newCount = 0;
  for (const raw of rawReviews) {
    const parsed = parseReview(raw);
    if (!parsed) continue;
    if (collectedIds.has(parsed.id)) continue;

    collectedIds.add(parsed.id);
    reviews.push(parsed);
    newCount++;

    if (maxReviews != null && reviews.length >= maxReviews) {
      return -1;
    }
  }
  return newCount;
}

/**
 * Extract, capture original text for, enrich, and collect reviews in one pass.
 * Returns the count of newly collected reviews, or -1 if maxReviews was reached.
 * Failed restores are recorded in `restoreFailedIds` so the caller re-toggles
 * them at the next loop start.
 */
async function collectOnce(
  page: Page,
  collectedIds: Set<string>,
  reviews: Review[],
  maxReviews: number | undefined,
  restoreFailedIds: Set<string>,
): Promise<number> {
  const rawReviews = await extractReviews(page);
  // Capture original text for translated reviews not yet collected. Filtering
  // on collectedIds ensures each review is toggled at most once per scrape.
  const capture = await captureOriginalTexts(
    page,
    rawReviews.filter((r) => !collectedIds.has(r.reviewId)),
  );
  for (const id of capture.restoreFailedIds) restoreFailedIds.add(id);
  const enriched = enrichReviews(rawReviews, capture.results);
  return collectNewReviews(enriched, collectedIds, reviews, maxReviews);
}

/**
 * The spinner-retry branch: wait for the loading indicator to clear, then
 * re-extract and collect once more. Returns the newly collected count, or -1
 * when the max limit was reached.
 */
async function retryAfterLoading(
  page: Page,
  collectedIds: Set<string>,
  reviews: Review[],
  maxReviews: number | undefined,
  restoreFailedIds: Set<string>,
): Promise<number> {
  await waitForLoadingComplete(page, LOADING_WAIT_TIMEOUT_MS);
  return collectOnce(page, collectedIds, reviews, maxReviews, restoreFailedIds);
}

/**
 * Advance the scroll-collect state machine after one cycle. `newCount` is the
 * number of newly collected reviews (ignored when 0); `loading` is whether a
 * spinner was visible during the cycle. Returns the updated counters and
 * whether collection should stop (only ever true when a spinner was NOT the
 * cause, i.e. a genuine stale end-of-list).
 */
function decideCycle(
  newCount: number,
  loading: boolean,
  state: CycleState,
): { state: CycleState; stop: boolean } {
  if (newCount > 0) {
    return {
      state: { staleScrollCount: 0, spinnerWithoutProgressCount: 0 },
      stop: false,
    };
  }
  if (loading) {
    // Spinner visible but no new reviews – cap to prevent an infinite loop.
    const next = state.spinnerWithoutProgressCount + 1;
    if (next >= MAX_SPINNER_WITHOUT_PROGRESS) {
      return {
        state: {
          staleScrollCount: state.staleScrollCount + 1,
          spinnerWithoutProgressCount: 0,
        },
        stop: false,
      };
    }
    return {
      state: {
        staleScrollCount: state.staleScrollCount,
        spinnerWithoutProgressCount: next,
      },
      stop: false,
    };
  }
  const nextStale = state.staleScrollCount + 1;
  return {
    state: {
      staleScrollCount: nextStale,
      spinnerWithoutProgressCount: state.spinnerWithoutProgressCount,
    },
    stop: !shouldContinueScrolling(nextStale, MAX_STALE_SCROLLS),
  };
}

/**
 * Scroll and collect reviews from the currently active sort order.
 */
async function collectFromCurrentSort(
  page: Page,
  scrollContainer: string,
  collectedIds: Set<string>,
  reviews: Review[],
  options: ScrollOptions,
): Promise<void> {
  let state: CycleState = { staleScrollCount: 0, spinnerWithoutProgressCount: 0 };
  const restoreFailedIds = new Set<string>();

  while (true) {
    // Re-toggle any card left showing its original language so extractReviews
    // never reads a stale original text as `text`.
    if (restoreFailedIds.size > 0) {
      await restoreTranslations(page, restoreFailedIds);
    }

    await expandAllReviews(page);
    const newCount = await collectOnce(
      page,
      collectedIds,
      reviews,
      options.maxReviews,
      restoreFailedIds,
    );

    if (newCount === -1) {
      logger.info(`Reached max reviews limit (${options.maxReviews})`);
      return;
    }

    let decision: { state: CycleState; stop: boolean };
    if (newCount > 0) {
      logger.debug(`+${newCount} new reviews (total: ${reviews.length})`);
      decision = decideCycle(newCount, false, state);
    } else {
      const loading = await isLoadingVisible(page);
      if (loading) {
        const retryNewCount = await retryAfterLoading(
          page,
          collectedIds,
          reviews,
          options.maxReviews,
          restoreFailedIds,
        );
        if (retryNewCount === -1) {
          logger.info(`Reached max reviews limit (${options.maxReviews})`);
          return;
        }
        if (retryNewCount > 0) {
          logger.debug(
            `+${retryNewCount} new reviews after loading (total: ${reviews.length})`,
          );
        }
        decision = decideCycle(retryNewCount, true, state);
      } else {
        decision = decideCycle(0, false, state);
      }
    }
    state = decision.state;

    if (decision.stop) {
      logger.info(
        `No new reviews after scrolling – no more reviews available (${reviews.length} total)`,
      );
      return;
    }

    await scrollDown(page, scrollContainer);

    const baseDelay = options.delayMs || DEFAULT_DELAY_MS;
    const delayBase =
      state.staleScrollCount > 0
        ? calculateStaleDelay(state.staleScrollCount, baseDelay)
        : baseDelay;
    const delay = Math.round(
      delayBase + delayBase * 0.3 * (Math.random() - 0.5),
    );
    await page.waitForTimeout(delay);
    // Allow DOM to settle after scroll animation
    await page.waitForTimeout(DOM_SETTLE_MS);
  }
}

/**
 * Find the scrollable container for reviews.
 * Google Maps uses a specific scrollable div for the reviews panel.
 */
async function findScrollContainer(page: Page): Promise<string | null> {
  const candidates = SELECTORS.scrollContainers;
  const cardSelector = SELECTORS.reviewCard;

  const selector = await page.evaluate(
    ({ candidates: cands, cardSel }) => {
    for (const sel of cands) {
      const el = document.querySelector(sel);
      if (el && el.scrollHeight > el.clientHeight) {
        return sel;
      }
    }

    // Fallback: find scrollable ancestor of a review card
    const reviewCard = document.querySelector(cardSel);
    if (!reviewCard) return null;

    let el: Element | null = reviewCard.parentElement;
    while (el) {
      if (
        el instanceof HTMLElement &&
        el.scrollHeight > el.clientHeight &&
        getComputedStyle(el).overflowY !== "visible"
      ) {
        el.setAttribute("data-revcli-scroll", "true");
        return '[data-revcli-scroll="true"]';
      }
      el = el.parentElement;
    }

    return null;
  },
  { candidates, cardSel: cardSelector },
  );

  if (selector) {
    logger.debug(`Found scroll container: ${selector}`);
  }

  return selector;
}

/**
 * Scroll the reviews container using mouse wheel events.
 * Google Maps uses a virtualized list that only loads new reviews
 * when it detects real scroll events, not programmatic scrollTop changes.
 */
async function scrollDown(
  page: Page,
  containerSelector: string,
): Promise<void> {
  const box = await page.evaluate((sel) => {
    const container = document.querySelector(sel);
    if (!container) return null;
    const rect = container.getBoundingClientRect();
    return {
      x: rect.x + rect.width / 2,
      y: rect.y + rect.height / 2,
    };
  }, containerSelector);

  if (!box) return;

  await page.mouse.move(box.x, box.y);
  await page.mouse.wheel(0, SCROLL_DISTANCE);

  await page.evaluate((sel) => {
    const container = document.querySelector(sel);
    if (container) {
      container.scrollTop += SCROLL_STEP;
    }
  }, containerSelector);
}
