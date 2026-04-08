import { describe, it, expect } from "vitest";
import { parseInputFile, slugify } from "../src/commands/batch.js";

describe("parseInputFile", () => {
  it("parses newline-delimited URLs", () => {
    const content = [
      "https://maps.app.goo.gl/abc123",
      "https://maps.app.goo.gl/def456",
    ].join("\n");
    const result = parseInputFile(content);
    expect(result).toHaveLength(2);
  });

  it("skips comment lines", () => {
    const content = [
      "# These are locations",
      "https://maps.app.goo.gl/abc123",
      "# Another comment",
    ].join("\n");
    const result = parseInputFile(content);
    expect(result).toHaveLength(1);
  });

  it("skips empty lines", () => {
    const content = [
      "https://maps.app.goo.gl/abc123",
      "",
      "  ",
      "https://maps.app.goo.gl/def456",
    ].join("\n");
    const result = parseInputFile(content);
    expect(result).toHaveLength(2);
  });

  it("filters out non-Maps URLs", () => {
    const content = [
      "https://maps.app.goo.gl/abc123",
      "https://example.com",
      "not-a-url",
    ].join("\n");
    const result = parseInputFile(content);
    expect(result).toHaveLength(1);
  });

  it("parses JSON array of URLs", () => {
    const content = JSON.stringify([
      "https://maps.app.goo.gl/abc123",
      "https://maps.app.goo.gl/def456",
    ]);
    const result = parseInputFile(content);
    expect(result).toHaveLength(2);
  });

  it("filters invalid entries in JSON array", () => {
    const content = JSON.stringify([
      "https://maps.app.goo.gl/abc123",
      "not-valid",
      42,
    ]);
    const result = parseInputFile(content);
    expect(result).toHaveLength(1);
  });

  it("returns empty array for empty input", () => {
    expect(parseInputFile("")).toHaveLength(0);
    expect(parseInputFile("   \n  \n")).toHaveLength(0);
  });
});

describe("slugify", () => {
  it("converts to lowercase with hyphens", () => {
    expect(slugify("BFIT Yasmeen Men's")).toBe("bfit-yasmeen-mens");
  });

  it("strips special characters", () => {
    expect(slugify("Café & Gym!")).toBe("caf-gym");
  });

  it("strips leading/trailing hyphens", () => {
    expect(slugify("--hello--")).toBe("hello");
  });

  it("returns hash for purely non-Latin names", () => {
    const result = slugify("مكان رائع");
    expect(result).toMatch(/^[0-9a-f]{12}$/);
  });

  it("returns hash for empty result after processing", () => {
    const result = slugify("---");
    expect(result).toMatch(/^[0-9a-f]{12}$/);
  });

  it("handles mixed Latin and non-Latin", () => {
    expect(slugify("B_FIT الياسمين")).toBe("b-fit");
  });
});
