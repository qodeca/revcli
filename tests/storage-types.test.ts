import { describe, it, expect } from "vitest";
import { VOLATILE_STORAGE_TYPES } from "../src/scraper/storage-types.js";

describe("VOLATILE_STORAGE_TYPES", () => {
  const tokens = VOLATILE_STORAGE_TYPES.split(",").map((t) => t.trim());

  it("is a non-empty comma-separated token list", () => {
    expect(tokens.length).toBeGreaterThan(0);
    expect(tokens.every((t) => t.length > 0)).toBe(true);
  });

  it("contains all four expected storage types", () => {
    expect(tokens).toContain("service_workers");
    expect(tokens).toContain("cache_storage");
    expect(tokens).toContain("local_storage");
    expect(tokens).toContain("indexeddb");
  });

  it("does NOT contain 'cookies' (auth-preservation invariant for issue #4)", () => {
    // Cookies must not be cleared – Google Maps auth is cookie-based and
    // clearing them would regress the `revcli auth` flow documented in
    // CLAUDE.md. This assertion guards that invariant.
    expect(tokens).not.toContain("cookies");
  });

  it("does NOT contain 'all' (would wipe cookies as a side effect)", () => {
    expect(tokens).not.toContain("all");
  });
});
