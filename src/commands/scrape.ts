import { parseGoogleMapsInput } from "../utils/url.js";
import { logger } from "../utils/logger.js";
import { writeOutput } from "../output/write.js";
import { scrapeLocation } from "../scraper/scrape-location.js";
import { withRetry } from "../core/retry.js";
import { shutdownSignal } from "../core/shutdown.js";

import type { SortOrder, OutputFormat } from "../core/schema.js";

export interface ScrapeOptions {
  maxReviews?: number;
  sort: SortOrder;
  output?: string;
  format: OutputFormat;
  headless: boolean;
  delay: number;
  /** Minutes after which collection stops and the reviews so far are saved. */
  timeLimit?: number;
}

export async function scrapeCommand(
  input: string,
  options: ScrapeOptions,
): Promise<void> {
  const parsed = parseGoogleMapsInput(input);
  logger.info(`Scraping reviews from: ${parsed.url}`);

  const startTime = Date.now();
  const deadline =
    options.timeLimit != null ? startTime + options.timeLimit * 60_000 : undefined;

  const result = await withRetry(
    () =>
      scrapeLocation(parsed, {
        sort: options.sort,
        maxReviews: options.maxReviews,
        headless: options.headless,
        delay: options.delay,
        deadline,
      }, shutdownSignal),
    "scrape",
    // A signal stops the scrape without retries (issue #33).
    { maxRetries: 2, signal: shutdownSignal },
  );

  await writeOutput(result, options.output ?? null, options.format);
  logger.success(
    `Collected ${result.reviews.length} reviews in ${((Date.now() - startTime) / 1000).toFixed(1)}s`,
  );
}
