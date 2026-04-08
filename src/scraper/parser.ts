import type { RawReview } from "./extractor.js";
import type { Review } from "../core/schema.js";
import { ReviewSchema, generateReviewId } from "../core/schema.js";
import { logger } from "../utils/logger.js";

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

    // Determine original vs translated text
    let text = raw.text;
    let originalText = raw.originalText;
    let originalLanguage: string | null = null;

    if (originalText && text) {
      originalLanguage = detectLanguage(originalText);
    } else if (text) {
      originalText = text;
      originalLanguage = detectLanguage(text);
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
            originalText: raw.ownerResponseText,
            originalLanguage: detectLanguage(raw.ownerResponseText),
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
