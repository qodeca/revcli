import { describe, it, expect } from "vitest";
import { extractOriginalLanguageFromButtonText } from "../src/scraper/extractor.js";

describe("extractOriginalLanguageFromButtonText", () => {
  it("extracts the language name from a 'See original (X)' button", () => {
    expect(
      extractOriginalLanguageFromButtonText("See original (Polish)"),
    ).toBe("Polish");
  });

  it("handles a full toggle label with the 'Translated by Google' prefix", () => {
    expect(
      extractOriginalLanguageFromButtonText(
        "Translated by Google ・ See original (Spanish)",
      ),
    ).toBe("Spanish");
  });

  it("extracts a nested-parenthesized language name greedily", () => {
    // e.g. "Chinese (Simplified)" contains its own parentheses.
    expect(
      extractOriginalLanguageFromButtonText(
        "See original (Chinese (Simplified))",
      ),
    ).toBe("Chinese (Simplified)");
  });

  it("is case-insensitive on the 'See original' keyword", () => {
    expect(
      extractOriginalLanguageFromButtonText("see original (french)"),
    ).toBe("french");
  });

  it("trims surrounding whitespace inside the parentheses", () => {
    expect(extractOriginalLanguageFromButtonText("See original (  German  )")).toBe(
      "German",
    );
  });

  it("returns null for a translation-state button (no original)", () => {
    expect(
      extractOriginalLanguageFromButtonText("See translation (English)"),
    ).toBeNull();
  });

  it("returns null when there is no 'See original (…)' segment", () => {
    expect(extractOriginalLanguageFromButtonText("Some random text")).toBeNull();
    expect(extractOriginalLanguageFromButtonText("See original")).toBeNull();
  });

  it("returns null for empty parenthesized language", () => {
    expect(extractOriginalLanguageFromButtonText("See original (   )")).toBeNull();
  });

  it("returns null for null, undefined, and empty input", () => {
    expect(extractOriginalLanguageFromButtonText(null)).toBeNull();
    expect(extractOriginalLanguageFromButtonText(undefined)).toBeNull();
    expect(extractOriginalLanguageFromButtonText("")).toBeNull();
  });
});
