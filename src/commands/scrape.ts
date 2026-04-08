import { parseGoogleMapsInput } from "../utils/url.js";
import { logger } from "../utils/logger.js";
import { writeOutput } from "../output/write.js";
import { scrapeLocation } from "../scraper/scrape-location.js";
import { withRetry } from "../core/retry.js";

import type { SortOrder, OutputFormat } from "../core/schema.js";

export interface ScrapeOptions {
  maxReviews?: number;
  sort: SortOrder;
  output?: string;
  format: OutputFormat;
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
      scrapeLocation(parsed, {
        sort: options.sort,
        maxReviews: options.maxReviews,
        headed: options.headed,
        delay: options.delay,
      }),
    "scrape",
    { maxRetries: 2 },
  );

  await writeOutput(result, options.output ?? null, options.format);
  logger.success(
    `Collected ${result.reviews.length} reviews in ${((Date.now() - startTime) / 1000).toFixed(1)}s`,
  );
}
