import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock fs/promises before import
vi.mock("node:fs/promises", () => ({
  readFile: vi.fn(),
}));

import { readFile } from "node:fs/promises";
import { validateCommand } from "../src/commands/validate.js";

const mockReadFile = vi.mocked(readFile);

describe("validateCommand", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.exitCode = undefined;
  });

  const validJson = JSON.stringify({
    business: {
      name: "Test",
      placeId: null,
      url: "https://example.com",
      address: null,
      rating: null,
      totalReviews: null,
      scrapeDate: "2025-01-01T00:00:00Z",
    },
    reviews: [],
    metadata: {
      provider: "playwright",
      scrapeDurationMs: 1000,
      reviewsCollected: 0,
      sortOrder: "newest",
    },
  });

  it("succeeds for valid JSON", async () => {
    mockReadFile.mockResolvedValue(validJson);
    await validateCommand("test.json");
    expect(process.exitCode).toBeUndefined();
  });

  it("fails for non-existent file", async () => {
    mockReadFile.mockRejectedValue(new Error("ENOENT"));
    await validateCommand("missing.json");
    expect(process.exitCode).toBe(1);
  });

  it("fails for invalid JSON", async () => {
    mockReadFile.mockResolvedValue("{not json}");
    await validateCommand("bad.json");
    expect(process.exitCode).toBe(1);
  });

  it("fails for valid JSON that doesn't match schema", async () => {
    mockReadFile.mockResolvedValue(JSON.stringify({ foo: "bar" }));
    await validateCommand("wrong.json");
    expect(process.exitCode).toBe(1);
  });
});
