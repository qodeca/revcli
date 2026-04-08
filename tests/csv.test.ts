import { describe, it, expect, vi } from "vitest";
import { escapeCsv, writeCsv } from "../src/output/csv.js";
import type { ScrapeResult } from "../src/core/schema.js";

const mockResult: ScrapeResult = {
  business: {
    name: "Test Gym",
    placeId: "ChIJ123",
    url: "https://maps.app.goo.gl/abc",
    address: "123 Main St",
    rating: 4.5,
    totalReviews: 100,
    scrapeDate: "2025-01-01T00:00:00Z",
  },
  reviews: [
    {
      id: "r1",
      author: "Alice",
      authorUrl: null,
      publishTime: "a week ago",
      rating: 5,
      text: "Great!",
      originalText: "Great!",
      originalLanguage: "english",
      photos: 0,
      ownerResponse: {
        text: "Thanks!",
        originalText: "Thanks!",
        originalLanguage: "english",
        publishTime: "2 days ago",
      },
    },
  ],
  metadata: {
    provider: "playwright",
    scrapeDurationMs: 5000,
    reviewsCollected: 1,
    sortOrder: "newest",
  },
};

describe("escapeCsv", () => {
  it("returns empty string for null", () => {
    expect(escapeCsv(null)).toBe("");
  });

  it("returns empty string for undefined", () => {
    expect(escapeCsv(undefined)).toBe("");
  });

  it("passes through plain text", () => {
    expect(escapeCsv("hello")).toBe("hello");
  });

  it("wraps text with commas in quotes", () => {
    expect(escapeCsv("hello, world")).toBe('"hello, world"');
  });

  it("escapes double quotes", () => {
    expect(escapeCsv('say "hello"')).toBe('"say ""hello"""');
  });

  it("wraps text with newlines in quotes", () => {
    expect(escapeCsv("line1\nline2")).toBe('"line1\nline2"');
  });

  it("sanitizes formula injection with = prefix", () => {
    const result = escapeCsv('=HYPERLINK("http://evil.com")');
    expect(result).not.toMatch(/^=/);
    expect(result).toContain("\t");
  });

  it("sanitizes formula injection with + prefix", () => {
    const result = escapeCsv("+cmd|'/C calc'!A0");
    expect(result).not.toMatch(/^\+/);
  });

  it("sanitizes formula injection with - prefix", () => {
    const result = escapeCsv("-1+1");
    expect(result).not.toMatch(/^-/);
  });

  it("sanitizes formula injection with @ prefix", () => {
    const result = escapeCsv("@SUM(A1)");
    expect(result).not.toMatch(/^@/);
  });
});

describe("writeCsv", () => {
  it("writes to stdout when no output path", async () => {
    const writeSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    await writeCsv(mockResult, null);
    const output = writeSpy.mock.calls[0][0] as string;
    expect(output).toContain("business_name");
    expect(output).toContain("Test Gym");
    expect(output).toContain("Alice");
    writeSpy.mockRestore();
  });

  it("includes header row", async () => {
    const writeSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    await writeCsv(mockResult, null);
    const output = writeSpy.mock.calls[0][0] as string;
    const header = output.split("\n")[0];
    expect(header).toBe(
      "business_name,review_id,author,rating,publish_time,text,original_text,original_language,photos,owner_response_text,owner_response_time",
    );
    writeSpy.mockRestore();
  });

  it("produces header-only for empty reviews", async () => {
    const writeSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    await writeCsv({ ...mockResult, reviews: [] }, null);
    const output = writeSpy.mock.calls[0][0] as string;
    const lines = output.trim().split("\n");
    expect(lines).toHaveLength(1);
    writeSpy.mockRestore();
  });
});
