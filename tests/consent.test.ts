import { describe, it, expect } from "vitest";
import { appendHlParam } from "../src/scraper/consent.js";
import { extractPlaceIdFromUrl } from "../src/utils/url.js";

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

  it("overrides non-English hl value to en", () => {
    const url = "https://www.google.com/maps/place/Test/@0,0,15z?hl=de";
    const result = appendHlParam(url);
    expect(result).toContain("hl=en");
    expect(result).not.toContain("hl=de");
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

  it("strips g_ep param that triggers limited view", () => {
    const url =
      "https://www.google.com/maps/place/Test/@0,0,15z?g_ep=EgoyMDI2MDQwNi4wIKXMDSoASAFQAw%3D%3D&hl=en";
    const result = appendHlParam(url);
    expect(result).not.toContain("g_ep");
    expect(result).toContain("hl=en");
  });

  it("strips entry param alongside g_ep", () => {
    const url =
      "https://www.google.com/maps/place/Test/@0,0,15z?entry=ttu&g_ep=EgoyMDI2MDQwNi4wIKXMDSoASAFQAw%3D%3D&hl=en";
    const result = appendHlParam(url);
    expect(result).not.toContain("entry");
    expect(result).not.toContain("g_ep");
    expect(result).toContain("hl=en");
  });

  it("preserves ftid value extractable after URL encoding", () => {
    const url =
      "https://www.google.com/maps?ftid=0x3e2ee3641f7016d7:0x8e3a8bcf52dad296";
    const result = appendHlParam(url);
    expect(result).toContain("hl=en");
    // URLSearchParams encodes : to %3A, but extractPlaceIdFromUrl
    // decodes percent-encoded chars before matching
    const placeId = extractPlaceIdFromUrl(result);
    expect(placeId).toBe("0x3e2ee3641f7016d7:0x8e3a8bcf52dad296");
  });
});
