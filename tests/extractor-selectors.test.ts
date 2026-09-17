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

describe("viewOriginalButton selector", () => {
  it("uses the semantic jsaction route, not text substring", () => {
    // Regression: the translated-review toggle was detected via text
    // (`:has-text("See original")`), but the button text changes between
    // states ("See original (X)" vs "See translation (Y)") and could
    // collide with reviewer content. The jsaction route
    // (`review.showReviewInOriginal` / `review.showReviewInTranslation`)
    // is stable across both states and cannot collide with reviewer data.
    expect(SELECTORS.viewOriginalButton).toContain('jsaction*="review.showReview"');
    expect(SELECTORS.viewOriginalButton).not.toContain("has-text");
  });

  it("matches both toggle states with a single selector", () => {
    // The same button is present whether showing the translation or the
    // original; only aria-checked and the jsaction route flip. A single
    // selector lets us detect, open, and restore the toggle without
    // depending on which state it is currently in.
    expect(SELECTORS.viewOriginalButton).toBe(
      'button[jsaction*="review.showReview"]',
    );
  });
});
