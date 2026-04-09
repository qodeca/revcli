import type { Page } from "playwright";
import type { Review } from "../core/schema.js";
import {
  expandAllReviews,
  extractReviews,
  type RawReview,
} from "./extractor.js";
import { parseReview } from "./parser.js";
import { logger } from "../utils/logger.js";
import { SELECTORS } from "./selectors.js";

const MAX_STALE_SCROLLS = 6;
const MAX_SPINNER_WITHOUT_PROGRESS = 3;

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
      .isVisible({ timeout: 100 });
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
  timeout: number = 5000,
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
 * Scroll and collect reviews from the currently active sort order.
 */
async function collectFromCurrentSort(
  page: Page,
  scrollContainer: string,
  collectedIds: Set<string>,
  reviews: Review[],
  options: ScrollOptions,
): Promise<void> {
  let staleScrollCount = 0;
  let spinnerWithoutProgressCount = 0;

  while (true) {
    await expandAllReviews(page);

    const rawReviews = await extractReviews(page);
    const newCount = collectNewReviews(
      rawReviews,
      collectedIds,
      reviews,
      options.maxReviews,
    );

    if (newCount === -1) {
      logger.info(`Reached max reviews limit (${options.maxReviews})`);
      return;
    }

    if (newCount > 0) {
      logger.debug(`+${newCount} new reviews (total: ${reviews.length})`);
      staleScrollCount = 0;
      spinnerWithoutProgressCount = 0;
    } else {
      const loading = await isLoadingVisible(page);
      if (loading) {
        await waitForLoadingComplete(page, 5000);

        // Re-extract after loading completes
        const retryRaw = await extractReviews(page);
        const retryNewCount = collectNewReviews(
          retryRaw,
          collectedIds,
          reviews,
          options.maxReviews,
        );

        if (retryNewCount === -1) {
          logger.info(`Reached max reviews limit (${options.maxReviews})`);
          return;
        }

        if (retryNewCount > 0) {
          logger.debug(
            `+${retryNewCount} new reviews after loading (total: ${reviews.length})`,
          );
          staleScrollCount = 0;
          spinnerWithoutProgressCount = 0;
        } else {
          // Spinner visible but no new reviews – cap to prevent infinite loop
          spinnerWithoutProgressCount++;
          if (spinnerWithoutProgressCount >= MAX_SPINNER_WITHOUT_PROGRESS) {
            staleScrollCount++;
            spinnerWithoutProgressCount = 0;
          }
        }
      } else {
        staleScrollCount++;
        if (!shouldContinueScrolling(staleScrollCount, MAX_STALE_SCROLLS)) {
          logger.info(
            `No new reviews after scrolling – no more reviews available (${reviews.length} total)`,
          );
          return;
        }
      }
    }

    await scrollDown(page, scrollContainer);

    const baseDelay = options.delayMs || 3000;
    const delayBase =
      staleScrollCount > 0
        ? calculateStaleDelay(staleScrollCount, baseDelay)
        : baseDelay;
    const delay = Math.round(
      delayBase + delayBase * 0.3 * (Math.random() - 0.5),
    );
    await page.waitForTimeout(delay);
    // Allow DOM to settle after scroll animation
    await page.waitForTimeout(500);
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
  await page.mouse.wheel(0, 800);

  await page.evaluate((sel) => {
    const container = document.querySelector(sel);
    if (container) {
      container.scrollTop += 1000;
    }
  }, containerSelector);
}
