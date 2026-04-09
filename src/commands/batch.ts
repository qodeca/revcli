import { readFile, mkdir, writeFile, rename } from "node:fs/promises";
import { join } from "node:path";
import { existsSync } from "node:fs";
import { z } from "zod";
import { createHash } from "node:crypto";
import { isGoogleMapsUrl, parseGoogleMapsInput } from "../utils/url.js";
import { logger } from "../utils/logger.js";
import { writeOutput } from "../output/write.js";
import { scrapeLocation } from "../scraper/scrape-location.js";
import { withRetry } from "../core/retry.js";
import { RateLimiter } from "../core/rate-limiter.js";
import { BatchProgress } from "../utils/progress.js";
import type { SortOrder, OutputFormat } from "../core/schema.js";

export interface BatchOptions {
  outputDir: string;
  maxReviews?: number;
  sort: SortOrder;
  format: OutputFormat;
  headless: boolean;
  delay: number;
  resume: boolean;
  locationDelay: number;
  locationTimeout: number;
}

const BatchStateSchema = z.object({
  completed: z.array(z.string()),
});
type BatchState = z.infer<typeof BatchStateSchema>;

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
    try {
      const raw = JSON.parse(await readFile(stateFile, "utf-8"));
      const parsed = BatchStateSchema.safeParse(raw);
      if (parsed.success) {
        state = parsed.data;
        logger.info(`Resuming: ${state.completed.length} locations already done`);
      } else {
        logger.warn("Corrupted state file – starting fresh");
      }
    } catch {
      logger.warn("Could not read state file – starting fresh");
    }
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
      const parsed = parseGoogleMapsInput(url);
      const scrapePromise = withRetry(
        () =>
          scrapeLocation(parsed, {
            sort: options.sort,
            maxReviews: options.maxReviews,
            headless: options.headless,
            delay: options.delay,
          }),
        url,
        { maxRetries: 2 },
      );
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error(`Location timeout after ${options.locationTimeout / 1000}s`)),
          options.locationTimeout,
        ),
      );
      const result = await Promise.race([scrapePromise, timeoutPromise]);

      const ext = options.format === "csv" ? ".csv" : ".json";
      const baseSlug = slugify(result.business.name);
      const filename = deduplicateFilename(options.outputDir, baseSlug, ext);
      const outputPath = join(options.outputDir, filename);

      await writeOutput(result, outputPath, options.format);

      progress.success(result.business.name, result.reviews.length);
      state.completed.push(url);
      const tmpFile = stateFile + ".tmp";
      await writeFile(tmpFile, JSON.stringify(state, null, 2));
      await rename(tmpFile, stateFile);
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
      const results: string[] = [];
      for (const item of parsed) {
        if (typeof item === "string" && isGoogleMapsUrl(item)) {
          results.push(item);
        } else if (typeof item === "string" && item.trim().length > 0) {
          logger.warn(`Skipping invalid URL: ${item}`);
        }
      }
      return results;
    }
  } catch {
    // Not JSON – treat as newline-delimited
  }

  const results: string[] = [];
  for (const rawLine of content.split("\n")) {
    const line = rawLine.trim();
    if (line.length === 0 || line.startsWith("#")) continue;
    if (isGoogleMapsUrl(line)) {
      results.push(line);
    } else {
      logger.warn(`Skipping invalid URL: ${line}`);
    }
  }
  return results;
}

export function deduplicateFilename(
  dir: string,
  baseSlug: string,
  ext: string,
): string {
  let candidate = baseSlug + ext;
  let counter = 2;
  while (existsSync(join(dir, candidate))) {
    candidate = `${baseSlug}-${counter}${ext}`;
    counter++;
  }
  return candidate;
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
