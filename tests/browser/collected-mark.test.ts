import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Browser, BrowserContext, Page } from "playwright";
import {
  COLLECTED_MARK_ATTR,
  expandAllReviews,
  extractReviews,
  markCollected,
} from "../../src/scraper/extractor.js";
import { buildMapsPage, FULL_TEXT } from "./fixtures/maps-page.js";
import { launchTestBrowser, newFixtureContext, newFixturePage } from "./harness.js";

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

/**
 * Issue #33: collected cards are marked and skipped so a cycle does not re-read
 * the whole list. A card element that Google reuses for a DIFFERENT review must
 * be read again – otherwise that review would be lost without notice.
 */

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

/** Make card `fromId` show review `toId` (new id, long text, fresh "More" button). */
async function reuseCard(page: Page, fromId: string, toId: string, text: string): Promise<void> {
  await page.evaluate(
    ({ from, to, body }) => {
      const card = document.querySelector(`div.jftiEf[data-review-id="${from}"]`);
      if (!card) throw new Error("card not found");
      card.setAttribute("data-review-id", to);
      card.querySelector(".inner")?.setAttribute("data-review-id", to);
      const host = card.querySelector("div.MyEned");
      const span = host?.querySelector("span.wiI7pd");
      if (span) span.textContent = body;
      const btn = document.createElement("button");
      btn.className = "w8nwRe kyuRq";
      btn.setAttribute("jsaction", "pane.review.expandReview");
      btn.setAttribute("aria-expanded", "false");
      btn.textContent = "More";
      host?.appendChild(btn);
    },
    { from: fromId, to: toId, body: text },
  );
}

describe("collected mark (issue #33)", () => {
  it("skips collected cards on the next read", async () => {
    const page = await newFixturePage(context, buildMapsPage({ totalReviews: 10, batchSize: 10 }));

    const first = await extractReviews(page);
    expect(first).toHaveLength(10);
    await markCollected(page, first.map((r) => r.reviewId));

    expect(await extractReviews(page)).toEqual([]);
    const marks = await page.$$eval(`[${COLLECTED_MARK_ATTR}]`, (els, attr) =>
      els.map((e) => e.getAttribute(attr) === e.getAttribute("data-review-id")), COLLECTED_MARK_ATTR);
    expect(marks).toEqual(Array(10).fill(true));
  });

  it("marks only the ids it is given", async () => {
    const page = await newFixturePage(context, buildMapsPage({ totalReviews: 5, batchSize: 5 }));
    await markCollected(page, ["r0", "r1"]);
    expect((await extractReviews(page)).map((r) => r.reviewId).sort()).toEqual(["r2", "r3", "r4"]);
  });

  it("reads a card again when Google reuses it for a different review", async () => {
    const page = await newFixturePage(context, buildMapsPage({ totalReviews: 3, batchSize: 3 }));
    const first = await extractReviews(page);
    await markCollected(page, first.map((r) => r.reviewId));

    await reuseCard(page, "r1", "r99", "Reused card, truncated…");

    const again = await extractReviews(page);
    expect(again.map((r) => r.reviewId)).toEqual(["r99"]);
    expect(again[0].expandPending).toBe(true);
  });

  it("the expand step skips collected cards but not a reused one", async () => {
    const page = await newFixturePage(
      context,
      buildMapsPage({ totalReviews: 4, batchSize: 4, longTextEvery: 1 }),
    );
    await markCollected(page, ["r0", "r1", "r2", "r3"]);
    const skipped = await expandAllReviews(page);
    expect(skipped.attempted).toBe(0);

    await reuseCard(page, "r2", "r42", FULL_TEXT("r42").slice(0, 60) + "…");
    const result = await expandAllReviews(page);
    // The fixture's click handler expands only its own reviews; what matters
    // here is that the reused card's button was found and clicked.
    expect(result.attempted).toBeGreaterThanOrEqual(1);
    const clicks = await page.evaluate(
      () => (window as unknown as { __revcliTest: { clicks: Record<string, number> } }).__revcliTest.clicks,
    );
    expect(Object.keys(clicks)).toEqual(["r42"]);
  });
});
