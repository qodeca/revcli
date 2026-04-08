import { describe, it, expect } from "vitest";
import { parseReview, detectLanguage } from "../src/scraper/parser.js";
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

  it("returns null for invalid data (rating 0)", () => {
    const result = parseReview(makeRawReview({ rating: 0 }));
    expect(result).toBeNull();
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
