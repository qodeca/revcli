import { describe, it, expect } from "vitest";
import {
  ReviewSchema,
  OwnerResponseSchema,
  BusinessSchema,
  MetadataSchema,
  ScrapeResultSchema,
  generateReviewId,
} from "../src/core/schema.js";

describe("ReviewSchema", () => {
  const validReview = {
    id: "abc123def456",
    author: "John Doe",
    authorUrl: "https://www.google.com/maps/contrib/12345",
    publishTime: "2 weeks ago",
    rating: 5,
    text: "Great place!",
    originalText: "مكان رائع!",
    originalLanguage: "arabic",
    photos: 2,
    ownerResponse: {
      text: "Thank you!",
      originalText: "شكرا!",
      originalLanguage: "arabic",
      publishTime: "a week ago",
    },
  };

  it("validates a complete review", () => {
    const result = ReviewSchema.safeParse(validReview);
    expect(result.success).toBe(true);
  });

  it("accepts null optional fields", () => {
    const review = {
      ...validReview,
      authorUrl: null,
      text: null,
      originalText: null,
      originalLanguage: null,
      ownerResponse: null,
    };
    const result = ReviewSchema.safeParse(review);
    expect(result.success).toBe(true);
  });

  it("allows rating=0 (stale selector sentinel)", () => {
    expect(
      ReviewSchema.safeParse({ ...validReview, rating: 0 }).success,
    ).toBe(true);
  });

  it("rejects rating outside 0-5", () => {
    expect(
      ReviewSchema.safeParse({ ...validReview, rating: -1 }).success,
    ).toBe(false);
    expect(
      ReviewSchema.safeParse({ ...validReview, rating: 6 }).success,
    ).toBe(false);
  });

  it("rejects non-integer rating", () => {
    expect(
      ReviewSchema.safeParse({ ...validReview, rating: 3.5 }).success,
    ).toBe(false);
  });

  it("rejects missing required fields", () => {
    const { author, ...rest } = validReview;
    expect(ReviewSchema.safeParse(rest).success).toBe(false);
  });
});

describe("OwnerResponseSchema", () => {
  it("accepts null publishTime", () => {
    const result = OwnerResponseSchema.safeParse({
      text: "Thanks",
      originalText: "Thanks",
      originalLanguage: "english",
      publishTime: null,
    });
    expect(result.success).toBe(true);
  });

  it("accepts all-null optional fields", () => {
    const result = OwnerResponseSchema.safeParse({
      text: null,
      originalText: null,
      originalLanguage: null,
      publishTime: null,
    });
    expect(result.success).toBe(true);
  });
});

describe("BusinessSchema", () => {
  const validBusiness = {
    name: "Test",
    placeId: null,
    url: "https://example.com",
    address: null,
    rating: null,
    totalReviews: null,
    headerTotalReviews: null,
    scrapeDate: "2025-01-01T00:00:00Z",
  };

  it("accepts all-null optional fields", () => {
    const result = BusinessSchema.safeParse(validBusiness);
    expect(result.success).toBe(true);
  });

  it("accepts positive integer headerTotalReviews", () => {
    const result = BusinessSchema.safeParse({
      ...validBusiness,
      headerTotalReviews: 1568,
    });
    expect(result.success).toBe(true);
  });

  it("accepts zero headerTotalReviews (boundary)", () => {
    const result = BusinessSchema.safeParse({
      ...validBusiness,
      headerTotalReviews: 0,
    });
    expect(result.success).toBe(true);
  });

  it("accepts null headerTotalReviews", () => {
    const result = BusinessSchema.safeParse({
      ...validBusiness,
      headerTotalReviews: null,
    });
    expect(result.success).toBe(true);
  });

  it("defaults missing headerTotalReviews to null (backward compat)", () => {
    const {
      headerTotalReviews: _omitted,
      ...withoutHeaderTotal
    } = validBusiness;
    const result = BusinessSchema.safeParse(withoutHeaderTotal);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.headerTotalReviews).toBeNull();
    }
  });

  it("rejects non-integer headerTotalReviews", () => {
    const result = BusinessSchema.safeParse({
      ...validBusiness,
      headerTotalReviews: 3.5,
    });
    expect(result.success).toBe(false);
  });

  it("rejects negative headerTotalReviews", () => {
    const result = BusinessSchema.safeParse({
      ...validBusiness,
      headerTotalReviews: -1,
    });
    expect(result.success).toBe(false);
  });

  it("rejects string headerTotalReviews", () => {
    const result = BusinessSchema.safeParse({
      ...validBusiness,
      headerTotalReviews: "1568",
    });
    expect(result.success).toBe(false);
  });

  it("rejects negative totalReviews (tightened to .min(0))", () => {
    const result = BusinessSchema.safeParse({
      ...validBusiness,
      totalReviews: -1,
    });
    expect(result.success).toBe(false);
  });

  it("accepts totalReviews=0 (boundary)", () => {
    const result = BusinessSchema.safeParse({
      ...validBusiness,
      totalReviews: 0,
    });
    expect(result.success).toBe(true);
  });

  it("old fixture file without headerTotalReviews parses via .default(null)", async () => {
    const { readFileSync } = await import("node:fs");
    const raw = readFileSync(
      new URL("../fixtures/sample-reviews.json", import.meta.url),
      "utf8",
    );
    const parsed = JSON.parse(raw);
    // The fixture does not have business.headerTotalReviews
    expect(parsed.business.headerTotalReviews).toBeUndefined();
    // BusinessSchema.parse should succeed and coerce the missing field to null
    const result = BusinessSchema.parse(parsed.business);
    expect(result.headerTotalReviews).toBeNull();
  });
});

describe("MetadataSchema", () => {
  it("rejects invalid provider", () => {
    const result = MetadataSchema.safeParse({
      provider: "serpapi",
      scrapeDurationMs: 1000,
      reviewsCollected: 10,
      sortOrder: "newest",
    });
    expect(result.success).toBe(false);
  });
});

describe("ScrapeResultSchema", () => {
  it("validates a complete scrape result", () => {
    const result = ScrapeResultSchema.safeParse({
      business: {
        name: "Test Business",
        placeId: "ChIJ123",
        url: "https://maps.app.goo.gl/abc",
        address: "123 Main St",
        rating: 4.5,
        totalReviews: 100,
        scrapeDate: "2025-09-14T20:26:30.399Z",
      },
      reviews: [],
      metadata: {
        provider: "playwright",
        scrapeDurationMs: 5000,
        reviewsCollected: 0,
        sortOrder: "newest",
      },
    });
    expect(result.success).toBe(true);
  });
});

describe("generateReviewId", () => {
  it("produces a 16-char hex string", () => {
    const id = generateReviewId("John", "2 weeks ago", 5);
    expect(id).toMatch(/^[0-9a-f]{16}$/);
  });

  it("is deterministic", () => {
    const a = generateReviewId("John", "2 weeks ago", 5);
    const b = generateReviewId("John", "2 weeks ago", 5);
    expect(a).toBe(b);
  });

  it("differs for different inputs", () => {
    const a = generateReviewId("John", "2 weeks ago", 5);
    const b = generateReviewId("Jane", "2 weeks ago", 5);
    expect(a).not.toBe(b);
  });

  it("uses text prefix for better uniqueness", () => {
    const a = generateReviewId("Anon", "a month ago", 5, "Great place");
    const b = generateReviewId("Anon", "a month ago", 5, "Terrible");
    expect(a).not.toBe(b);
  });
});
