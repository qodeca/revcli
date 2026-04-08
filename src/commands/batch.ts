import { readFile, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { existsSync } from "node:fs";
import { parseGoogleMapsInput, isGoogleMapsUrl } from "../utils/url.js";
import { logger } from "../utils/logger.js";
import { writeJson } from "../output/json.js";
import { launchBrowser, closeBrowser } from "../scraper/browser.js";
import { navigateToReviews } from "../scraper/navigator.js";
import { scrollAndCollectReviews } from "../scraper/scroller.js";
import { withRetry } from "../core/retry.js";
import { RateLimiter } from "../core/rate-limiter.js";
import { BatchProgress } from "../utils/progress.js";
import type { ScrapeResult, Review } from "../core/schema.js";

export interface BatchOptions {
  outputDir: string;
  maxReviews?: number;
  sort: string;
  format: string;
  headed: boolean;
  delay: number;
  resume: boolean;
  locationDelay: number;
}

interface BatchState {
  completed: string[];
}

export async function batchCommand(
  file: string,
  options: BatchOptions,
): Promise<void> {
  // Read and parse input file
  const content = await readFile(file, "utf-8");
  const urls = parseInputFile(content);

  if (urls.length === 0) {
    logger.error("No valid Google Maps URLs found in input file");
    return;
  }

  logger.info(`Found ${urls.length} locations to scrape`);

  // Ensure output directory exists
  await mkdir(options.outputDir, { recursive: true });

  // Load resume state if applicable
  const stateFile = join(options.outputDir, ".revcli-state.json");
  let state: BatchState = { completed: [] };
  if (options.resume && existsSync(stateFile)) {
    state = JSON.parse(await readFile(stateFile, "utf-8"));
    logger.info(`Resuming: ${state.completed.length} locations already done`);
  }

  const remaining = urls.filter((url) => !state.completed.includes(url));
  if (remaining.length === 0) {
    logger.success("All locations already scraped");
    return;
  }

  const progress = new BatchProgress(remaining.length);
  const rateLimiter = new RateLimiter(options.locationDelay);

  for (const url of remaining) {
    await rateLimiter.wait();

    try {
      const result = await withRetry(
        () => scrapeLocation(url, options),
        url,
        { maxRetries: 2 },
      );

      // Generate filename from business name
      const filename = slugify(result.business.name) + ".json";
      const outputPath = join(options.outputDir, filename);
      await writeJson(result, outputPath);

      progress.success(result.business.name, result.reviews.length);
      state.completed.push(url);
      await writeFile(stateFile, JSON.stringify(state, null, 2));
    } catch (error) {
      const message =
        error instanceof Error ? error.message : String(error);
      progress.failure(url, message);
    }
  }

  progress.summary();
}

async function scrapeLocation(
  url: string,
  options: BatchOptions,
): Promise<ScrapeResult> {
  const parsed = parseGoogleMapsInput(url);
  const startTime = Date.now();
  const { browser, page } = await launchBrowser({ headed: options.headed });

  try {
    const businessInfo = await navigateToReviews(page, parsed, options.sort);
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

function parseInputFile(content: string): string[] {
  // Try JSON array first
  try {
    const parsed = JSON.parse(content);
    if (Array.isArray(parsed)) {
      return parsed.filter(
        (item: unknown) => typeof item === "string" && isGoogleMapsUrl(item),
      );
    }
  } catch {
    // Not JSON – treat as newline-delimited
  }

  return content
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"))
    .filter(isGoogleMapsUrl);
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/['']/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
