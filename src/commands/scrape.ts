import { parseGoogleMapsInput } from "../utils/url.js";
import { logger } from "../utils/logger.js";
import { writeJson } from "../output/json.js";
import { writeCsv } from "../output/csv.js";
import { scrapeLocation } from "../scraper/scrape-location.js";
import { withRetry } from "../core/retry.js";

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
    () =>
      scrapeLocation(parsed.url, {
        sort: options.sort,
        maxReviews: options.maxReviews,
        headed: options.headed,
        delay: options.delay,
      }),
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
