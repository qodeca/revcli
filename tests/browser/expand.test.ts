import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Browser, BrowserContext, Page } from "playwright";
import {
  expandAllReviews,
  formatTruncationWarning,
} from "../../src/scraper/extractor.js";
import { scrollAndCollectReviews } from "../../src/scraper/scroller.js";
import { logger } from "../../src/utils/logger.js";
import {
  buildMapsPage,
  FULL_TEXT,
  OWNER_FULL_TEXT,
  type MapsFixtureOptions,
} from "./fixtures/maps-page.js";
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
  vi.restoreAllMocks();
});

/** Ten long cards, every third with a truncated owner response (r2, r5, r8). */
const TEN_LONG: MapsFixtureOptions = {
  totalReviews: 10,
  batchSize: 10,
  longTextEvery: 1,
  ownerResponseEvery: 3,
};
const OWNER_IDS = ["r2", "r5", "r8"];
const ids = (n: number) => Array.from({ length: n }, (_, i) => `r${i}`);

async function cardTexts(page: Page): Promise<Record<string, { review: string; owner: string | null }>> {
  return page.evaluate(() => {
    const out: Record<string, { review: string; owner: string | null }> = {};
    for (const card of Array.from(document.querySelectorAll("div.jftiEf"))) {
      out[card.getAttribute("data-review-id") ?? ""] = {
        review: card.querySelector("div.MyEned span.wiI7pd")?.textContent ?? "",
        owner: card.querySelector("div.CDe7pd div.wiI7pd")?.textContent ?? null,
      };
    }
    return out;
  });
}

async function clickCounts(page: Page): Promise<Record<string, number>> {
  return page.evaluate(
    () => (window as unknown as { __revcliTest: { clicks: Record<string, number> } }).__revcliTest.clicks,
  );
}

function truncationWarnings(warnSpy: { mock: { calls: unknown[][] } }): string[] {
  return warnSpy.mock.calls
    .map((c) => String(c[0]))
    .filter((m) => m.startsWith("Could not expand the full text"));
}

describe("expandAllReviews (issue #31 finding 2)", () => {
  it("expands every review and owner response although Google removes clicked buttons", async () => {
    const page = await newFixturePage(context, buildMapsPage(TEN_LONG));

    const result = await expandAllReviews(page);

    expect(result.pendingReviewIds.size).toBe(0);
    const texts = await cardTexts(page);
    for (const id of ids(10)) {
      expect(texts[id].review).toBe(FULL_TEXT(id));
      expect(texts[id].review.endsWith("…")).toBe(false);
    }
    for (const id of OWNER_IDS) {
      expect(texts[id].owner).toBe(OWNER_FULL_TEXT(id));
    }
  });

  it("still expands everything when the button is removed after a delay", async () => {
    const page = await newFixturePage(
      context,
      buildMapsPage({ ...TEN_LONG, asyncExpandMs: 150 }),
    );

    const result = await expandAllReviews(page);

    expect(result.pendingReviewIds.size).toBe(0);
    const texts = await cardTexts(page);
    for (const id of ids(10)) expect(texts[id].review).toBe(FULL_TEXT(id));
    for (const id of OWNER_IDS) expect(texts[id].owner).toBe(OWNER_FULL_TEXT(id));
  });

  it.each(["remove", "aria-expanded", "hide"] as const)(
    "accepts an owner-response button that reacts by %s",
    async (ownerExpandMode) => {
      const page = await newFixturePage(
        context,
        buildMapsPage({ ...TEN_LONG, ownerExpandMode }),
      );

      const result = await expandAllReviews(page);

      expect(result.pendingReviewIds.size).toBe(0);
      // Each owner button is clicked once: the confirm step accepted its reaction.
      const clicks = await clickCounts(page);
      for (const id of OWNER_IDS) expect(clicks[id]).toBe(2); // review + owner button
      const texts = await cardTexts(page);
      for (const id of OWNER_IDS) expect(texts[id].owner).toBe(OWNER_FULL_TEXT(id));
    },
  );

  it("reports a button that ignores clicks as pending and expands the rest", async () => {
    const page = await newFixturePage(
      context,
      buildMapsPage({ ...TEN_LONG, stuckExpandIds: ["r4"] }),
    );

    const result = await expandAllReviews(page);

    expect(result.pendingReviewIds).toEqual(new Set(["r4"]));
    const texts = await cardTexts(page);
    expect(texts.r4.review.endsWith("…")).toBe(true);
    for (const id of ids(10).filter((i) => i !== "r4")) {
      expect(texts[id].review).toBe(FULL_TEXT(id));
    }
  });

  it("never clicks or reports cards listed in skipIds", async () => {
    const page = await newFixturePage(
      context,
      buildMapsPage({ ...TEN_LONG, stuckExpandIds: ["r4"] }),
    );

    const result = await expandAllReviews(page, new Set(["r4"]));

    expect((await clickCounts(page)).r4 ?? 0).toBe(0);
    expect(result.pendingReviewIds.has("r4")).toBe(false);
  });
});

describe("truncation warning at the end of a scrape", () => {
  it("names the number of reviews collected with cut-off text", async () => {
    const warnSpy = vi.spyOn(logger, "warn");
    const page = await newFixturePage(
      context,
      buildMapsPage({ ...TEN_LONG, stuckExpandIds: ["r4"] }),
    );

    const reviews = await scrollAndCollectReviews(page, { maxReviews: 10, delayMs: 1 });

    expect(reviews).toHaveLength(10);
    expect(warnSpy).toHaveBeenCalledWith(formatTruncationWarning(1, 10));
    const r4 = reviews.find((r) => r.id === "r4");
    expect(r4?.text?.endsWith("…")).toBe(true);
    for (const r of reviews.filter((x) => x.id !== "r4")) {
      expect(r.text?.endsWith("…")).toBe(false);
    }
  });

  it("does not warn about a stuck card beyond maxReviews (never collected)", async () => {
    const warnSpy = vi.spyOn(logger, "warn");
    const page = await newFixturePage(
      context,
      buildMapsPage({ ...TEN_LONG, stuckExpandIds: ["r7"] }),
    );

    const reviews = await scrollAndCollectReviews(page, { maxReviews: 5, delayMs: 1 });

    expect(reviews.map((r) => r.id)).toEqual(["r0", "r1", "r2", "r3", "r4"]);
    expect(truncationWarnings(warnSpy)).toEqual([]);
  });

  // The other cards expand after 100 ms each, so the first pass takes far longer
  // than LATE_BUTTON_MS: r2's button appears after the first marking and before
  // the second pass.
  const LATE: MapsFixtureOptions = {
    ...TEN_LONG,
    ownerResponseEvery: undefined,
    asyncExpandMs: 100,
    lateExpandButtonIds: ["r2"],
  };

  it("expands a button that appears after the first marking pass", async () => {
    const warnSpy = vi.spyOn(logger, "warn");
    const page = await newFixturePage(context, buildMapsPage(LATE));

    const reviews = await scrollAndCollectReviews(page, { maxReviews: 10, delayMs: 1 });

    const cutOff = reviews.filter((r) => r.text?.endsWith("…")).length;
    expect(cutOff).toBe(0);
    expect(truncationWarnings(warnSpy)).toEqual([]);
    expect(reviews.find((r) => r.id === "r2")?.text).toBe(FULL_TEXT("r2"));
  });

  it("counts a late button that still cannot be expanded in the warning", async () => {
    const warnSpy = vi.spyOn(logger, "warn");
    const page = await newFixturePage(
      context,
      buildMapsPage({ ...LATE, stuckExpandIds: ["r2"] }),
    );

    const reviews = await scrollAndCollectReviews(page, { maxReviews: 10, delayMs: 1 });

    const cutOff = reviews.filter((r) => r.text?.endsWith("…")).length;
    expect(cutOff).toBeGreaterThanOrEqual(1);
    expect(warnSpy).toHaveBeenCalledWith(formatTruncationWarning(cutOff, reviews.length));
    expect((await clickCounts(page)).r2).toBeGreaterThanOrEqual(1);
  });
});
