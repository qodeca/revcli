import type { Page } from "playwright";
import { logger } from "../utils/logger.js";
import { SELECTORS } from "./selectors.js";

// Named timeouts for the original-language toggle pass. Reduced from the old
// 3000ms literals so a slow card does not stall the scroll-collect loop; the
// restore-retry timeout is shorter than the primary so a failed restore is
// re-flagged and retried at the next loop start rather than blocking.
const TOGGLE_CLICK_TIMEOUT_MS = 1500;
const TOGGLE_STATE_TIMEOUT_MS = 2000;
const ORIGINAL_TEXT_TIMEOUT_MS = 2000;
const RESTORE_RETRY_TIMEOUT_MS = 1000;
const EXPAND_CLICK_TIMEOUT_MS = 500;

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

/** Result of reading a single review's original-language text. */
export interface OriginalTextResult {
  text: string | null;
  lang: string | null;
  /**
   * The translation text read back while the card was found showing its
   * original (i.e. a prior capture failed to restore it). Set only in that
   * recovery path so `enrichReviews` can correct a stale `text` field.
   */
  translatedText: string | null;
  /** True when the card could not be restored to the translation. */
  restoreFailed: boolean;
}

/** Result of a bounded capture pass over translated reviews. */
export interface CaptureResult {
  results: Map<string, OriginalTextResult>;
  restoreFailedIds: Set<string>;
}

/**
 * Extract the original language name from the "See original (Polish)" button.
 * Google's translated-review toggle text is "Translated by Google ・ See original (X)"
 * where X is the human-readable language name (may itself contain parentheses,
 * e.g. "Chinese (Simplified)"). The greedy group handles the nested-paren case.
 * Returns null when the text does not carry a "See original (…)" segment.
 *
 * `[\s\S]+` (rather than `.`) matches newlines too, so the button text is
 * handled even when the label wraps across multiple DOM text nodes.
 */
export function extractOriginalLanguageFromButtonText(
  text: string | null | undefined,
): string | null {
  if (!text) return null;
  const match = text.match(/See original\s*\(([\s\S]+)\)\s*$/i);
  return match ? match[1].trim() || null : null;
}

/**
 * Resolve the original-language label for a review. Prefers the human-readable
 * language name from the "See original (X)" button; falls back to the ISO code
 * captured from the card. Pure and exported for testability.
 */
export function resolveOriginalLanguage(
  buttonHint: string | null,
  isoTag: string | null,
): string | null {
  const fromButton = buttonHint
    ? extractOriginalLanguageFromButtonText(buttonHint)
    : null;
  if (fromButton) return fromButton;
  return isoTag && isoTag !== "en" ? isoTag : null;
}

/** Whether the translated-review toggle currently shows the translation. */
export function isShowingTranslation(ariaChecked: string | null): boolean {
  return ariaChecked === "true";
}

/** Whether an ISO language tag should be used as a fallback (not English). */
export function shouldFallbackLang(lang: string | null): boolean {
  return Boolean(lang && lang !== "en");
}

/**
 * Build the review-card CSS selector for a given review id. The id is
 * interpolated into an attribute selector value, which only needs quoting when
 * it contains `"`, `\`, or a newline. Google-generated ids (`0x…:0x…`) never do,
 * but the selector is centralized here so the shape stays consistent and the
 * id-based lookup can be audited in one place.
 */
export function buildCardSelector(reviewId: string): string {
  return `${SELECTORS.reviewCard}[data-review-id="${reviewId}"]`;
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
      await moreButtons.nth(i).click({ timeout: EXPAND_CLICK_TIMEOUT_MS });
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
    originalText: null,
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
 *
 * The review id is escaped with `CSS.escape` before interpolation so a card
 * whose id contains a selector metacharacter cannot throw a SyntaxError; the
 * toggle selector is passed from SELECTORS so the fragile jsaction route stays
 * centralized in selectors.ts.
 */
async function waitForToggleState(
  page: Page,
  reviewId: string,
  expected: "true" | "false",
  timeout: number,
): Promise<void> {
  await page.waitForFunction(
    ({ cardSel, toggleSel, id, expectedState }) => {
      const card = document.querySelector(
        `${cardSel}[data-review-id="${CSS.escape(id)}"]`,
      );
      const btn = card?.querySelector(toggleSel);
      return btn?.getAttribute("aria-checked") === expectedState;
    },
    {
      cardSel: SELECTORS.reviewCard,
      toggleSel: SELECTORS.viewOriginalButton,
      id: reviewId,
      expectedState: expected,
    },
    { timeout },
  );
}

/**
 * Wait for the review's original-language text node to be non-empty. The toggle
 * state flips before the text element is populated, so a read immediately after
 * `waitForToggleState("false")` can return empty and lose the original forever.
 * Waiting for a non-empty text node makes that a retry rather than a data loss.
 */
async function waitForOriginalText(
  page: Page,
  reviewId: string,
  timeout: number,
): Promise<void> {
  await page
    .waitForFunction(
      ({ cardSel, textSel, id }) => {
        const card = document.querySelector(
          `${cardSel}[data-review-id="${CSS.escape(id)}"]`,
        );
        const el = card?.querySelector(textSel);
        return (el?.textContent?.trim().length ?? 0) > 0;
      },
      { cardSel: SELECTORS.reviewCard, textSel: SELECTORS.reviewText, id: reviewId },
      { timeout },
    )
    .catch(() => {});
}

/** Read the original text and ISO language tag in a single evaluate pass. */
async function readCardOriginal(
  page: Page,
  cardLocator: ReturnType<Page["locator"]>,
): Promise<{ text: string | null; lang: string | null }> {
  return cardLocator.evaluate(
    (card, s) => {
      const textEl = card.querySelector(s.text);
      const container = card.querySelector(s.container);
      return {
        text: textEl?.textContent?.trim() || null,
        lang: container?.getAttribute("lang") ?? null,
      };
    },
    { text: SELECTORS.reviewText, container: SELECTORS.reviewTextContainer },
  );
}

/** Read the displayed (translation) text from a card, if any. */
async function readCardText(
  page: Page,
  cardLocator: ReturnType<Page["locator"]>,
): Promise<string | null> {
  const text = await cardLocator
    .locator(SELECTORS.reviewText)
    .first()
    .textContent();
  return text?.trim() || null;
}

/**
 * Toggle a single translated review to show its original text, read it, then
 * restore the translation. Returns the capture result on success, null on
 * failure. Best-effort: on error it restores the toggle (if it was left open)
 * so the shared DOM is not left in a translated state for the next extraction.
 *
 * A card found already showing its original (aria-checked="false") is treated
 * as a prior failed restore: the translation is read back first so the caller
 * can correct a stale `text` field, then the original is re-read.
 */
async function readOriginalText(
  page: Page,
  reviewId: string,
): Promise<OriginalTextResult | null> {
  const cardLocator = page.locator(buildCardSelector(reviewId));
  const toggle = cardLocator.locator(SELECTORS.viewOriginalButton).first();

  try {
    const ariaChecked = await toggle.getAttribute("aria-checked");
    let toggledToOriginal = false;
    let translatedText: string | null = null;

    if (isShowingTranslation(ariaChecked)) {
      // Normal path: showing the translation, toggle to original.
      await toggle.click({ timeout: TOGGLE_CLICK_TIMEOUT_MS });
      toggledToOriginal = true;
    } else if (ariaChecked === "false") {
      // Prior failed restore left this card showing its original. Read the
      // translation back first so `text` can be corrected, then re-read original.
      await toggle.click({ timeout: TOGGLE_CLICK_TIMEOUT_MS });
      await waitForToggleState(page, reviewId, "true", 3000);
      translatedText = await readCardText(page, cardLocator);
      await toggle.click({ timeout: TOGGLE_CLICK_TIMEOUT_MS });
      toggledToOriginal = true;
    } else {
      // aria-checked absent on first render: reveal explicitly rather than
      // assuming the original is already shown, then remember to restore.
      await toggle.click({ timeout: TOGGLE_CLICK_TIMEOUT_MS }).catch(() => {});
      toggledToOriginal = true;
    }

    await waitForToggleState(page, reviewId, "false", TOGGLE_STATE_TIMEOUT_MS);
    // Wait for the original text node to render before reading (N9).
    await waitForOriginalText(page, reviewId, ORIGINAL_TEXT_TIMEOUT_MS);

    const { text, lang } = await readCardOriginal(page, cardLocator);

    if (toggledToOriginal) {
      await toggle.click({ timeout: TOGGLE_CLICK_TIMEOUT_MS });
      try {
        await waitForToggleState(page, reviewId, "true", TOGGLE_STATE_TIMEOUT_MS);
      } catch {
        // S3: verify the restore actually happened. One retry, then flag the
        // review so the caller re-toggles it at the next loop start (preventing
        // a stale original text from being read as `text`).
        try {
          await toggle.click({ timeout: RESTORE_RETRY_TIMEOUT_MS });
          await waitForToggleState(page, reviewId, "true", RESTORE_RETRY_TIMEOUT_MS);
        } catch {
          logger.warn(
            `Could not restore translation for review ${reviewId}`,
          );
          return { text, lang, translatedText, restoreFailed: true };
        }
      }
    }

    return { text, lang, translatedText, restoreFailed: false };
  } catch {
    // Best-effort restore if the toggle was left showing the original.
    try {
      const ariaChecked = await toggle.getAttribute("aria-checked");
      if (ariaChecked === "false") {
        await toggle.click({ timeout: RESTORE_RETRY_TIMEOUT_MS });
      }
    } catch {
      // ignore
    }
    return null;
  }
}

/**
 * Capture the original-language text for translated reviews in a bounded pass,
 * returning the results rather than mutating the input (pure capture).
 *
 * Only reviews that are translated and have not yet captured their original
 * text are toggled, so each review is toggled at most once per scrape. Reviews
 * whose restore failed are reported via `restoreFailedIds` so the caller can
 * re-toggle them at the next loop start, never leaving a card showing its
 * original language when `extractReviews` reads `text`.
 */
export async function captureOriginalTexts(
  page: Page,
  rawReviews: RawReview[],
): Promise<CaptureResult> {
  const translated = rawReviews.filter(
    (r) => r.isTranslated && !r.originalText,
  );
  if (translated.length === 0) {
    return { results: new Map(), restoreFailedIds: new Set() };
  }

  logger.info(
    `Capturing original text for ${translated.length} translated reviews`,
  );

  const startTime = Date.now();
  const results = new Map<string, OriginalTextResult>();
  const restoreFailedIds = new Set<string>();
  let captured = 0;

  for (const raw of translated) {
    const result = await readOriginalText(page, raw.reviewId);
    if (result?.text) {
      results.set(raw.reviewId, result);
      captured++;
      if (result.restoreFailed) restoreFailedIds.add(raw.reviewId);
    }
  }

  // Log the O(N) cost of the per-review toggle pass so a slow scrape is
  // attributable to the capture loop (N sequential page round-trips).
  logger.debug(
    `Original-language capture: ${translated.length} toggled, ${captured} captured, ${Date.now() - startTime}ms`,
  );

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
  return { results, restoreFailedIds };
}

/**
 * Enrich a batch of raw reviews with captured original text, returning a new
 * array (no in-place mutation). For reviews found showing their original, the
 * `text` field is corrected with the translation read back during capture.
 */
export function enrichReviews(
  rawReviews: RawReview[],
  results: Map<string, OriginalTextResult>,
): RawReview[] {
  return rawReviews.map((r) => {
    const res = results.get(r.reviewId);
    if (!res) return r;
    return {
      ...r,
      text: res.translatedText ?? r.text,
      originalText: res.text,
      originalLanguage:
        r.originalLanguage ??
        (shouldFallbackLang(res.lang) ? res.lang : null),
    };
  });
}

/**
 * Force cards that were left showing their original language back to the
 * translation. Called at the start of a collection loop so `extractReviews`
 * never reads a stale original text as `text`. Reviews that still fail remain
 * flagged and are retried on the next cycle.
 */
export async function restoreTranslations(
  page: Page,
  reviewIds: Set<string>,
): Promise<void> {
  for (const id of reviewIds) {
    const cardLocator = page.locator(buildCardSelector(id));
    const toggle = cardLocator.locator(SELECTORS.viewOriginalButton).first();
    try {
      const ariaChecked = await toggle.getAttribute("aria-checked");
      if (ariaChecked === "false") {
        await toggle.click({ timeout: TOGGLE_CLICK_TIMEOUT_MS });
        await waitForToggleState(page, id, "true", TOGGLE_STATE_TIMEOUT_MS);
      }
    } catch {
      // Leave it flagged; retried on the next cycle.
    }
  }
}
