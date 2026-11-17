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

// Expand ("More") step – see expandAllReviews and docs/selector-maintenance.md §5.
const EXPAND_CLICK_TIMEOUT_MS = 1000;
const EXPAND_CONFIRM_TIMEOUT_MS = 1500;
const EXPAND_MAX_PASSES = 2;
/** Attribute that marks each pending "More" button with a per-pass token. */
export const EXPAND_MARK_ATTR = "data-revcli-expand";
/** Tokens are generated Node-side and interpolated into a selector, so pin their alphabet. */
const EXPAND_TOKEN_RE = /^[a-z0-9-]+$/;

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
 * A review as read from the DOM, plus whether its card still had an
 * unexpanded "More" button at read time (its text may be cut off).
 */
export type ExtractedReview = RawReview & { expandPending: boolean };

/** Outcome of one `expandAllReviews` call (for debug logging). */
export interface ExpandResult {
  /** Click attempts across all passes. */
  attempted: number;
  /** Clicks confirmed by the button disappearing, hiding or reporting aria-expanded="true". */
  expanded: number;
  /** Review ids whose cards still have a pending "More" button after the last pass. */
  pendingReviewIds: Set<string>;
}

/**
 * The truncation summary shown once at the end of a scrape (message M4).
 * Pure and exported for testability.
 */
export function formatTruncationWarning(count: number, total: number): string {
  const noun = total === 1 ? "review" : "reviews";
  return `Could not expand the full text of ${count} of ${total} collected ${noun} – their text may be cut off (ends with "…").`;
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

interface ExpandScanTarget {
  token: string | null;
  reviewId: string | null;
}

/**
 * One in-page pass over every review card not in `skipIds`, returning the
 * "pending" expand buttons: rendered (has client rects) and not
 * `aria-expanded="true"`. With `stamp`, old marks are cleared first and each
 * pending button is marked `EXPAND_MARK_ATTR="<prefix>-<n>"` so it can be
 * clicked by identity rather than by position. The buttons are looked up with
 * `card.querySelectorAll`, which keeps the expandButton comma-list scoped to
 * the card subtree. This is the single "pending" predicate on the expand side
 * (`extractReviews` inlines the same test for `expandPending`).
 */
async function scanExpandButtons(
  page: Page,
  opts: { skipIds: string[]; stamp: boolean; prefix: string },
): Promise<ExpandScanTarget[]> {
  return page.evaluate(
    ({ cardSel, reviewIdSel, btnSel, attr, prefix, stamp, skipIds }) => {
      if (stamp) {
        for (const el of Array.from(document.querySelectorAll(`[${attr}]`))) {
          el.removeAttribute(attr);
        }
      }
      const skip = new Set(skipIds);
      const out: Array<{ token: string | null; reviewId: string | null }> = [];
      let n = 0;
      for (const card of Array.from(document.querySelectorAll(cardSel))) {
        // Same id resolution as extractReviews, so skipIds (collected ids)
        // and pendingReviewIds use the ids the scroller collects.
        const reviewId =
          card.querySelector(reviewIdSel)?.getAttribute("data-review-id") || null;
        if (reviewId !== null && skip.has(reviewId)) continue;
        for (const btn of Array.from(card.querySelectorAll(btnSel))) {
          const pending =
            btn.getClientRects().length > 0 &&
            btn.getAttribute("aria-expanded") !== "true";
          if (!pending) continue;
          let token: string | null = null;
          if (stamp) {
            token = `${prefix}-${n}`;
            n += 1;
            btn.setAttribute(attr, token);
          }
          out.push({ token, reviewId });
        }
      }
      return out;
    },
    {
      cardSel: SELECTORS.reviewCard,
      reviewIdSel: SELECTORS.reviewId,
      btnSel: SELECTORS.expandButton,
      attr: EXPAND_MARK_ATTR,
      prefix: opts.prefix,
      stamp: opts.stamp,
      skipIds: opts.skipIds,
    },
  );
}

/**
 * Wait until the marked button is gone, disconnected, hidden, or reports
 * `aria-expanded="true"` – whichever way Google acknowledges the expand.
 * Returns false on timeout.
 */
async function waitForExpanded(page: Page, token: string): Promise<boolean> {
  return page
    .waitForFunction(
      ({ attr, tok }) => {
        const el = document.querySelector(`[${attr}="${tok}"]`);
        return (
          !el ||
          !el.isConnected ||
          el.getAttribute("aria-expanded") === "true" ||
          el.getClientRects().length === 0
        );
      },
      { attr: EXPAND_MARK_ATTR, tok: token },
      { timeout: EXPAND_CONFIRM_TIMEOUT_MS },
    )
    .then(
      () => true,
      () => false,
    );
}

/** Click one marked button and confirm the expand. False when either step fails. */
async function clickMarked(page: Page, token: string): Promise<boolean> {
  try {
    await page
      .locator(`[${EXPAND_MARK_ATTR}="${token}"]`)
      .click({ timeout: EXPAND_CLICK_TIMEOUT_MS });
  } catch {
    // Detached or re-rendered before the click landed; a later pass (or the
    // extraction-time `expandPending` flag) accounts for the card.
    return false;
  }
  return waitForExpanded(page, token);
}

/** Scan without failing the scrape: a navigation mid-evaluate yields no targets. */
async function safeScan(
  page: Page,
  opts: { skipIds: string[]; stamp: boolean; prefix: string },
): Promise<ExpandScanTarget[]> {
  try {
    return await scanExpandButtons(page, opts);
  } catch (err) {
    logger.debug(
      `Expand scan failed: ${err instanceof Error ? err.message.split("\n")[0] : String(err)}`,
    );
    return [];
  }
}

/**
 * Expand truncated review and owner-response texts by clicking their "More"
 * buttons, using mark-and-confirm (docs/selector-maintenance.md §5):
 *
 * 1. Scan: mark every pending button in cards not in `skipIds` with a token.
 * 2. Click each token and confirm the button is gone, hidden or
 *    `aria-expanded="true"`. Identity is the element itself, so Google
 *    removing clicked buttons cannot shift which button is clicked next.
 * 3. Up to EXPAND_MAX_PASSES passes; later passes re-mark whatever is still
 *    pending (re-rendered cards, late buttons, failed clicks).
 *
 * `skipIds` should hold already-collected reviews so a stuck button costs at
 * most EXPAND_MAX_PASSES clicks in the cycle it appears in. The result is for
 * logging only – the truncation warning comes from `expandPending` at
 * extraction time.
 */
export async function expandAllReviews(
  page: Page,
  skipIds: ReadonlySet<string> = new Set(),
): Promise<ExpandResult> {
  const skip = [...skipIds];
  const runId = Date.now().toString(36);
  let attempted = 0;
  let expanded = 0;

  for (let pass = 1; pass <= EXPAND_MAX_PASSES; pass++) {
    const prefix = `exp-${runId}-${pass}`;
    if (!EXPAND_TOKEN_RE.test(prefix)) {
      throw new Error(`Invalid expand token prefix: ${prefix}`);
    }
    const targets = await safeScan(page, { skipIds: skip, stamp: true, prefix });
    if (targets.length === 0) break;
    for (const { token } of targets) {
      if (token === null) continue;
      attempted++;
      if (await clickMarked(page, token)) expanded++;
    }
  }

  const remaining = await safeScan(page, { skipIds: skip, stamp: false, prefix: "" });
  const pendingReviewIds = new Set(
    remaining.flatMap((t) => (t.reviewId === null ? [] : [t.reviewId])),
  );

  if (attempted > 0 || pendingReviewIds.size > 0) {
    logger.debug(
      `Expanded ${expanded}/${attempted} truncated texts (${pendingReviewIds.size} still pending)`,
    );
  }
  return { attempted, expanded, pendingReviewIds };
}

/**
 * Extract all currently visible reviews from the DOM in a single evaluate() call.
 * Selectors are passed as arguments to keep them centralized in selectors.ts.
 * Each review carries `expandPending`: whether its card still had a pending
 * "More" button (same predicate as `scanExpandButtons`) when it was read.
 */
export async function extractReviews(page: Page): Promise<ExtractedReview[]> {
  const sel = {
    expandButton: SELECTORS.expandButton,
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
      expandPending: boolean;
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

        // Same "pending" predicate as scanExpandButtons (closures cannot share code).
        const expandPending = Array.from(
          card.querySelectorAll(s.expandButton),
        ).some(
          (btn) =>
            btn.getClientRects().length > 0 &&
            btn.getAttribute("aria-expanded") !== "true",
        );

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
            expandPending,
          });
        }
      } catch {
        // Skip malformed review card
      }
    }

    return out;
  }, sel);

  // Resolve the original language from the raw button text on the Node side.
  const reviews: ExtractedReview[] = results.map((r) => ({
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
    expandPending: r.expandPending,
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
