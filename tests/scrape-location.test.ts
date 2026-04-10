import { describe, it, expect } from "vitest";
import { assembleScrapeResult } from "../src/scraper/scrape-location.js";
import type { Business, Review } from "../src/core/schema.js";

function makeReview(id: string): Review {
  return {
    id,
    author: `Author ${id}`,
    authorUrl: null,
    publishTime: "2 weeks ago",
    rating: 5,
    text: "Great place",
    originalText: null,
    originalLanguage: null,
    photos: 0,
    ownerResponse: null,
  };
}

function makeReviews(n: number): Review[] {
  return Array.from({ length: n }, (_, i) => makeReview(`review-${i}`));
}

function makeBusinessInfo(
  overrides: Partial<Omit<Business, "scrapeDate" | "headerTotalReviews">> = {},
): Omit<Business, "scrapeDate" | "headerTotalReviews"> {
  return {
    name: "Test Gym",
    placeId: "ChIJ123",
    url: "https://maps.app.goo.gl/abc",
    address: "123 Main St",
    rating: 4.5,
    totalReviews: 100,
    ...overrides,
  };
}

const ctx = {
  scrapeDate: "2026-04-10T12:00:00.000Z",
  scrapeDurationMs: 5000,
  sortOrder: "newest" as const,
};

describe("assembleScrapeResult", () => {
  it("reconciles when header count > collected count (header=568, collected=3)", () => {
    const businessInfo = makeBusinessInfo({ totalReviews: 568 });
    const reviews = makeReviews(3);

    const result = assembleScrapeResult(businessInfo, reviews, ctx);

    expect(result.business.totalReviews).toBe(3);
    expect(result.business.headerTotalReviews).toBe(568);
    expect(result.reviews.length).toBe(3);
    expect(result.business.totalReviews).toBe(result.reviews.length);
  });

  it("reconciles when header count > collected count via --max-reviews cap (header=1568, collected=100)", () => {
    const businessInfo = makeBusinessInfo({ totalReviews: 1568 });
    const reviews = makeReviews(100);

    const result = assembleScrapeResult(businessInfo, reviews, ctx);

    expect(result.business.totalReviews).toBe(100);
    expect(result.business.headerTotalReviews).toBe(1568);
    expect(result.business.totalReviews).toBe(result.reviews.length);
  });

  it("preserves equal counts (header=42, collected=42)", () => {
    const businessInfo = makeBusinessInfo({ totalReviews: 42 });
    const reviews = makeReviews(42);

    const result = assembleScrapeResult(businessInfo, reviews, ctx);

    expect(result.business.totalReviews).toBe(42);
    expect(result.business.headerTotalReviews).toBe(42);
    expect(result.business.totalReviews).toBe(result.reviews.length);
  });

  it("handles empty reviews array with non-null header (header=100, collected=0)", () => {
    const businessInfo = makeBusinessInfo({ totalReviews: 100 });
    const reviews: Review[] = [];

    const result = assembleScrapeResult(businessInfo, reviews, ctx);

    expect(result.business.totalReviews).toBe(0);
    expect(result.business.headerTotalReviews).toBe(100);
    expect(result.reviews.length).toBe(0);
    expect(result.business.totalReviews).toBe(result.reviews.length);
  });

  it("handles null header with non-empty collected reviews (header=null, collected=50)", () => {
    const businessInfo = makeBusinessInfo({ totalReviews: null });
    const reviews = makeReviews(50);

    const result = assembleScrapeResult(businessInfo, reviews, ctx);

    expect(result.business.totalReviews).toBe(50);
    expect(result.business.headerTotalReviews).toBeNull();
    expect(result.business.totalReviews).toBe(result.reviews.length);
  });

  it("handles null header with empty collected reviews (header=null, collected=0)", () => {
    const businessInfo = makeBusinessInfo({ totalReviews: null });
    const reviews: Review[] = [];

    const result = assembleScrapeResult(businessInfo, reviews, ctx);

    expect(result.business.totalReviews).toBe(0);
    expect(result.business.headerTotalReviews).toBeNull();
    expect(result.reviews.length).toBe(0);
  });

  it("passes context fields through to metadata and business.scrapeDate", () => {
    const businessInfo = makeBusinessInfo({ totalReviews: 10 });
    const reviews = makeReviews(10);
    const customCtx = {
      scrapeDate: "2026-05-15T09:30:45.123Z",
      scrapeDurationMs: 12345,
      sortOrder: "highest" as const,
    };

    const result = assembleScrapeResult(businessInfo, reviews, customCtx);

    expect(result.business.scrapeDate).toBe("2026-05-15T09:30:45.123Z");
    expect(result.metadata.provider).toBe("playwright");
    expect(result.metadata.scrapeDurationMs).toBe(12345);
    expect(result.metadata.reviewsCollected).toBe(10);
    expect(result.metadata.sortOrder).toBe("highest");
  });

  it("does not mutate the input businessInfo object", () => {
    const businessInfo = makeBusinessInfo({ totalReviews: 568 });
    const originalTotalReviews = businessInfo.totalReviews;
    const originalName = businessInfo.name;
    const originalSnapshot = { ...businessInfo };
    const reviews = makeReviews(3);

    assembleScrapeResult(businessInfo, reviews, ctx);

    expect(businessInfo.totalReviews).toBe(originalTotalReviews);
    expect(businessInfo.totalReviews).toBe(568);
    expect(businessInfo.name).toBe(originalName);
    expect(businessInfo).toEqual(originalSnapshot);
  });

  it("does not mutate the input reviews array", () => {
    const businessInfo = makeBusinessInfo({ totalReviews: 10 });
    const reviews = makeReviews(5);
    const originalLength = reviews.length;
    const originalFirstId = reviews[0].id;

    assembleScrapeResult(businessInfo, reviews, ctx);

    expect(reviews.length).toBe(originalLength);
    expect(reviews[0].id).toBe(originalFirstId);
  });
});
