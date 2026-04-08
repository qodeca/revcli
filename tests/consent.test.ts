import { describe, it, expect } from "vitest";
import { appendHlParam } from "../src/scraper/consent.js";

describe("appendHlParam", () => {
  it("adds hl=en to a long Google Maps URL", () => {
    const url = "https://www.google.com/maps/place/Test/@0,0,15z";
    const result = appendHlParam(url);
    expect(result).toContain("hl=en");
  });

  it("does not duplicate hl param if already present", () => {
    const url = "https://www.google.com/maps/place/Test/@0,0,15z?hl=en";
    const result = appendHlParam(url);
    const matches = result.match(/hl=en/g);
    expect(matches).toHaveLength(1);
  });

  it("preserves existing hl value", () => {
    const url = "https://www.google.com/maps/place/Test/@0,0,15z?hl=de";
    const result = appendHlParam(url);
    expect(result).toContain("hl=de");
    expect(result).not.toContain("hl=en");
  });

  it("returns short URL unchanged", () => {
    const url = "https://maps.app.goo.gl/abc123";
    expect(appendHlParam(url)).toBe(url);
  });

  it("returns invalid URL unchanged", () => {
    const url = "not-a-url";
    expect(appendHlParam(url)).toBe(url);
  });

  it("preserves existing query parameters", () => {
    const url = "https://www.google.com/maps/place/Test/@0,0,15z?foo=bar";
    const result = appendHlParam(url);
    expect(result).toContain("foo=bar");
    expect(result).toContain("hl=en");
  });
});
