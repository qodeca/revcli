import { parseGoogleMapsInput } from "../utils/url.js";
import { logger } from "../utils/logger.js";
import { writeJson } from "../output/json.js";
import { launchBrowser, closeBrowser } from "../scraper/browser.js";
import { navigateToReviews } from "../scraper/navigator.js";
import { scrollAndCollectReviews } from "../scraper/scroller.js";
import type { ScrapeResult, Review } from "../core/schema.js";

export interface ScrapeOptions {
  maxReviews?: number;
  sort: string;
  output?: string;
  format: string;
  headed: boolean;
  delay: number;
}

export async function scrapeCommand(
  input: string,
  options: ScrapeOptions,
): Promise<void> {
  const parsed = parseGoogleMapsInput(input);
  logger.info(`Scraping reviews from: ${parsed.url}`);

  const startTime = Date.now();
  const { browser, page } = await launchBrowser({ headed: options.headed });

  try {
    const businessInfo = await navigateToReviews(page, parsed, options.sort);
    logger.info(
      `Found: ${businessInfo.name} (${businessInfo.totalReviews ?? "?"} reviews)`,
    );

    const reviews: Review[] = await scrollAndCollectReviews(page, {
      maxReviews: options.maxReviews,
      delayMs: options.delay,
    });

    const result: ScrapeResult = {
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

    await writeJson(result, options.output ?? null);
    logger.success(
      `Collected ${reviews.length} reviews in ${((Date.now() - startTime) / 1000).toFixed(1)}s`,
    );
  } finally {
    await closeBrowser(browser);
  }
}
