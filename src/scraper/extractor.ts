import type { Page } from "playwright";
import { logger } from "../utils/logger.js";

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
 * Must be called before extractReviews to get full text.
 */
export async function expandAllReviews(page: Page): Promise<void> {
  try {
    // Google Maps uses buttons with text "More" to expand truncated reviews
    const moreButtons = page.locator(
      'div.jftiEf button.w8nwRe, div.jftiEf button:has-text("More")',
    );
    const count = await moreButtons.count();
    for (let i = 0; i < count; i++) {
      try {
        await moreButtons.nth(i).click({ timeout: 500 });
      } catch {
        // Button may have disappeared or been already clicked
      }
    }
    if (count > 0) {
      logger.debug(`Expanded ${count} truncated reviews`);
    }
  } catch {
    // No expandable reviews
  }
}

/**
 * Extract all currently visible reviews from the DOM in a single evaluate() call.
 * Uses the exact selectors discovered from Google Maps DOM inspection:
 * - Card: div.jftiEf with data-review-id
 * - Author: div.d4r55
 * - Author URL: button[data-href*="/contrib/"] (data-href, not href)
 * - Stars: span.kvMYJc[role="img"] aria-label="N stars"
 * - Time: span.rsqaWe
 * - Text: span.wiI7pd (inside div.MyEned)
 * - Owner response: div.CDe7pd
 */
export async function extractReviews(page: Page): Promise<RawReview[]> {
  const reviews = await page.evaluate(() => {
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

    const reviewCards = document.querySelectorAll("div.jftiEf");

    for (const card of reviewCards) {
      try {
        // Review ID from data attribute
        const reviewIdEl = card.querySelector("[data-review-id]");
        const reviewId = reviewIdEl?.getAttribute("data-review-id") ?? "";

        // Author name from d4r55 class
        const authorEl = card.querySelector("div.d4r55");
        const author = authorEl?.textContent?.trim() ?? "Anonymous";

        // Author URL from data-href (not href) on button
        const authorButton = card.querySelector(
          'button[data-href*="/contrib/"]',
        );
        const authorUrl =
          authorButton?.getAttribute("data-href") ?? null;

        // Rating from aria-label on stars span
        const starsEl = card.querySelector(
          'span.kvMYJc[role="img"]',
        );
        const starsLabel = starsEl?.getAttribute("aria-label") ?? "";
        const ratingMatch = starsLabel.match(/(\d)/);
        const rating = ratingMatch ? parseInt(ratingMatch[1]) : 0;

        // Publish time from rsqaWe span (inside DU9Pgb, not CDe7pd)
        const timeContainer = card.querySelector("div.DU9Pgb");
        const timeEl = timeContainer?.querySelector("span.rsqaWe");
        const publishTime = timeEl?.textContent?.trim() ?? "";

        // Review text from wiI7pd span inside MyEned div
        // This is the translated text (or original if same language)
        const textContainer = card.querySelector(
          "div.MyEned span.wiI7pd",
        );
        const text = textContainer?.textContent?.trim() || null;

        // Original text – not directly available without clicking "See original"
        // The card may contain a "Translated by Google" indicator
        const originalText: string | null = null;

        // Photo count – look for photo buttons within the review
        const photoButtons = card.querySelectorAll("button.Tya61d");
        const photos = photoButtons.length;

        // Owner response from CDe7pd container
        // Response text uses div.wiI7pd (not span), time uses span.DZSIDd
        const responseContainer = card.querySelector("div.CDe7pd");
        let ownerResponseText: string | null = null;
        let ownerResponseTime: string | null = null;
        if (responseContainer) {
          const responseTextEl =
            responseContainer.querySelector("div.wiI7pd");
          ownerResponseText =
            responseTextEl?.textContent?.trim() || null;

          const responseTimeEl =
            responseContainer.querySelector("span.DZSIDd");
          ownerResponseTime =
            responseTimeEl?.textContent?.trim() || null;
        }

        if (rating > 0 && reviewId) {
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
  });

  logger.debug(`Extracted ${reviews.length} reviews from DOM`);
  return reviews;
}
