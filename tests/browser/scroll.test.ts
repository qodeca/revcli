import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Browser, BrowserContext } from "playwright";
import { scrollAndCollectReviews, type CycleTiming } from "../../src/scraper/scroller.js";
import { buildMapsPage } from "./fixtures/maps-page.js";
import { launchTestBrowser, newFixtureContext, newFixturePage } from "./harness.js";

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

let browser: Browser;
let context: BrowserContext;

beforeAll(async () => {
  browser = await launchTestBrowser();
});

afterAll(async () => {
  await browser?.close();
});

beforeEach(async () => {
  context = await newFixtureContext(browser);
});

afterEach(async () => {
  await context?.close();
});

describe("scrollAndCollectReviews (in-page scroll code, issue #31 finding 1)", () => {
  it("collects exactly maxReviews across several scrolls", async () => {
    const page = await newFixturePage(
      context,
      buildMapsPage({ totalReviews: 35, batchSize: 10 }),
    );

    const reviews = await scrollAndCollectReviews(page, { maxReviews: 30, delayMs: 1 });

    expect(reviews).toHaveLength(30);
    expect(new Set(reviews.map((r) => r.id)).size).toBe(30);
  });

  it("collects every review and stops when the list stops growing", async () => {
    const page = await newFixturePage(
      context,
      buildMapsPage({ totalReviews: 12, batchSize: 5 }),
    );

    const reviews = await scrollAndCollectReviews(page, { delayMs: 1 });

    expect(reviews.map((r) => r.id).sort()).toEqual(
      Array.from({ length: 12 }, (_, i) => `r${i}`).sort(),
    );
  });

  it("keeps a flat collect-cycle time as the list grows to 2,000 reviews (issue #33)", async () => {
    const total = 2000;
    const page = await newFixturePage(
      context,
      buildMapsPage({ totalReviews: total, batchSize: 50 }),
    );

    const cycles: CycleTiming[] = [];
    const reviews = await scrollAndCollectReviews(page, {
      delayMs: 1,
      onCycle: (c) => cycles.push(c),
    });

    expect(reviews).toHaveLength(total);
    // Only cycles that collected something: the trailing stale cycles at the
    // end of the list are not "collect cycles" of a growing list.
    const productive = cycles.filter((c) => c.newCount > 0);
    expect(productive.length).toBeGreaterThanOrEqual(20);
    const sum = (cs: CycleTiming[]) => cs.reduce((n, c) => n + c.durationMs, 0);
    const first = sum(productive.slice(0, 10));
    const last = sum(productive.slice(-10));
    console.log(`collect cycles: first 10 = ${first}ms, last 10 = ${last}ms`);
    // Timing-free check: a cycle reads only the cards not collected yet (about
    // one scroll's worth), never the whole list.
    const maxRead = Math.max(...cycles.map((c) => c.readCount));
    expect(maxRead).toBeLessThanOrEqual(2 * 50);
    expect(last).toBeLessThanOrEqual(2 * Math.max(first, 1));
    // One retry: the ~10 ms timings can be disturbed by a busy machine. The
    // readCount check above is timing-free and fails on the old code anyway.
  }, { timeout: 180_000, retry: 1 });

  it("stops at the time limit and keeps the reviews collected so far", async () => {
    const page = await newFixturePage(
      context,
      buildMapsPage({ totalReviews: 35, batchSize: 10 }),
    );

    // A deadline already in the past: one collect, then stop.
    const reviews = await scrollAndCollectReviews(page, {
      delayMs: 1,
      deadline: Date.now() - 1,
    });

    expect(reviews.length).toBeGreaterThan(0);
    expect(reviews.length).toBeLessThan(35);
  });
});
