import type { Page } from "playwright";
import type { ParsedUrl } from "../utils/url.js";
import type { Business } from "../core/schema.js";
import { logger } from "../utils/logger.js";
import { SELECTORS } from "./selectors.js";
import { parseReviewCount } from "./parser.js";

/** Max chars of the fallback body snippet to cross the browser/Node boundary. Defense-in-depth against hostile/compromised DOM content feeding multi-MB strings to the parser. */
const BODY_SNIPPET_MAX_CHARS = 10_000;

/** Max chars of any raw DOM string to include in debug logs. Prevents log bloat while preserving enough context to diagnose parser failures. */
const DEBUG_LOG_SNIPPET_CHARS = 200;

/**
 * Parse a raw rating text blob (e.g. "4.5 stars" or the textContent of a
 * rating span) into a number in [0, 5]. Returns null on failure.
 *
 * Under revcli's hl=en invariant Google Maps renders ratings with a period
 * decimal separator ("4.5 stars"), but we tolerate comma as well as a
 * defensive hedge. Zero is a VALID rating, not a sentinel – callers should
 * treat null as "could not parse" and preserve the BusinessSchema's
 * nullable semantics.
 */
export function parseRatingText(text: string | null): number | null {
  if (!text) return null;
  // Lookbehind rejects a leading minus so "-1" does not match "1" – aria-labels
  // never contain negative ratings, but the gap is cheap to close.
  const match = text.match(/(?<![-\d])(\d+(?:[.,]\d+)?)/);
  if (!match) return null;
  const normalized = match[1].replace(",", ".");
  const parsed = parseFloat(normalized);
  if (Number.isNaN(parsed) || parsed < 0 || parsed > 5) return null;
  return parsed;
}

/**
 * PII scrub for debug logs. Preserves digits, common numeric separators,
 * whitespace, the K/M/B magnitude suffixes, and the letters of "reviews"
 * (case-insensitive) so the header parser's decision path stays visible
 * in `--verbose` output. Everything else – including reviewer display names
 * and review body text – is replaced with a middle dot (·) so users can
 * safely paste log output into bug reports without leaking PII.
 */
function scrubForLog(text: string | null | undefined): string | null {
  if (!text) return null;
  return text.replace(/[^\dkKmMbB,.\sreviwsREVIWS]/g, "·");
}

type ReviewCountSource = "tabText" | "badgeText" | "bodySnippet";

export async function extractBusinessInfo(
  page: Page,
  parsed: ParsedUrl,
): Promise<Omit<Business, "scrapeDate" | "headerTotalReviews">> {
  const info = await page.evaluate(
    ({
      addressSel,
      tabSel,
      reviewBadgeSel,
      mainRegionSel,
      bodySnippetMaxChars,
    }) => {
      const name =
        document.querySelector("h1")?.textContent?.trim() ?? "Unknown";

      // Rating – return raw text only. Primary: role="img" aria-label
      // containing "star". Fallback: plain text span with `\d.\d` pattern
      // and aria-hidden="true". Parsing happens on the Node side.
      let ratingText: string | null = null;
      const ratingEl = document.querySelector(
        '[role="img"][aria-label*="star"]',
      );
      if (ratingEl) {
        ratingText = ratingEl.getAttribute("aria-label");
      }
      if (!ratingText) {
        const spans = document.querySelectorAll("span");
        for (const s of spans) {
          const text = s.textContent?.trim() ?? "";
          if (
            /^\d\.\d$/.test(text) &&
            s.getAttribute("aria-hidden") === "true"
          ) {
            ratingText = text;
            break;
          }
        }
      }

      // Review count candidates – all raw strings, no parsing here.
      const tabButtons = Array.from(document.querySelectorAll(tabSel));
      const reviewTabText =
        tabButtons
          .map((t) => t.textContent?.trim() ?? "")
          .find((t) => /review/i.test(t)) ?? null;

      const mainRegion = document.querySelector(mainRegionSel);
      const badgeEl = mainRegion?.querySelector(reviewBadgeSel) ?? null;
      const reviewBadgeText = badgeEl?.getAttribute("aria-label") ?? null;

      // Scope the body-text fallback to [role="main"] so we don't pick up
      // review-count digits from reviewer profile sidebars or unrelated chrome.
      // Defense-in-depth: cap the snippet before it crosses the browser/Node boundary
      // so a compromised or adversarial Google Maps page cannot feed a multi-MB string
      // into the header parser. The cap is orders of magnitude larger than any
      // legitimate header chrome and bounds the worst case to ~O(N) regex work.
      const reviewBodySnippet =
        mainRegion?.textContent?.trim().slice(0, bodySnippetMaxChars) ?? null;

      const addressEl = document.querySelector(addressSel);
      const address = addressEl?.textContent?.trim() ?? null;

      return {
        name,
        address,
        ratingText,
        reviewTabText,
        reviewBadgeText,
        reviewBodySnippet,
      };
    },
    {
      addressSel: SELECTORS.addressButton,
      tabSel: SELECTORS.tab,
      reviewBadgeSel: SELECTORS.reviewBadge,
      mainRegionSel: SELECTORS.mainRegion,
      bodySnippetMaxChars: BODY_SNIPPET_MAX_CHARS,
    },
  );

  logger.debug(
    `raw reviewTabText (PII-scrubbed): ${JSON.stringify(scrubForLog(info.reviewTabText))}`,
  );
  logger.debug(
    `raw reviewBadgeText (PII-scrubbed): ${JSON.stringify(scrubForLog(info.reviewBadgeText))}`,
  );
  logger.debug(
    `raw reviewBodySnippet (first ${DEBUG_LOG_SNIPPET_CHARS} chars, PII-scrubbed): ${JSON.stringify(scrubForLog(info.reviewBodySnippet)?.slice(0, DEBUG_LOG_SNIPPET_CHARS))}`,
  );
  // ratingText is a bounded Google aria-label (e.g. "Rated 4.5 out of 5 stars") – low PII risk, left unscrubbed to preserve debug visibility on rating failures.
  logger.debug(`raw ratingText: ${JSON.stringify(info.ratingText)}`);

  const rating = parseRatingText(info.ratingText);
  if (info.ratingText && rating === null) {
    logger.warn(
      `Could not parse rating from text: ${JSON.stringify(info.ratingText)}`,
    );
  }

  let totalReviews: number | null = null;
  let parseSource: ReviewCountSource | null = null;

  if (info.reviewTabText) {
    const parsed = parseReviewCount(info.reviewTabText);
    if (parsed !== null) {
      totalReviews = parsed;
      parseSource = "tabText";
    }
  }
  if (totalReviews === null && info.reviewBadgeText) {
    const parsed = parseReviewCount(info.reviewBadgeText);
    if (parsed !== null) {
      totalReviews = parsed;
      parseSource = "badgeText";
    }
  }
  if (totalReviews === null && info.reviewBodySnippet) {
    const parsed = parseReviewCount(info.reviewBodySnippet);
    if (parsed !== null) {
      totalReviews = parsed;
      parseSource = "bodySnippet";
    }
  }

  if (totalReviews === null) {
    logger.warn(
      `Could not extract review count from header — selector may be stale (see debug logs for raw strings)`,
    );
  } else {
    logger.debug(
      `parsed totalReviews=${totalReviews} from source="${parseSource}"`,
    );
  }

  if (info.name === "Unknown") {
    logger.warn("Could not extract business name – selector may be stale");
  }

  return {
    name: info.name,
    placeId: parsed.placeId ?? null,
    url: parsed.url,
    address: info.address,
    rating,
    totalReviews,
  };
}
