import type { Page } from "playwright";
import { logger } from "../utils/logger.js";
import { SELECTORS } from "./selectors.js";

export interface RawReview {
  reviewId: string;
  author: string;
  authorUrl: string | null;
  publishTime: string;
  rating: number;
  text: string | null;
  originalText: string | null;
  photos: number;
  ownerResponseText: string | null;
  ownerResponseTime: string | null;
}

/**
 * Expand all truncated review texts by clicking "More" buttons.
 * Chained `locator(reviewCard).locator(expandButton)` scopes the
 * comma-list to card subtrees (see tests/extractor-selectors.test.ts)
 * and returns only real matches, avoiding per-empty-card click timeouts.
 */
export async function expandAllReviews(page: Page): Promise<void> {
  const moreButtons = page
    .locator(SELECTORS.reviewCard)
    .locator(SELECTORS.expandButton);

  let count: number;
  try {
    count = await moreButtons.count();
  } catch {
    return;
  }

  for (let i = 0; i < count; i++) {
    try {
      await moreButtons.nth(i).click({ timeout: 500 });
    } catch {
      // Button detached, re-rendered, or already expanded
    }
  }

  if (count > 0) {
    logger.debug(`Expanded ${count} truncated reviews`);
  }
}

/**
 * Extract all currently visible reviews from the DOM in a single evaluate() call.
 * Selectors are passed as arguments to keep them centralized in selectors.ts.
 */
export async function extractReviews(page: Page): Promise<RawReview[]> {
  const sel = {
    card: SELECTORS.reviewCard,
    reviewId: SELECTORS.reviewId,
    authorName: SELECTORS.authorName,
    authorButton: SELECTORS.authorButton,
    stars: SELECTORS.stars,
    timeContainer: SELECTORS.reviewTimeContainer,
    time: SELECTORS.reviewTime,
    text: SELECTORS.reviewText,
    photo: SELECTORS.photoButton,
    responseContainer: SELECTORS.ownerResponseContainer,
    responseText: SELECTORS.ownerResponseText,
    responseTime: SELECTORS.ownerResponseTime,
  };

  const reviews = await page.evaluate((s) => {
    const results: Array<{
      reviewId: string;
      author: string;
      authorUrl: string | null;
      publishTime: string;
      rating: number;
      text: string | null;
      originalText: string | null;
      photos: number;
      ownerResponseText: string | null;
      ownerResponseTime: string | null;
    }> = [];

    const reviewCards = document.querySelectorAll(s.card);

    for (const card of reviewCards) {
      try {
        const reviewIdEl = card.querySelector(s.reviewId);
        const reviewId = reviewIdEl?.getAttribute("data-review-id") ?? "";

        const authorEl = card.querySelector(s.authorName);
        const author = authorEl?.textContent?.trim() ?? "Anonymous";

        const authorButton = card.querySelector(s.authorButton);
        const authorUrl =
          authorButton?.getAttribute("data-href") ?? null;

        const starsEl = card.querySelector(s.stars);
        const starsLabel = starsEl?.getAttribute("aria-label") ?? "";
        const ratingMatch = starsLabel.match(/(\d+)/);
        const rating = ratingMatch ? parseInt(ratingMatch[1]) : 0;

        const timeContainer = card.querySelector(s.timeContainer);
        const timeEl = timeContainer?.querySelector(s.time);
        const publishTime = timeEl?.textContent?.trim() ?? "";

        const textContainer = card.querySelector(s.text);
        const text = textContainer?.textContent?.trim() || null;

        const originalText: string | null = null;

        const photoButtons = card.querySelectorAll(s.photo);
        const photos = photoButtons.length;

        const responseContainer = card.querySelector(s.responseContainer);
        let ownerResponseText: string | null = null;
        let ownerResponseTime: string | null = null;
        if (responseContainer) {
          const responseTextEl =
            responseContainer.querySelector(s.responseText);
          ownerResponseText =
            responseTextEl?.textContent?.trim() || null;

          const responseTimeEl =
            responseContainer.querySelector(s.responseTime);
          ownerResponseTime =
            responseTimeEl?.textContent?.trim() || null;
        }

        if (reviewId) {
          results.push({
            reviewId,
            author,
            authorUrl,
            publishTime,
            rating,
            text,
            originalText,
            photos,
            ownerResponseText,
            ownerResponseTime,
          });
        }
      } catch {
        // Skip malformed review card
      }
    }

    return results;
  }, sel);

  // Warn about potential selector staleness
  if (reviews.length === 0) {
    const hasContent = await page.evaluate(
      (cardSel) => document.querySelectorAll(cardSel).length === 0
        && document.body.innerText.length > 1000,
      sel.card,
    );
    if (hasContent) {
      logger.warn(
        "No reviews extracted but page has content – selectors may be stale",
      );
    }
  }

  // Warn about reviews with unparsed ratings (likely stale stars selector)
  const zeroRatingCount = reviews.filter((r) => r.rating === 0).length;
  if (zeroRatingCount > 0) {
    logger.warn(
      `${zeroRatingCount} reviews have rating=0 – stars selector may be stale`,
    );
  }

  logger.debug(`Extracted ${reviews.length} reviews from DOM`);
  return reviews;
}
