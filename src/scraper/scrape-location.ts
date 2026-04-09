import type { ParsedUrl } from "../utils/url.js";
import { logger } from "../utils/logger.js";
import { launchBrowser, closeBrowser, trackBrowser } from "./browser.js";
import { navigateToReviews } from "./navigator.js";
import { scrollAndCollectReviews } from "./scroller.js";
import { hasLimitedView, waitForUserAuth } from "./auth.js";
import { SORT_ORDERS } from "../core/schema.js";
import type { ScrapeResult, Review, SortOrder } from "../core/schema.js";

export interface ScrapeLocationOptions {
  sort: SortOrder;
  maxReviews?: number;
  headless: boolean;
  delay: number;
}

/**
 * Build a list of additional sort orders to try when the primary sort
 * is exhausted but maxReviews hasn't been reached. Each sort order
 * surfaces a different subset of reviews from Google's virtualized list.
 */
function getExtraSortOrders(primarySort: SortOrder): SortOrder[] {
  return SORT_ORDERS.filter((s) => s !== primarySort && s !== "relevant");
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
      `Found: ${businessInfo.name} (${businessInfo.totalReviews ?? "?"} reviews)`,
    );

    const reviews: Review[] = await scrollAndCollectReviews(page, {
      maxReviews: options.maxReviews,
      delayMs: options.delay,
      extraSortOrders: getExtraSortOrders(options.sort),
    });

    return {
      business: {
        ...businessInfo,
        scrapeDate: new Date().toISOString(),
      },
      reviews,
      metadata: {
        provider: "playwright",
        scrapeDurationMs: Date.now() - startTime,
        reviewsCollected: reviews.length,
        sortOrder: options.sort,
      },
    };
  } finally {
    await closeBrowser(context);
  }
}
