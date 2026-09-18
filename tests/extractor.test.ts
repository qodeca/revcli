import { describe, it, expect } from "vitest";
import {
  extractOriginalLanguageFromButtonText,
  isShowingTranslation,
  buildCardSelector,
  shouldFallbackLang,
  resolveOriginalLanguage,
} from "../src/scraper/extractor.js";

describe("isShowingTranslation", () => {
  it("is true when aria-checked is 'true'", () => {
    expect(isShowingTranslation("true")).toBe(true);
  });

  it("is false when aria-checked is 'false' (showing original)", () => {
    expect(isShowingTranslation("false")).toBe(false);
  });

  it("is false for null/absent aria-checked (unknown state)", () => {
    expect(isShowingTranslation(null)).toBe(false);
  });

  it("is false for undefined aria-checked", () => {
    expect(isShowingTranslation(undefined)).toBe(false);
  });

  it("is false for a non-boolean-string value", () => {
    expect(isShowingTranslation("True")).toBe(false);
  });
});

describe("buildCardSelector", () => {
  it("interpolates the review id into the reviewCard attribute selector", () => {
    expect(buildCardSelector("abc123")).toBe(
      'div.jftiEf[data-review-id="abc123"]',
    );
  });

  it("uses the central SELECTORS.reviewCard class", () => {
    const sel = buildCardSelector("0x1:0x2");
    expect(sel).toContain("div.jftiEf");
    expect(sel).toContain('[data-review-id="0x1:0x2"]');
  });
});

describe("shouldFallbackLang", () => {
  it("is false for a null ISO tag", () => {
    expect(shouldFallbackLang(null)).toBe(false);
  });

  it("is false for the UI locale ('en')", () => {
    expect(shouldFallbackLang("en")).toBe(false);
  });

  it("is false for an empty string", () => {
    expect(shouldFallbackLang("")).toBe(false);
  });

  it("is true for a non-English ISO tag", () => {
    expect(shouldFallbackLang("pl")).toBe(true);
    expect(shouldFallbackLang("ar")).toBe(true);
  });
});

describe("resolveOriginalLanguage", () => {
  it("prefers the human-readable button hint over the ISO code", () => {
    expect(resolveOriginalLanguage("See original (Polish)", "pl")).toBe(
      "Polish",
    );
  });

  it("falls back to the ISO tag when the button hint is absent", () => {
    expect(resolveOriginalLanguage(null, "pl")).toBe("pl");
  });

  it("drops an English ISO tag (UI locale is not a source language)", () => {
    expect(resolveOriginalLanguage(null, "en")).toBeNull();
  });

  it("uses the button hint even when the ISO tag is English", () => {
    expect(resolveOriginalLanguage("See original (Spanish)", "en")).toBe(
      "Spanish",
    );
  });

  it("handles a nested-parenthesized button hint", () => {
    expect(
      resolveOriginalLanguage("See original (Chinese (Simplified))", "zh-CN"),
    ).toBe("Chinese (Simplified)");
  });

  it("falls back when the button hint is empty", () => {
    expect(resolveOriginalLanguage("", "pl")).toBe("pl");
  });

  it("returns null when both hint and ISO tag are absent", () => {
    expect(resolveOriginalLanguage(null, null)).toBeNull();
  });
});

describe("extractOriginalLanguageFromButtonText", () => {
  it("extracts a multi-line label spanning DOM text nodes", () => {
    // Google's toggle label can wrap across text nodes; the greedy [\s\S]+
    // group (not `.`) must match newlines.
    expect(
      extractOriginalLanguageFromButtonText(
        "Translated by Google ・ See original\n(Polish)",
      ),
    ).toBe("Polish");
  });

  it("trims a language name wrapped in newlines inside the parens", () => {
    expect(
      extractOriginalLanguageFromButtonText("See original (\nPolish\n)"),
    ).toBe("Polish");
  });

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
