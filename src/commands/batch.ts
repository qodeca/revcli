import { readFile, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { isGoogleMapsUrl } from "../utils/url.js";
import { logger } from "../utils/logger.js";
import { writeJson } from "../output/json.js";
import { writeCsv } from "../output/csv.js";
import { scrapeLocation } from "../scraper/scrape-location.js";
import { withRetry } from "../core/retry.js";
import { RateLimiter } from "../core/rate-limiter.js";
import { BatchProgress } from "../utils/progress.js";

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
  const content = await readFile(file, "utf-8");
  const urls = parseInputFile(content);

  if (urls.length === 0) {
    logger.error("No valid Google Maps URLs found in input file");
    process.exitCode = 1;
    return;
  }

  logger.info(`Found ${urls.length} locations to scrape`);

  await mkdir(options.outputDir, { recursive: true });

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
        () =>
          scrapeLocation(url, {
            sort: options.sort,
            maxReviews: options.maxReviews,
            headed: options.headed,
            delay: options.delay,
          }),
        url,
        { maxRetries: 2 },
      );

      const ext = options.format === "csv" ? ".csv" : ".json";
      const filename = slugify(result.business.name) + ext;
      const outputPath = join(options.outputDir, filename);

      if (options.format === "csv") {
        await writeCsv(result, outputPath);
      } else {
        await writeJson(result, outputPath);
      }

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

  if (progress.failedCount > 0) {
    process.exitCode = 1;
  }
}

export function parseInputFile(content: string): string[] {
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

export function slugify(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/['']/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  if (slug.length === 0) {
    // Non-Latin names produce empty slugs – use hash fallback
    return createHash("sha256").update(name).digest("hex").slice(0, 12);
  }

  return slug;
}
