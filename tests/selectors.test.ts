import { describe, it, expect } from "vitest";
import { SELECTORS, TEXT_MARKERS } from "../src/scraper/selectors.js";

describe("SELECTORS", () => {
  it("never uses Playwright's :has-text substring match", () => {
    for (const value of Object.values(SELECTORS)) {
      const all = Array.isArray(value) ? value : [value];
      for (const sel of all) expect(sel).not.toContain("has-text");
    }
  });

  it.each([
    ["accountButton", SELECTORS.accountButton, "SignOutOptions"],
    ["signInLink", SELECTORS.signInLink, "ServiceLogin"],
  ])("matches %s by its accounts.google.com href only", (_name, sel, path) => {
    expect(sel).toBe(`a[href^="https://accounts.google.com/${path}"]`);
    expect(sel).not.toContain("aria-label");
  });
});

describe("TEXT_MARKERS", () => {
  it("holds a lower-case limited-view phrase longer than 'limited view'", () => {
    const marker = TEXT_MARKERS.limitedViewBanner;
    expect(marker).toBe(marker.toLowerCase());
    expect(marker.length).toBeGreaterThan("limited view".length);
    expect(marker).toContain("limited view");
  });
});
