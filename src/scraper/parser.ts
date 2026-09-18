import type { RawReview } from "./extractor.js";
import type { Review } from "../core/schema.js";
import { ReviewSchema, generateReviewId } from "../core/schema.js";
import { logger } from "../utils/logger.js";

/**
 * Parse the review count from header-ish text such as "1,568 reviews" or "Reviews 1,568".
 *
 * Scoped to text that already contains the word "review" (case-insensitive).
 * Relies on revcli's hl=en invariant – English locale, comma thousand-separator.
 * Non-ASCII separators (NBSP, NNBSP, thin space, regular space) are tolerated
 * as a defensive hedge against DOM layout surprises. Period separators
 * (e.g. "1.568") are REJECTED because under hl=en a period always means a decimal,
 * not a thousands group. K/M/B suffix forms (e.g. "1.6K reviews") are REJECTED
 * and return null – the reconciliation at scrape assembly will fall back to
 * reviews.length so the user-visible count is still correct.
 *
 * Returns null when: empty/whitespace input, no "review" keyword, no digits,
 * or a suffix form detected. The digit-run regex only matches non-negative
 * integers, so NaN is the only parse failure possible (a defensive negative
 * guard remains but is unreachable).
 */
export function parseReviewCount(text: string): number | null {
  if (!text || text.trim().length === 0) return null;

  const normalized = text
    .replace(/\u00a0/g, " ")
    .replace(/\u202f/g, " ")
    .replace(/\u2009/g, " ");

  if (!/review/i.test(normalized)) return null;

  // Reject K/M/B suffix forms – reconciliation will overwrite from reviews.length.
  if (/\d\s*[kKmMbB](\s|\b)/.test(normalized)) return null;

  // Reject any decimal number (digit.digit). Under hl=en a period always means
  // decimal, never a thousands separator, so this is unambiguous.
  if (/\d+\.\d/.test(normalized)) return null;

  // Allow optional non-alphanumeric punctuation (e.g. ")") between the digit
  // run and the "reviews" keyword, so "(1,234) reviews" parses cleanly.
  const preKeyword = normalized.match(
    /([\d][\d,\s]*\d|\d)[^\w\d]*\s*reviews?\b/i,
  );
  const postKeyword = preKeyword
    ? null
    : normalized.match(/reviews?[^\w\d]*\s+([\d][\d,\s]*\d|\d)/i);

  const candidate = preKeyword?.[1] ?? postKeyword?.[1];
  if (!candidate) return null;

  const cleaned = candidate.replace(/[,\s]/g, "");
  const parsed = parseInt(cleaned, 10);
  if (Number.isNaN(parsed) || parsed < 0) return null;

  return parsed;
}

/**
 * Detect the likely script/language of a text string.
 * Simple heuristic – only distinguishes Arabic vs Latin script.
 * Returns lowercase language hint, not ISO 639 code.
 */
export function detectLanguage(text: string): string | null {
  if (!text) return null;

  const arabicChars = text.match(/[\u0600-\u06FF]/g)?.length ?? 0;
  const latinChars = text.match(/[a-zA-Z]/g)?.length ?? 0;
  const totalChars = arabicChars + latinChars;

  if (totalChars === 0) return "unknown";
  if (arabicChars > totalChars * 0.5) return "arabic";
  if (latinChars > totalChars * 0.5) return "english";
  return "mixed";
}

/**
 * Transform a raw extracted review into a validated Review object.
 */
export function parseReview(raw: RawReview): Review | null {
  try {
    // Use Google's review ID if available, fallback to hash with text prefix
    const id =
      raw.reviewId ||
      generateReviewId(
        raw.author,
        raw.publishTime,
        raw.rating,
        raw.text?.slice(0, 50),
      );

    // Determine original vs translated text. The extractor sets
    // originalText/originalLanguage ONLY for reviews Google actually translated
    // (detected via the "See original (X)" toggle). A non-translated review has
    // a genuine null originalText – NOT a mirror of the display text, which was
    // the old misleading behavior.
    const text = raw.text;
    const originalText = raw.originalText;
    const originalLanguage = raw.originalLanguage;

    if (raw.rating === 0) {
      logger.warn(
        `Review by "${raw.author}" has rating=0 – stars selector may be stale`,
      );
    }

    const review: Review = {
      id,
      author: raw.author,
      authorUrl: raw.authorUrl,
      publishTime: raw.publishTime,
      rating: raw.rating,
      text,
      originalText,
      originalLanguage,
      photos: raw.photos,
      ownerResponse: raw.ownerResponseText
        ? {
            text: raw.ownerResponseText,
            // Owner responses are not run through the "See original" toggle, so
            // no original text/language is captured. Leaving these null (not a
            // mirror of the display text) keeps the same invariant the review
            // level enforces: original* fields are populated only when a real
            // source is captured.
            originalText: null,
            originalLanguage: null,
            publishTime: raw.ownerResponseTime || null,
          }
        : null,
    };

    const result = ReviewSchema.safeParse(review);
    if (!result.success) {
      logger.warn(
        `Review by "${raw.author}" failed validation: ${result.error.message}`,
      );
      return null;
    }

    return result.data;
  } catch (error) {
    logger.warn(`Failed to parse review by "${raw.author}": ${error}`);
    return null;
  }
}
