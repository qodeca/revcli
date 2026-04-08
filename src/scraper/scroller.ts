import type { Page } from "playwright";
import type { Review } from "../core/schema.js";
import { expandAllReviews, extractReviews } from "./extractor.js";
import { parseReview } from "./parser.js";
import { logger } from "../utils/logger.js";

export interface ScrollOptions {
  maxReviews?: number;
  delayMs: number;
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
  let staleScrollCount = 0;
  const maxStaleScrolls = 5;

  // Find the scrollable reviews container
  const scrollContainer = await findScrollContainer(page);
  if (!scrollContainer) {
    logger.warn("Could not find reviews scroll container");
    return reviews;
  }

  logger.info("Scrolling to collect reviews...");

  while (true) {
    // Expand truncated reviews
    await expandAllReviews(page);

    // Extract all visible reviews
    const rawReviews = await extractReviews(page);

    // Parse and deduplicate
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
        return reviews;
      }
    }

    if (newCount > 0) {
      logger.debug(`+${newCount} new reviews (total: ${reviews.length})`);
      staleScrollCount = 0;
    } else {
      staleScrollCount++;
      if (staleScrollCount >= maxStaleScrolls) {
        logger.info("No new reviews after scrolling – reached the end");
        break;
      }
    }

    // Scroll down and wait for new content to load
    await scrollDown(page, scrollContainer);

    // Wait with jitter for content to load
    const baseDelay = options.delayMs || 3000;
    const delay = Math.round(baseDelay + baseDelay * 0.3 * (Math.random() - 0.5));
    await page.waitForTimeout(delay);

    // Brief extra wait for content to settle
    await page.waitForTimeout(500);
  }

  return reviews;
}

/**
 * Find the scrollable container for reviews.
 * Google Maps uses a specific scrollable div for the reviews panel.
 */
async function findScrollContainer(page: Page): Promise<string | null> {
  const selector = await page.evaluate(() => {
    const candidates = [
      "div.m6QErb.DxyBCb.kA9KIf.dS8AEf",
      'div.m6QErb[aria-label]',
      'div[role="feed"]',
      "div.section-scrollbox",
    ];

    for (const sel of candidates) {
      const el = document.querySelector(sel);
      if (el && el.scrollHeight > el.clientHeight) {
        return sel;
      }
    }

    // Fallback: find scrollable ancestor of a review card
    const reviewCard = document.querySelector("div.jftiEf");
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
  });

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
  // First, get the container's bounding box to target the scroll
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

  // Use mouse wheel to scroll – this properly triggers Google Maps' lazy loading
  await page.mouse.move(box.x, box.y);
  await page.mouse.wheel(0, 800);

  // Also set scrollTop as a fallback
  await page.evaluate((sel) => {
    const container = document.querySelector(sel);
    if (container) {
      container.scrollTop += 1000;
    }
  }, containerSelector);
}
