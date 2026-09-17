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
  originalLanguage: string | null;
  isTranslated: boolean;
  photos: number;
  ownerResponseText: string | null;
  ownerResponseTime: string | null;
}

/**
 * Extract the original language name from the "See original (Polish)" button.
 * Google's translated-review toggle text is "Translated by Google ・ See original (X)"
 * where X is the human-readable language name (may itself contain parentheses,
 * e.g. "Chinese (Simplified)"). The greedy group handles the nested-paren case.
 * Returns null when the text does not carry a "See original (…)" segment.
 */
export function extractOriginalLanguageFromButtonText(
  text: string | null | undefined,
): string | null {
  if (!text) return null;
  const match = text.match(/See original\s*\((.+)\)\s*$/i);
  return match ? match[1].trim() || null : null;
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
    viewOriginalButton: SELECTORS.viewOriginalButton,
    photo: SELECTORS.photoButton,
    responseContainer: SELECTORS.ownerResponseContainer,
    responseText: SELECTORS.ownerResponseText,
    responseTime: SELECTORS.ownerResponseTime,
  };

  const results = await page.evaluate((s) => {
    const out: Array<{
      reviewId: string;
      author: string;
      authorUrl: string | null;
      publishTime: string;
      rating: number;
      text: string | null;
      originalText: string | null;
      originalLanguageHint: string | null;
      isTranslated: boolean;
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

        // A translated review renders a toggle button ("See original (X)").
        // Its presence is the only reliable signal; the original text is NOT
        // pre-rendered in the DOM, so we return the button text here and let
        // the Node side parse the language, then toggle to capture the text.
        const viewOriginalButton = card.querySelector(s.viewOriginalButton);
        const isTranslated = Boolean(viewOriginalButton);
        const originalLanguageHint = isTranslated
          ? (viewOriginalButton?.textContent?.trim() ?? null)
          : null;

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
          out.push({
            reviewId,
            author,
            authorUrl,
            publishTime,
            rating,
            text,
            originalText,
            originalLanguageHint,
            isTranslated,
            photos,
            ownerResponseText,
            ownerResponseTime,
          });
        }
      } catch {
        // Skip malformed review card
      }
    }

    return out;
  }, sel);

  // Resolve the original language from the raw button text on the Node side.
  const reviews: RawReview[] = results.map((r) => ({
    reviewId: r.reviewId,
    author: r.author,
    authorUrl: r.authorUrl,
    publishTime: r.publishTime,
    rating: r.rating,
    text: r.text,
    originalText: r.originalText,
    originalLanguage: r.originalLanguageHint
      ? extractOriginalLanguageFromButtonText(r.originalLanguageHint)
      : null,
    isTranslated: r.isTranslated,
    photos: r.photos,
    ownerResponseText: r.ownerResponseText,
    ownerResponseTime: r.ownerResponseTime,
  }));

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

/**
 * Wait for the translated-review toggle's `aria-checked` to reach the expected
 * state. aria-checked="true" means the English translation is displayed;
 * "false" means the original-language text is displayed.
 */
async function waitForToggleState(
  page: Page,
  reviewId: string,
  expected: "true" | "false",
  timeout: number,
): Promise<void> {
  await page.waitForFunction(
    ({ cardSel, id, expectedState }) => {
      const card = document.querySelector(
        `${cardSel}[data-review-id="${id}"]`,
      );
      const btn = card?.querySelector('[jsaction*="review.showReview"]');
      return btn?.getAttribute("aria-checked") === expectedState;
    },
    { cardSel: SELECTORS.reviewCard, id: reviewId, expectedState: expected },
    { timeout },
  );
}

/**
 * Toggle a single translated review to show its original text, read it, then
 * restore the translation. Returns { text, lang } on success, null on failure.
 * Best-effort: on error it restores the toggle (if it was left open) so the
 * shared DOM is not left in a translated state for the next extraction.
 */
async function readOriginalText(
  page: Page,
  reviewId: string,
): Promise<{ text: string | null; lang: string | null } | null> {
  const cardLocator = page.locator(
    `${SELECTORS.reviewCard}[data-review-id="${reviewId}"]`,
  );
  const toggle = cardLocator.locator(SELECTORS.viewOriginalButton).first();

  try {
    const ariaChecked = await toggle.getAttribute("aria-checked");
    const wasShowingTranslation = ariaChecked === "true";

    if (wasShowingTranslation) {
      await toggle.click({ timeout: 3000 });
    }
    await waitForToggleState(page, reviewId, "false", 3000);

    const textEl = cardLocator.locator(SELECTORS.reviewText).first();
    const text = ((await textEl.textContent()) ?? "").trim() || null;
    // div.MyEned carries the original ISO language code once toggled.
    const lang = await cardLocator
      .locator(SELECTORS.reviewTextContainer)
      .first()
      .getAttribute("lang")
      .catch(() => null);

    if (wasShowingTranslation) {
      await toggle.click({ timeout: 3000 });
      await waitForToggleState(page, reviewId, "true", 3000);
    }

    return { text, lang };
  } catch {
    // Best-effort restore if the toggle was left showing the original.
    try {
      const ariaChecked = await toggle.getAttribute("aria-checked");
      if (ariaChecked === "false") {
        await toggle.click({ timeout: 2000 });
      }
    } catch {
      // ignore
    }
    return null;
  }
}

/**
 * Capture the original-language text for translated reviews.
 *
 * For each review that is translated (has the "See original (X)" toggle) and
 * has not yet captured its original text, toggle to the original, read it,
 * then restore. Mutates the RawReview objects in place so the caller's
 * subsequent collection sees the enriched fields. Failures degrade gracefully:
 * the review is still collected, just without an original text.
 *
 * Callers pass only reviews not yet collected so each review is toggled at most
 * once per scrape (avoiding repeated round-trips on re-extraction).
 */
export async function captureOriginalTexts(
  page: Page,
  rawReviews: RawReview[],
): Promise<void> {
  const translated = rawReviews.filter(
    (r) => r.isTranslated && !r.originalText,
  );
  if (translated.length === 0) return;

  logger.info(
    `Capturing original text for ${translated.length} translated reviews`,
  );

  let captured = 0;
  for (const raw of translated) {
    const result = await readOriginalText(page, raw.reviewId);
    if (result?.text) {
      raw.originalText = result.text;
      // Prefer the human-readable language name from the button; fall back to
      // the ISO code on div.MyEned[lang] when the button text was unparseable.
      if (!raw.originalLanguage && result.lang && result.lang !== "en") {
        raw.originalLanguage = result.lang;
      }
      captured++;
    }
  }

  const missed = translated.length - captured;
  if (missed > 0) {
    logger.warn(
      `Could not capture original text for ${missed}/${translated.length} translated reviews`,
    );
  } else {
    logger.debug(
      `Captured original text for ${captured} translated reviews`,
    );
  }
}
