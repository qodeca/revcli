import type { Page } from "playwright";
import type { Review, SortOrder } from "../core/schema.js";
import { expandAllReviews, extractReviews } from "./extractor.js";
import { parseReview } from "./parser.js";
import { logger } from "../utils/logger.js";
import { SELECTORS } from "./selectors.js";
import { setSortOrder } from "./navigator.js";

export interface ScrollOptions {
  maxReviews?: number;
  delayMs: number;
  extraSortOrders?: SortOrder[];
}

/**
 * Scroll the reviews panel and collect reviews incrementally.
 * Uses deduplication to avoid collecting the same review twice.
 * When a sort order is exhausted and maxReviews isn't reached,
 * switches to additional sort orders to collect more reviews.
 */
export async function scrollAndCollectReviews(
  page: Page,
  options: ScrollOptions,
): Promise<Review[]> {
  const collectedIds = new Set<string>();
  const reviews: Review[] = [];

  // Find the scrollable reviews container
  const scrollContainer = await findScrollContainer(page);
  if (!scrollContainer) {
    logger.warn("Could not find reviews scroll container");
    return reviews;
  }

  logger.info("Scrolling to collect reviews...");

  // Collect from the current (primary) sort order
  const done = await collectFromCurrentSort(
    page,
    scrollContainer,
    collectedIds,
    reviews,
    options,
  );

  if (done || !options.extraSortOrders?.length) {
    return reviews;
  }

  // Try additional sort orders to collect more reviews
  for (const sortOrder of options.extraSortOrders) {
    logger.info(
      `Switching to "${sortOrder}" sort to collect more reviews...`,
    );
    await setSortOrder(page, sortOrder);
    await page.waitForTimeout(3000);

    const reachedMax = await collectFromCurrentSort(
      page,
      scrollContainer,
      collectedIds,
      reviews,
      options,
    );

    if (reachedMax) break;
  }

  return reviews;
}

/**
 * Scroll and collect reviews from the currently active sort order.
 * Returns true if maxReviews was reached.
 */
async function collectFromCurrentSort(
  page: Page,
  scrollContainer: string,
  collectedIds: Set<string>,
  reviews: Review[],
  options: ScrollOptions,
): Promise<boolean> {
  let staleScrollCount = 0;
  const maxStaleScrolls = 5;

  while (true) {
    await expandAllReviews(page);

    const rawReviews = await extractReviews(page);

    let newCount = 0;
    for (const raw of rawReviews) {
      const parsed = parseReview(raw);
      if (!parsed) continue;
      if (collectedIds.has(parsed.id)) continue;

      collectedIds.add(parsed.id);
      reviews.push(parsed);
      newCount++;

      if (options.maxReviews && reviews.length >= options.maxReviews) {
        logger.info(`Reached max reviews limit (${options.maxReviews})`);
        return true;
      }
    }

    if (newCount > 0) {
      logger.debug(`+${newCount} new reviews (total: ${reviews.length})`);
      staleScrollCount = 0;
    } else {
      staleScrollCount++;
      if (staleScrollCount >= maxStaleScrolls) {
        logger.info(
          `No new reviews after scrolling – exhausted this sort order (${reviews.length} total)`,
        );
        return false;
      }
    }

    await scrollDown(page, scrollContainer);

    const baseDelay = options.delayMs || 3000;
    const delay = Math.round(
      baseDelay + baseDelay * 0.3 * (Math.random() - 0.5),
    );
    await page.waitForTimeout(delay);
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
