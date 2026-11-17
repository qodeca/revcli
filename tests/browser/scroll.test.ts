import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Browser, BrowserContext } from "playwright";
import { scrollAndCollectReviews } from "../../src/scraper/scroller.js";
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
});
