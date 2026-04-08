import { parseGoogleMapsInput } from "../utils/url.js";
import { logger } from "../utils/logger.js";
import { launchBrowser, closeBrowser, trackBrowser } from "./browser.js";
import { navigateToReviews } from "./navigator.js";
import { scrollAndCollectReviews } from "./scroller.js";
import type { ScrapeResult, Review } from "../core/schema.js";

export interface ScrapeLocationOptions {
  sort: string;
  maxReviews?: number;
  headed: boolean;
  delay: number;
}

export async function scrapeLocation(
  url: string,
  options: ScrapeLocationOptions,
): Promise<ScrapeResult> {
  const parsed = parseGoogleMapsInput(url);
  const startTime = Date.now();
  const { browser, page } = await launchBrowser({ headed: options.headed });
  trackBrowser(browser);

  try {
    const businessInfo = await navigateToReviews(page, parsed, options.sort);
    logger.info(
      `Found: ${businessInfo.name} (${businessInfo.totalReviews ?? "?"} reviews)`,
    );

    const reviews: Review[] = await scrollAndCollectReviews(page, {
      maxReviews: options.maxReviews,
      delayMs: options.delay,
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
    await closeBrowser(browser);
  }
}
