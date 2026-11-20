import { readFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { existsSync } from "node:fs";
import { z } from "zod";
import { createHash } from "node:crypto";
import { isGoogleMapsUrl, parseGoogleMapsInput, type ParsedUrl } from "../utils/url.js";
import { logger } from "../utils/logger.js";
import { writeOutput } from "../output/write.js";
import { writeFileAtomic } from "../output/atomic.js";
import {
  scrapeLocation,
  type ScrapeLocationOptions,
} from "../scraper/scrape-location.js";
import { closeAllBrowsers } from "../scraper/browser.js";
import { withRetry } from "../core/retry.js";
import { runWithTimeout } from "../core/timeout.js";
import { shutdownSignal } from "../core/shutdown.js";
import { hasUnrecoverableKind } from "../core/errors.js";
import { safeErrorMessage } from "../core/fatal.js";
import { RateLimiter } from "../core/rate-limiter.js";
import { BatchProgress } from "../utils/progress.js";
import type { SortOrder, OutputFormat, ScrapeResult } from "../core/schema.js";

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
export type BatchState = z.infer<typeof BatchStateSchema>;

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

  const { progress, stoppedOnStuckBrowser } = await runBatchLocations(
    remaining,
    options,
    { state, stateFile, signal: shutdownSignal },
    { scrape: (parsed, signal) => scrapeLocation(parsed, scrapeOptions(options), signal) },
  );

  progress.summary();

  if (progress.failedCount > 0) {
    process.exitCode = 1;
  }

  if (stoppedOnStuckBrowser) {
    // The stuck browser keeps the process alive; close what we can, then end.
    await Promise.race([
      closeAllBrowsers(),
      new Promise((resolve) => setTimeout(resolve, STUCK_CLOSE_MS)),
    ]);
    // Let the summary reach a pipe (`| tee log`) before exiting.
    await new Promise<void>((resolve) => process.stdout.write("", () => resolve()));
    await new Promise<void>((resolve) => process.stderr.write("", () => resolve()));
    process.exit(1);
  }
}

/** How long to try closing a stuck browser before exiting anyway. */
const STUCK_CLOSE_MS = 5_000;

function scrapeOptions(options: BatchOptions): ScrapeLocationOptions {
  return {
    sort: options.sort,
    maxReviews: options.maxReviews,
    headless: options.headless,
    delay: options.delay,
  };
}

/** What `runBatchLocations` needs from the outside world. */
export interface BatchRunDeps {
  /**
   * Scrape one place. Required, with no default, so a test can never fall
   * back to the real scrape (which opens the ~/.revcli credential store).
   * Must stop and release its browser when `signal` aborts.
   */
  scrape: (parsed: ParsedUrl, signal: AbortSignal) => Promise<ScrapeResult>;
}

export interface BatchRunResult {
  progress: BatchProgress;
  /** True when the batch stopped because a timed-out browser did not close. */
  stoppedOnStuckBrowser: boolean;
}

/**
 * Scrape each URL in turn, writing one output file per place and recording it
 * in the resume state. Exported (with an injected `scrape`) for testing.
 */
export async function runBatchLocations(
  remaining: string[],
  options: BatchOptions,
  run: {
    state: BatchState;
    stateFile: string;
    /** Stops the batch (and the running scrape) when aborted – the shutdown signal. */
    signal?: AbortSignal;
    /** Override of SETTLE_GRACE_MS (tests). */
    settleGraceMs?: number;
  },
  deps: BatchRunDeps,
): Promise<BatchRunResult> {
  const { state, stateFile } = run;
  const progress = new BatchProgress(remaining.length);
  const rateLimiter = new RateLimiter(options.locationDelay);

  for (const [index, url] of remaining.entries()) {
    if (run.signal?.aborted) break;
    await rateLimiter.wait();
    if (run.signal?.aborted) break;

    try {
      const parsed = parseGoogleMapsInput(url);
      // The timeout really stops the scrape and waits until its browser is
      // closed, so the next place never meets a browser still holding the
      // shared profile (issue #33).
      const result = await runWithTimeout(
        (signal) =>
          withRetry(() => deps.scrape(parsed, signal), url, { maxRetries: 2, signal }),
        {
          timeoutMs: options.locationTimeout,
          signal: run.signal,
          settleGraceMs: run.settleGraceMs,
        },
      );

      const ext = options.format === "csv" ? ".csv" : ".json";
      const baseSlug = slugify(result.business.name);
      const filename = deduplicateFilename(options.outputDir, baseSlug, ext);
      const outputPath = join(options.outputDir, filename);

      await writeOutput(result, outputPath, options.format);

      progress.success(result.business.name, result.reviews.length);
      state.completed.push(url);
      await writeFileAtomic(stateFile, JSON.stringify(state, null, 2));
    } catch (error) {
      // Call log removed: Playwright errors can print element markup.
      progress.failure(url, safeErrorMessage(error));
      if (hasUnrecoverableKind(error, "BROWSER_NOT_CLOSED")) {
        const notStarted = remaining.slice(index + 1);
        logger.error(
          `Stopping the batch: a browser may still be using the profile. ${notStarted.length} location(s) not started – run again with --resume.`,
        );
        for (const skipped of notStarted) progress.failure(skipped, "not started");
        return { progress, stoppedOnStuckBrowser: true };
      }
    }
  }

  return { progress, stoppedOnStuckBrowser: false };
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
