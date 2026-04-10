import { describe, it, expect } from "vitest";
import { SELECTORS } from "../src/scraper/selectors.js";

describe("expandButton selector scoping", () => {
  it("keeps the stable class as the primary selector", () => {
    expect(SELECTORS.expandButton).toContain("button.w8nwRe");
    expect(SELECTORS.expandButton).toContain(",");
  });

  it("uses jsaction attribute fallback, not text substring", () => {
    // Regression: `button:has-text("More")` was a substring match that
    // collided with reviewer names containing the letters "more"
    // (e.g. "KHALID ALMORET" → "AL·MORE·T"). Clicks on those author
    // buttons opened Local Guide profile tabs. The semantic jsaction
    // attribute is stable and cannot collide with reviewer data.
    expect(SELECTORS.expandButton).toContain('jsaction*="review.expand"');
    expect(SELECTORS.expandButton).not.toContain("has-text");
  });

  it("flat concatenation with reviewCard produces an unscoped alternative", () => {
    // Historical regression: flat string concatenation of two selector
    // constants does NOT distribute CSS scope across commas. We still
    // use chained locators `page.locator(reviewCard).locator(expandButton)`
    // in extractor.ts. This test documents the shape in case anyone is
    // tempted to pre-concatenate again.
    const naive = `${SELECTORS.reviewCard} ${SELECTORS.expandButton}`;
    expect(naive).toMatch(/,\s*button\[jsaction/);
    expect(naive).not.toMatch(/,\s*div\.jftiEf\s+button\[jsaction/);
  });
});
