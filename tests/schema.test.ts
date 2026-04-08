import { describe, it, expect } from "vitest";
import {
  ReviewSchema,
  ScrapeResultSchema,
  generateReviewId,
} from "../src/core/schema.js";

describe("ReviewSchema", () => {
  const validReview = {
    id: "abc123def456",
    author: "John Doe",
    authorUrl: "https://www.google.com/maps/contrib/12345",
    publishTime: "2 weeks ago",
    publishTimestamp: "2025-09-01T00:00:00.000Z",
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
      publishTimestamp: null,
      text: null,
      originalText: null,
      originalLanguage: null,
      ownerResponse: null,
    };
    const result = ReviewSchema.safeParse(review);
    expect(result.success).toBe(true);
  });

  it("rejects rating outside 1-5", () => {
    expect(
      ReviewSchema.safeParse({ ...validReview, rating: 0 }).success,
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
  it("produces a 12-char hex string", () => {
    const id = generateReviewId("John", "2 weeks ago", 5);
    expect(id).toMatch(/^[0-9a-f]{12}$/);
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
});
