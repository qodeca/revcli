import { describe, it, expect } from "vitest";
import { appendHlParam, englishLocaleTarget } from "../src/scraper/consent.js";
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

describe("appendHlParam short-link detection", () => {
  it("rewrites a normal Maps link that only mentions the short-link host in its query", () => {
    const out = appendHlParam("https://www.google.com/maps/place/Test/@0,0,15z?ref=maps.app.goo.gl");
    expect(new URL(out).searchParams.get("hl")).toBe("en");
  });
});

describe("englishLocaleTarget", () => {
  const params = (url: string | null) => new URL(url ?? "about:blank").searchParams;

  it("returns null for an English URL without limited-view params", () => {
    expect(englishLocaleTarget("https://www.google.com/maps/place/Test/@0,0,15z?hl=en")).toBeNull();
  });

  it("forces hl=en when hl is missing or another language", () => {
    for (const url of [
      "https://www.google.com/maps/place/Test/@0,0,15z",
      "https://www.google.com/maps/place/Test/@0,0,15z?hl=pl",
      "https://www.google.com/maps/place/Test/@0,0,15z?hl=en-GB",
    ]) {
      expect(params(englishLocaleTarget(url)).get("hl")).toBe("en");
    }
  });

  it("does not mistake hl=en inside another parameter's value for the locale", () => {
    const url = "https://www.google.com/maps/place/Test/@0,0,15z?q=hl%3Den&hl=de";
    expect(params(englishLocaleTarget(url)).get("hl")).toBe("en");
  });

  it("leaves an English URL alone when Google's script re-added entry/g_ep", () => {
    // Without the option, tracking params must not cost a second page load.
    expect(
      englishLocaleTarget("https://www.google.com/maps/place/Test/@0,0,15z?hl=en&entry=ttu&g_ep=Egoy"),
    ).toBeNull();
  });

  it("strips entry and g_ep after a short-link redirect even when hl is already en", () => {
    const target = englishLocaleTarget(
      "https://www.google.com/maps/place/Test/@0,0,15z?hl=en&entry=tts&g_ep=Egoy",
      { stripLimitedViewParams: true },
    );
    const p = params(target);
    expect(p.get("hl")).toBe("en");
    expect(p.has("entry")).toBe(false);
    expect(p.has("g_ep")).toBe(false);
  });

  it("returns null for a short link and for unparseable input", () => {
    expect(englishLocaleTarget("https://maps.app.goo.gl/abc123")).toBeNull();
    expect(englishLocaleTarget("not a url")).toBeNull();
  });
});
