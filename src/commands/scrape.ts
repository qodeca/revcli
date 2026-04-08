import { parseGoogleMapsInput } from "../utils/url.js";
import { logger } from "../utils/logger.js";
import { writeJson } from "../output/json.js";
import { writeCsv } from "../output/csv.js";
import { launchBrowser, closeBrowser } from "../scraper/browser.js";
import { navigateToReviews } from "../scraper/navigator.js";
import { scrollAndCollectReviews } from "../scraper/scroller.js";
import { withRetry } from "../core/retry.js";
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

  const result = await withRetry(
    async () => {
      const { browser, page } = await launchBrowser({
        headed: options.headed,
      });

      try {
        const businessInfo = await navigateToReviews(
          page,
          parsed,
          options.sort,
        );
        logger.info(
          `Found: ${businessInfo.name} (${businessInfo.totalReviews ?? "?"} reviews)`,
        );

        const reviews: Review[] = await scrollAndCollectReviews(page, {
          maxReviews: options.maxReviews,
          delayMs: options.delay,
        });

        const scrapeResult: ScrapeResult = {
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

        return scrapeResult;
      } finally {
        await closeBrowser(browser);
      }
    },
    "scrape",
    { maxRetries: 2 },
  );

  const outputPath = options.output ?? null;
  if (options.format === "csv") {
    await writeCsv(result, outputPath);
  } else {
    await writeJson(result, outputPath);
  }
  logger.success(
    `Collected ${result.reviews.length} reviews in ${((Date.now() - startTime) / 1000).toFixed(1)}s`,
  );
}
