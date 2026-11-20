import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runBatchLocations, type BatchOptions, type BatchRunDeps } from "../src/commands/batch.js";
import type { ScrapeResult } from "../src/core/schema.js";
import { UnrecoverableError } from "../src/core/errors.js";
import type { ParsedUrl } from "../src/utils/url.js";

/**
 * Issue #33: a place that runs past --location-timeout must be stopped and
 * release its browser before the next place starts. The scrape is a fake, so
 * no browser and no ~/.revcli profile is involved.
 */

const SLOW = "https://www.google.com/maps?ftid=0x1111111111111111:0x2222222222222222";
const FAST = "https://www.google.com/maps?ftid=0x3333333333333333:0x4444444444444444";
const FAST_2 = "https://www.google.com/maps?ftid=0x5555555555555555:0x6666666666666666";

/** Time the fake "browser" takes to close after an abort. */
const CLOSE_MS = 150;

function result(name: string): ScrapeResult {
  return {
    business: {
      name,
      placeId: null,
      url: "https://www.google.com/maps",
      address: null,
      rating: null,
      totalReviews: 0,
      headerTotalReviews: null,
      scrapeDate: new Date(0).toISOString(),
    },
    reviews: [],
    metadata: { provider: "playwright", scrapeDurationMs: 1, reviewsCollected: 0, sortOrder: "newest" },
  };
}

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "revcli-batch-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function options(locationTimeout: number): BatchOptions {
  return {
    outputDir: dir,
    sort: "newest",
    format: "json",
    headless: true,
    delay: 1,
    resume: false,
    locationDelay: 1,
    locationTimeout,
  };
}

/**
 * A fake scrape: SLOW hangs until aborted, then "closes its browser" after
 * CLOSE_MS and rejects; every other URL resolves at once.
 */
function fakeScrape(events: string[], slowName = "Slow"): BatchRunDeps["scrape"] {
  return (parsed: ParsedUrl, signal: AbortSignal) => {
    const name = parsed.url.includes("0x1111") ? slowName : parsed.url.includes("0x3333") ? "Fast" : "Fast 2";
    events.push(`${name} started`);
    if (name !== slowName) return Promise.resolve(result(name));
    return new Promise<ScrapeResult>((_, reject) => {
      signal.addEventListener(
        "abort",
        () =>
          setTimeout(() => {
            events.push(`${name} browser closed`);
            reject(new Error("Target page, context or browser has been closed"));
          }, CLOSE_MS),
        { once: true },
      );
    });
  };
}

describe("runBatchLocations – location timeout (issue #33)", () => {
  it("stops the timed-out place and closes its browser before the next place starts", async () => {
    const events: string[] = [];
    const state = { completed: [] as string[] };

    const { progress } = await runBatchLocations(
      [SLOW, FAST],
      options(200),
      { state, stateFile: join(dir, ".revcli-state.json") },
      { scrape: fakeScrape(events) },
    );

    expect(events).toEqual(["Slow started", "Slow browser closed", "Fast started"]);
    expect(progress.failedCount).toBe(1);
  });

  it("saves the place after a timed-out one, and writes no file for the timed-out place", async () => {
    const state = { completed: [] as string[] };

    await runBatchLocations(
      [SLOW, FAST, FAST_2],
      options(200),
      { state, stateFile: join(dir, ".revcli-state.json") },
      { scrape: fakeScrape([]) },
    );

    const files = readdirSync(dir).filter((f) => f.endsWith(".json") && !f.startsWith("."));
    expect(files.sort()).toEqual(["fast-2.json", "fast.json"]);
    expect(existsSync(join(dir, "slow.json"))).toBe(false);
    expect(state.completed).toEqual([FAST, FAST_2]);
  });

  it("does not write a late result that arrives after the timeout", async () => {
    const state = { completed: [] as string[] };
    const late: BatchRunDeps["scrape"] = () =>
      new Promise((resolve) => setTimeout(() => resolve(result("Late")), 400));

    const { progress } = await runBatchLocations(
      [SLOW],
      options(100),
      { state, stateFile: join(dir, ".revcli-state.json") },
      { scrape: late },
    );
    // Give a late resolve every chance to (wrongly) write.
    await new Promise((r) => setTimeout(r, 500));

    expect(progress.failedCount).toBe(1);
    expect(readdirSync(dir).filter((f) => f.endsWith(".json"))).toEqual([]);
    expect(state.completed).toEqual([]);
  });

  it("stops the batch when the timed-out place does not release its browser", async () => {
    const started: string[] = [];
    const stuck: BatchRunDeps["scrape"] = (parsed) => {
      started.push(parsed.url);
      return new Promise<never>(() => {}); // ignores the abort: browser never closes
    };
    const state = { completed: [] as string[] };

    const { progress, stoppedOnStuckBrowser } = await runBatchLocations(
      [SLOW, FAST, FAST_2],
      options(50),
      { state, stateFile: join(dir, ".revcli-state.json"), settleGraceMs: 100 },
      { scrape: stuck },
    );

    expect(started).toEqual([SLOW]);
    expect(stoppedOnStuckBrowser).toBe(true);
    // The stuck place plus the two never started.
    expect(progress.failedCount).toBe(3);
    expect(state.completed).toEqual([]);
  });

  it("starts no further place once the stop signal is aborted", async () => {
    const controller = new AbortController();
    const started: string[] = [];
    const scrape: BatchRunDeps["scrape"] = async (parsed) => {
      started.push(parsed.url);
      controller.abort(new Error("Received SIGTERM – stopping"));
      return result("Fast");
    };

    await runBatchLocations(
      [FAST, FAST_2],
      options(1_000),
      { state: { completed: [] }, stateFile: join(dir, ".revcli-state.json"), signal: controller.signal },
      { scrape },
    );

    expect(started).toEqual([FAST]);
  });

  it("a stop signal during a place aborts that scrape at once, without waiting for the timeout", async () => {
    const controller = new AbortController();
    let scrapeAborted = false;
    const scrape: BatchRunDeps["scrape"] = (_parsed, signal) =>
      new Promise<ScrapeResult>((_, reject) => {
        signal.addEventListener("abort", () => {
          scrapeAborted = true;
          reject(signal.reason);
        });
      });
    setTimeout(
      () => controller.abort(new UnrecoverableError("SHUTDOWN", "Received SIGTERM – stopping")),
      50,
    );

    const start = Date.now();
    const { progress } = await runBatchLocations(
      [SLOW, FAST],
      options(30_000),
      { state: { completed: [] }, stateFile: join(dir, ".revcli-state.json"), signal: controller.signal },
      { scrape },
    );

    expect(scrapeAborted).toBe(true);
    expect(Date.now() - start).toBeLessThan(2_000);
    expect(progress.failedCount).toBe(1);
    expect(readdirSync(dir).filter((f) => f.endsWith(".json"))).toEqual([]);
  });
});
