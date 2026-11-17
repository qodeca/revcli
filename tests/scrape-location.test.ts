import { describe, it, expect, vi } from "vitest";
import {
  assembleScrapeResult,
  navigateWithAuthFallback,
  type AuthFallbackDeps,
} from "../src/scraper/scrape-location.js";
import { authRequiredError, type SessionState } from "../src/scraper/auth.js";
import { hasUnrecoverableKind } from "../src/core/errors.js";
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

describe("navigateWithAuthFallback", () => {
  const M1_START = "Google Maps is showing a limited view: this browser profile is not signed in";
  const M1B_START = "Google Maps is showing a limited view even though this browser profile appears to be signed in";

  function deps(overrides: Partial<AuthFallbackDeps<{ name: string }>> = {}) {
    const navigate = vi.fn<() => Promise<{ name: string }>>();
    const waitForAuth = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
    const sessionProbe = vi.fn<() => Promise<SessionState>>().mockResolvedValue("expired");
    return { headless: true, navigate, waitForAuth, sessionProbe, ...overrides };
  }

  it("fails headless at once with the sign-in wording", async () => {
    const d = deps();
    d.navigate.mockRejectedValue(authRequiredError());

    const err = await navigateWithAuthFallback(d).catch((e: unknown) => e);

    expect(hasUnrecoverableKind(err, "AUTH_REQUIRED")).toBe(true);
    expect((err as Error).message.startsWith(M1_START)).toBe(true);
    expect(d.waitForAuth).not.toHaveBeenCalled();
    expect(d.navigate).toHaveBeenCalledTimes(1);
  });

  it("headed: waits for sign-in and returns the second navigation's result", async () => {
    const d = deps({ headless: false });
    d.navigate
      .mockRejectedValueOnce(authRequiredError())
      .mockResolvedValueOnce({ name: "B" });

    await expect(navigateWithAuthFallback(d)).resolves.toEqual({ name: "B" });
    expect(d.waitForAuth).toHaveBeenCalledTimes(1);
    expect(d.sessionProbe).not.toHaveBeenCalled();
  });

  it("headed: a limited view after sign-in on a signed-in profile gets the M1b wording", async () => {
    const d = deps({ headless: false });
    d.navigate.mockRejectedValue(authRequiredError());
    d.sessionProbe.mockResolvedValue("signed-in");

    const err = await navigateWithAuthFallback(d).catch((e: unknown) => e);

    expect(hasUnrecoverableKind(err, "AUTH_REQUIRED")).toBe(true);
    expect((err as Error).message.startsWith(M1B_START)).toBe(true);
    expect(d.navigate).toHaveBeenCalledTimes(2);
  });

  it("falls back to the sign-in wording when the session probe fails", async () => {
    const d = deps();
    d.navigate.mockRejectedValue(authRequiredError());
    d.sessionProbe.mockRejectedValue(new Error("page closed"));

    const err = await navigateWithAuthFallback(d).catch((e: unknown) => e);

    expect((err as Error).message.startsWith(M1_START)).toBe(true);
  });

  it("rethrows any other error unchanged without probing or prompting", async () => {
    const d = deps({ headless: false });
    const boom = new Error("boom");
    d.navigate.mockRejectedValue(boom);

    await expect(navigateWithAuthFallback(d)).rejects.toBe(boom);
    expect(d.sessionProbe).not.toHaveBeenCalled();
    expect(d.waitForAuth).not.toHaveBeenCalled();
  });
});
