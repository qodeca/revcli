import { describe, it, expect } from "vitest";
import {
  parseReview,
  detectLanguage,
  parseReviewCount,
} from "../src/scraper/parser.js";
import { parseRatingText } from "../src/scraper/business-extractor.js";
import type { RawReview } from "../src/scraper/extractor.js";

function makeRawReview(overrides: Partial<RawReview> = {}): RawReview {
  return {
    reviewId: "test-review-id-123",
    author: "John Doe",
    authorUrl: "https://www.google.com/maps/contrib/123",
    publishTime: "2 weeks ago",
    rating: 5,
    text: "Great place!",
    originalText: null,
    photos: 0,
    ownerResponseText: null,
    ownerResponseTime: null,
    ...overrides,
  };
}

describe("parseReview", () => {
  it("transforms a complete raw review", () => {
    const result = parseReview(makeRawReview());
    expect(result).not.toBeNull();
    expect(result!.id).toBe("test-review-id-123");
    expect(result!.author).toBe("John Doe");
    expect(result!.rating).toBe(5);
    expect(result!.text).toBe("Great place!");
  });

  it("uses Google review ID when available", () => {
    const result = parseReview(makeRawReview({ reviewId: "google-id" }));
    expect(result!.id).toBe("google-id");
  });

  it("falls back to generated hash when reviewId is empty", () => {
    const result = parseReview(makeRawReview({ reviewId: "" }));
    expect(result).not.toBeNull();
    expect(result!.id).toMatch(/^[0-9a-f]{16}$/);
  });

  it("copies text to originalText when originalText is null", () => {
    const result = parseReview(
      makeRawReview({ text: "Hello", originalText: null }),
    );
    expect(result!.text).toBe("Hello");
    expect(result!.originalText).toBe("Hello");
  });

  it("keeps both text and originalText when both present", () => {
    const result = parseReview(
      makeRawReview({ text: "Translated", originalText: "أصلي" }),
    );
    expect(result!.text).toBe("Translated");
    expect(result!.originalText).toBe("أصلي");
    expect(result!.originalLanguage).toBe("arabic");
  });

  it("handles null text and null originalText", () => {
    const result = parseReview(
      makeRawReview({ text: null, originalText: null }),
    );
    expect(result).not.toBeNull();
    expect(result!.text).toBeNull();
    expect(result!.originalText).toBeNull();
    expect(result!.originalLanguage).toBeNull();
  });

  it("builds owner response when present", () => {
    const result = parseReview(
      makeRawReview({
        ownerResponseText: "Thank you!",
        ownerResponseTime: "a week ago",
      }),
    );
    expect(result!.ownerResponse).not.toBeNull();
    expect(result!.ownerResponse!.text).toBe("Thank you!");
    expect(result!.ownerResponse!.publishTime).toBe("a week ago");
  });

  it("sets owner response publishTime to null when missing", () => {
    const result = parseReview(
      makeRawReview({
        ownerResponseText: "Thanks",
        ownerResponseTime: null,
      }),
    );
    expect(result!.ownerResponse!.publishTime).toBeNull();
  });

  it("sets ownerResponse to null when no response text", () => {
    const result = parseReview(
      makeRawReview({ ownerResponseText: null }),
    );
    expect(result!.ownerResponse).toBeNull();
  });

  it("preserves rating=0 when stars selector is stale", () => {
    const result = parseReview(makeRawReview({ rating: 0 }));
    expect(result).not.toBeNull();
    expect(result!.rating).toBe(0);
  });

  it("returns null for rating > 5", () => {
    const result = parseReview(makeRawReview({ rating: 6 }));
    expect(result).toBeNull();
  });

  it("maps photos count correctly", () => {
    const result = parseReview(makeRawReview({ photos: 3 }));
    expect(result!.photos).toBe(3);
  });
});

describe("detectLanguage", () => {
  it("returns 'arabic' for Arabic text", () => {
    expect(detectLanguage("مكان رائع جداً")).toBe("arabic");
  });

  it("returns 'english' for English text", () => {
    expect(detectLanguage("This is a great place")).toBe("english");
  });

  it("returns 'mixed' for mixed script", () => {
    // Equal mix – neither side exceeds 50%
    expect(detectLanguage("ABCD مكان")).toBe("mixed");
  });

  it("returns 'unknown' for non-Latin/Arabic (e.g., CJK)", () => {
    expect(detectLanguage("素晴らしい場所")).toBe("unknown");
  });

  it("returns null for empty string", () => {
    expect(detectLanguage("")).toBeNull();
  });

  it("returns null for falsy input", () => {
    expect(detectLanguage(null as unknown as string)).toBeNull();
  });
});

describe("parseReviewCount", () => {
  // Null-returning cases (keyword absent or parse failed)
  it("returns null for empty string", () => {
    expect(parseReviewCount("")).toBeNull();
  });

  it("returns null for whitespace-only string", () => {
    expect(parseReviewCount("   ")).toBeNull();
  });

  it("returns null for mixed whitespace (tabs, newlines)", () => {
    expect(parseReviewCount("   \t\n   ")).toBeNull();
  });

  it("returns null for plain 'abc' (no keyword, no digits)", () => {
    expect(parseReviewCount("abc")).toBeNull();
  });

  it("returns null for '$1,200' (no 'review' keyword)", () => {
    expect(parseReviewCount("$1,200")).toBeNull();
  });

  it("returns null for '12,345' (no 'review' keyword)", () => {
    expect(parseReviewCount("12,345")).toBeNull();
  });

  it("returns null for 'reviews' (keyword but no digits)", () => {
    expect(parseReviewCount("reviews")).toBeNull();
  });

  it("returns null for 'Reviews' (capitalized, no digits)", () => {
    expect(parseReviewCount("Reviews")).toBeNull();
  });

  it("returns null for null input", () => {
    expect(parseReviewCount(null as unknown as string)).toBeNull();
  });

  it("returns null for undefined input", () => {
    expect(parseReviewCount(undefined as unknown as string)).toBeNull();
  });

  // Suffix-form rejection (K/M/B)
  it("returns null for '1.6K reviews' (K suffix)", () => {
    expect(parseReviewCount("1.6K reviews")).toBeNull();
  });

  it("returns null for '2M reviews' (M suffix)", () => {
    expect(parseReviewCount("2M reviews")).toBeNull();
  });

  it("returns null for '5k reviews' (lowercase k suffix)", () => {
    expect(parseReviewCount("5k reviews")).toBeNull();
  });

  it("returns null for 'Reviews (1.2k)' (parenthesized suffix)", () => {
    expect(parseReviewCount("Reviews (1.2k)")).toBeNull();
  });

  it("returns null for '3B reviews' (B suffix)", () => {
    expect(parseReviewCount("3B reviews")).toBeNull();
  });

  // Decimal form rejection
  it("returns null for '1.5 reviews' (decimal)", () => {
    expect(parseReviewCount("1.5 reviews")).toBeNull();
  });

  it("returns null for '4.5 stars · 1,234 reviews' (decimal present in neighboring text)", () => {
    // Rule 5 rejects any text containing a decimal number; "4.5 stars · 1,234 reviews"
    // would ideally return 1234 but the parser bails defensively. The reconciliation
    // will backfill via reviews.length, so user-visible behavior is correct.
    expect(parseReviewCount("4.5 stars · 1,234 reviews")).toBeNull();
  });

  // Primary English case (comma separator)
  it("parses '1,568 reviews' → 1568", () => {
    expect(parseReviewCount("1,568 reviews")).toBe(1568);
  });

  it("parses '1568 reviews' → 1568 (no separator)", () => {
    expect(parseReviewCount("1568 reviews")).toBe(1568);
  });

  it("parses '12,345,678 reviews' → 12345678 (multi-group)", () => {
    expect(parseReviewCount("12,345,678 reviews")).toBe(12345678);
  });

  it("parses '0 reviews' → 0 (zero is valid)", () => {
    expect(parseReviewCount("0 reviews")).toBe(0);
  });

  it("parses '1 review' → 1 (singular)", () => {
    expect(parseReviewCount("1 review")).toBe(1);
  });

  // Post-keyword form (number after "Reviews")
  it("parses 'Reviews 1,568' → 1568", () => {
    expect(parseReviewCount("Reviews 1,568")).toBe(1568);
  });

  it("parses 'Reviews\\n1,234' → 1234 (newline separator)", () => {
    expect(parseReviewCount("Reviews\n1,234")).toBe(1234);
  });

  // Pre-keyword priority (both patterns present)
  it("parses '1,568 reviews Reviews 999' → 1568 (pre-keyword wins)", () => {
    expect(parseReviewCount("1,568 reviews Reviews 999")).toBe(1568);
  });

  // Disambiguation from neighboring numbers
  it("parses '568 photos · 1,568 reviews' → 1568 (adjacent to keyword)", () => {
    expect(parseReviewCount("568 photos · 1,568 reviews")).toBe(1568);
  });

  it("parses '(1,234) reviews' → 1234", () => {
    expect(parseReviewCount("(1,234) reviews")).toBe(1234);
  });

  // Case variants
  it("parses '1,568 REVIEWS' → 1568 (uppercase)", () => {
    expect(parseReviewCount("1,568 REVIEWS")).toBe(1568);
  });

  it("parses '1,568 Reviews' → 1568 (title case)", () => {
    expect(parseReviewCount("1,568 Reviews")).toBe(1568);
  });

  // Whitespace variants (defensive)
  it("parses '1 568 reviews' → 1568 (regular space thousand separator)", () => {
    expect(parseReviewCount("1 568 reviews")).toBe(1568);
  });

  it("parses '1\\u00a0568 reviews' → 1568 (NBSP separator)", () => {
    expect(parseReviewCount("1\u00a0568 reviews")).toBe(1568);
  });

  it("parses '1\\u202f568 reviews' → 1568 (NNBSP separator)", () => {
    expect(parseReviewCount("1\u202f568 reviews")).toBe(1568);
  });

  it("parses '1\\u2009568 reviews' → 1568 (thin space separator)", () => {
    expect(parseReviewCount("1\u2009568 reviews")).toBe(1568);
  });

  it("parses '  1,568 reviews  ' → 1568 (leading/trailing whitespace)", () => {
    expect(parseReviewCount("  1,568 reviews  ")).toBe(1568);
  });

  // Punctuation after number
  it("parses '1,568 reviews.' → 1568 (period terminator)", () => {
    expect(parseReviewCount("1,568 reviews.")).toBe(1568);
  });

  it("parses '1,568 reviews,' → 1568 (comma terminator)", () => {
    expect(parseReviewCount("1,568 reviews,")).toBe(1568);
  });

  // Edge: very large number
  it("parses '9,999,999 reviews' → 9999999", () => {
    expect(parseReviewCount("9,999,999 reviews")).toBe(9999999);
  });

  // Edge: zero in post-keyword
  it("parses 'Reviews 0' → 0", () => {
    expect(parseReviewCount("Reviews 0")).toBe(0);
  });
});

describe("parser.ts module invariants", () => {
  it("does not import Playwright", async () => {
    const { readFileSync } = await import("node:fs");
    const source = readFileSync(
      new URL("../src/scraper/parser.ts", import.meta.url),
      "utf8",
    );
    expect(source).not.toMatch(/from\s+['"]playwright/);
    expect(source).not.toMatch(/from\s+['"]@playwright\//);
  });
});

describe("parseRatingText", () => {
  it("returns null for null input", () => {
    expect(parseRatingText(null)).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(parseRatingText("")).toBeNull();
  });

  it("returns null for whitespace-only string", () => {
    expect(parseRatingText("   ")).toBeNull();
  });

  it("parses '4.5 stars' → 4.5", () => {
    expect(parseRatingText("4.5 stars")).toBe(4.5);
  });

  it("parses 'Rated 4.5 out of 5 stars' → 4.5 (realistic aria-label)", () => {
    expect(parseRatingText("Rated 4.5 out of 5 stars")).toBe(4.5);
  });

  it("parses '5' → 5 (integer, upper boundary)", () => {
    expect(parseRatingText("5")).toBe(5);
  });

  it("parses '5.0' → 5", () => {
    expect(parseRatingText("5.0")).toBe(5);
  });

  it("parses '0' → 0 (lower boundary, not a sentinel)", () => {
    expect(parseRatingText("0")).toBe(0);
  });

  it("parses '4,5' → 4.5 (comma decimal – defensive for non-en locales)", () => {
    expect(parseRatingText("4,5")).toBe(4.5);
  });

  it("returns null for '5.1' (out of range)", () => {
    expect(parseRatingText("5.1")).toBeNull();
  });

  it("returns null for '-1' (negative, lookbehind rejects leading minus)", () => {
    expect(parseRatingText("-1")).toBeNull();
  });

  it("returns null for 'abc' (no digits)", () => {
    expect(parseRatingText("abc")).toBeNull();
  });

  it("parses '4.5.6 stars' → 4.5 (first valid match)", () => {
    expect(parseRatingText("4.5.6 stars")).toBe(4.5);
  });

  it("returns null for '10 stars' (out of range)", () => {
    expect(parseRatingText("10 stars")).toBeNull();
  });
});
