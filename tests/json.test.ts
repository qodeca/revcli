import { describe, it, expect, vi } from "vitest";
import { writeJson } from "../src/output/json.js";
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
  reviews: [],
  metadata: {
    provider: "playwright",
    scrapeDurationMs: 5000,
    reviewsCollected: 0,
    sortOrder: "newest",
  },
};

describe("writeJson", () => {
  it("writes to stdout when no output path", async () => {
    const writeSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    await writeJson(mockResult, null);
    const output = writeSpy.mock.calls[0][0] as string;
    expect(output).toContain('"name": "Test Gym"');
    expect(output).toContain('"provider": "playwright"');
    expect(output.endsWith("\n")).toBe(true);
    writeSpy.mockRestore();
  });

  it("writes pretty-printed JSON", async () => {
    const writeSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    await writeJson(mockResult, null);
    const output = writeSpy.mock.calls[0][0] as string;
    // Pretty-printed JSON has indentation
    expect(output).toContain("  ");
    const parsed = JSON.parse(output);
    expect(parsed.business.name).toBe("Test Gym");
    writeSpy.mockRestore();
  });

  it("writes to file when output path given", async () => {
    const { writeFile } = await import("node:fs/promises");
    const { mkdtempSync } = await import("node:fs");
    const { join } = await import("node:path");
    const { readFile } = await import("node:fs/promises");

    const tmpDir = mkdtempSync(join(import.meta.dirname ?? ".", "json-"));
    const outputPath = join(tmpDir, "output.json");

    await writeJson(mockResult, outputPath);

    const content = await readFile(outputPath, "utf-8");
    const parsed = JSON.parse(content);
    expect(parsed.business.name).toBe("Test Gym");

    const { rmSync } = await import("node:fs");
    rmSync(tmpDir, { recursive: true });
  });
});
