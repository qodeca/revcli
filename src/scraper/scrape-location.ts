import type { ParsedUrl } from "../utils/url.js";
import { logger } from "../utils/logger.js";
import { launchBrowser, closeBrowser, trackBrowser } from "./browser.js";
import { navigateToReviews } from "./navigator.js";
import { scrollAndCollectReviews } from "./scroller.js";
import { hasLimitedView, waitForUserAuth } from "./auth.js";
import type {
  ScrapeResult,
  Review,
  SortOrder,
  Business,
} from "../core/schema.js";

export interface ScrapeLocationOptions {
  sort: SortOrder;
  maxReviews?: number;
  headless: boolean;
  delay: number;
}

/**
 * Assemble a ScrapeResult from the raw business info (header-derived) and the
 * collected reviews list. Enforces the invariant
 * `business.totalReviews === reviews.length` and preserves the original
 * Google-reported header value as `business.headerTotalReviews`.
 *
 * Exported for direct unit testing – the reconciliation is the entire point
 * of issue #5 and must be pinned by vitest, not relied on via manual
 * verification.
 *
 * Pure function: no side effects, no Playwright, no IO. Does not mutate
 * its inputs.
 */
export function assembleScrapeResult(
  businessInfo: Omit<Business, "scrapeDate" | "headerTotalReviews">,
  reviews: Review[],
  ctx: {
    scrapeDate: string;
    scrapeDurationMs: number;
    sortOrder: SortOrder;
  },
): ScrapeResult {
  const { totalReviews: headerTotalReviews, ...rest } = businessInfo;
  return {
    business: {
      ...rest,
      totalReviews: reviews.length,
      headerTotalReviews,
      scrapeDate: ctx.scrapeDate,
    },
    reviews,
    metadata: {
      provider: "playwright",
      scrapeDurationMs: ctx.scrapeDurationMs,
      reviewsCollected: reviews.length,
      sortOrder: ctx.sortOrder,
    },
  };
}

export async function scrapeLocation(
  parsed: ParsedUrl,
  options: ScrapeLocationOptions,
): Promise<ScrapeResult> {
  const startTime = Date.now();
  const { context, page } = await launchBrowser({
    headless: options.headless,
  });
  trackBrowser(context);

  try {
    const businessInfo = await navigateToReviews(page, parsed, options.sort);

    // Check for limited view after navigation
    if (await hasLimitedView(page)) {
      if (options.headless) {
        throw new Error(
          "Google Maps is showing a limited view (no Reviews tab). " +
            "Run `revcli auth` first to sign in, or run without --headless.",
        );
      }
      await waitForUserAuth(page);

      // Re-navigate after sign-in
      await navigateToReviews(page, parsed, options.sort);
    }

    logger.info(
      `Found: ${businessInfo.name} (header reports ${businessInfo.totalReviews ?? "?"} reviews)`,
    );

    const reviews: Review[] = await scrollAndCollectReviews(page, {
      maxReviews: options.maxReviews,
      delayMs: options.delay,
    });

    return assembleScrapeResult(businessInfo, reviews, {
      scrapeDate: new Date().toISOString(),
      scrapeDurationMs: Date.now() - startTime,
      sortOrder: options.sort,
    });
  } finally {
    await closeBrowser(context);
  }
}
