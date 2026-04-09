import { describe, it, expect } from "vitest";
import {
  parseGoogleMapsInput,
  isGoogleMapsUrl,
  extractPlaceIdFromUrl,
} from "../src/utils/url.js";

describe("parseGoogleMapsInput", () => {
  it("parses a long Google Maps URL", () => {
    const url =
      "https://www.google.com/maps/place/Optimo+Nakheel/@24.74,46.64,867m/data=!3m1!1e3!4m8!3m7!1s0x3e2ee3641f7016d7:0x8e3a8bcf52dad296";
    const result = parseGoogleMapsInput(url);
    expect(result.url).toBe(url);
    expect(result.placeId).toBe("0x3e2ee3641f7016d7:0x8e3a8bcf52dad296");
    expect(result.isShortUrl).toBe(false);
  });

  it("parses a short Google Maps URL", () => {
    const url = "https://maps.app.goo.gl/MTVGWdpd8vVqTouv9";
    const result = parseGoogleMapsInput(url);
    expect(result.url).toBe(url);
    expect(result.placeId).toBeNull();
    expect(result.isShortUrl).toBe(true);
  });

  it("parses a Place ID string", () => {
    const placeId = "ChIJN1t_tDeuEmsRUsoyG83frY4";
    const result = parseGoogleMapsInput(placeId);
    expect(result.placeId).toBe(placeId);
    expect(result.url).toContain(placeId);
    expect(result.isShortUrl).toBe(false);
  });

  it("parses a CID URL", () => {
    const url = "https://www.google.com/maps?cid=12345678901234567890";
    const result = parseGoogleMapsInput(url);
    expect(result.url).toBe(url);
    expect(result.isShortUrl).toBe(false);
  });

  it("throws on invalid input", () => {
    expect(() => parseGoogleMapsInput("not-a-url")).toThrow("Invalid input");
    expect(() => parseGoogleMapsInput("https://example.com")).toThrow(
      "Invalid input",
    );
  });

  it("trims whitespace", () => {
    const url = "  https://maps.app.goo.gl/abc123  ";
    const result = parseGoogleMapsInput(url);
    expect(result.url).toBe(url.trim());
  });

  it("extracts placeId from ftid parameter", () => {
    const url =
      "https://www.google.com/maps/place/Foo/@0,0?ftid=0x3e2ee3641f7016d7:0x8e3a8bcf52dad296";
    const result = parseGoogleMapsInput(url);
    expect(result.placeId).toBe("0x3e2ee3641f7016d7:0x8e3a8bcf52dad296");
  });

  it("parses a standalone ftid URL", () => {
    const url =
      "https://www.google.com/maps?ftid=0x3e2ee3641f7016d7:0x8e3a8bcf52dad296";
    const result = parseGoogleMapsInput(url);
    expect(result.url).toBe(url);
    expect(result.placeId).toBe("0x3e2ee3641f7016d7:0x8e3a8bcf52dad296");
    expect(result.isShortUrl).toBe(false);
  });

  it("parses ftid URL with additional query parameters", () => {
    const url =
      "https://www.google.com/maps?hl=en&ftid=0x3e2ee3641f7016d7:0x8e3a8bcf52dad296&source=search";
    const result = parseGoogleMapsInput(url);
    expect(result.url).toBe(url);
    expect(result.placeId).toBe("0x3e2ee3641f7016d7:0x8e3a8bcf52dad296");
  });

  it("parses ftid URL on non-.com TLD", () => {
    const url =
      "https://www.google.co.uk/maps?ftid=0x3e2ee3641f7016d7:0x8e3a8bcf52dad296";
    const result = parseGoogleMapsInput(url);
    expect(result.url).toBe(url);
    expect(result.placeId).toBe("0x3e2ee3641f7016d7:0x8e3a8bcf52dad296");
  });

  it("parses ftid URL without www prefix", () => {
    const url =
      "https://google.com/maps?ftid=0x3e2ee3641f7016d7:0x8e3a8bcf52dad296";
    const result = parseGoogleMapsInput(url);
    expect(result.url).toBe(url);
    expect(result.placeId).toBe("0x3e2ee3641f7016d7:0x8e3a8bcf52dad296");
  });

  it("parses ftid URL with trailing slash before query", () => {
    const url =
      "https://www.google.com/maps/?ftid=0x3e2ee3641f7016d7:0x8e3a8bcf52dad296";
    const result = parseGoogleMapsInput(url);
    expect(result.url).toBe(url);
    expect(result.placeId).toBe("0x3e2ee3641f7016d7:0x8e3a8bcf52dad296");
  });

  it("parses ftid URL with uppercase hex digits", () => {
    const url =
      "https://www.google.com/maps?ftid=0x3E2EE3641F7016D7:0x8E3A8BCF52DAD296";
    const result = parseGoogleMapsInput(url);
    expect(result.url).toBe(url);
    expect(result.placeId).toBe("0x3E2EE3641F7016D7:0x8E3A8BCF52DAD296");
  });

  it("parses ftid URL with fragment", () => {
    const url =
      "https://www.google.com/maps?ftid=0x3e2ee3641f7016d7:0x8e3a8bcf52dad296#section";
    const result = parseGoogleMapsInput(url);
    expect(result.placeId).toBe("0x3e2ee3641f7016d7:0x8e3a8bcf52dad296");
  });

  it("accepts ftid URL with malformed value (placeId is null)", () => {
    const url = "https://www.google.com/maps?ftid=invalid";
    const result = parseGoogleMapsInput(url);
    expect(result.url).toBe(url);
    expect(result.placeId).toBeNull();
  });

  it("rejects non-Google domain with ftid parameter", () => {
    expect(() =>
      parseGoogleMapsInput(
        "https://example.com/maps?ftid=0x3e2ee3641f7016d7:0x8e3a8bcf52dad296",
      ),
    ).toThrow("Invalid input");
  });

  it("rejects noftid parameter (substring false positive)", () => {
    expect(() =>
      parseGoogleMapsInput(
        "https://www.google.com/maps?noftid=0x3e2ee3641f7016d7:0x8e3a8bcf52dad296",
      ),
    ).toThrow("Invalid input");
  });

  it("rejects standalone hex value without URL", () => {
    expect(() =>
      parseGoogleMapsInput("0x3e2ee3641f7016d7:0x8e3a8bcf52dad296"),
    ).toThrow("Invalid input");
  });

  it("handles google.co.uk domain", () => {
    const url =
      "https://www.google.co.uk/maps/place/Something/@51.5,-0.1,15z";
    const result = parseGoogleMapsInput(url);
    expect(result.url).toBe(url);
  });
});

describe("isGoogleMapsUrl", () => {
  it("returns true for valid inputs", () => {
    expect(
      isGoogleMapsUrl("https://www.google.com/maps/place/Foo/@0,0"),
    ).toBe(true);
    expect(isGoogleMapsUrl("https://maps.app.goo.gl/abc")).toBe(true);
    expect(isGoogleMapsUrl("ChIJN1t_tDeuEmsRUsoyG83frY4")).toBe(true);
    expect(
      isGoogleMapsUrl(
        "https://www.google.com/maps?ftid=0x3e2ee3641f7016d7:0x8e3a8bcf52dad296",
      ),
    ).toBe(true);
  });

  it("returns true for ftid URL variants", () => {
    expect(
      isGoogleMapsUrl(
        "https://www.google.com/maps?hl=en&ftid=0x3e2ee3641f7016d7:0x8e3a8bcf52dad296",
      ),
    ).toBe(true);
    expect(
      isGoogleMapsUrl(
        "https://google.co.uk/maps?ftid=0x3e2ee3641f7016d7:0x8e3a8bcf52dad296",
      ),
    ).toBe(true);
  });

  it("returns false for non-Maps URLs", () => {
    expect(isGoogleMapsUrl("https://example.com")).toBe(false);
    expect(isGoogleMapsUrl("hello world")).toBe(false);
    expect(
      isGoogleMapsUrl(
        "https://example.com/maps?ftid=0x3e2ee3641f7016d7:0x8e3a8bcf52dad296",
      ),
    ).toBe(false);
  });
});

describe("extractPlaceIdFromUrl", () => {
  it("extracts ftid from query parameter", () => {
    expect(
      extractPlaceIdFromUrl(
        "https://www.google.com/maps?ftid=0x3e2ee3641f7016d7:0x8e3a8bcf52dad296",
      ),
    ).toBe("0x3e2ee3641f7016d7:0x8e3a8bcf52dad296");
  });

  it("extracts placeId from !1s data parameter", () => {
    expect(
      extractPlaceIdFromUrl(
        "https://www.google.com/maps/place/Foo/data=!1s0xabc123:0xdef456",
      ),
    ).toBe("0xabc123:0xdef456");
  });

  it("prioritizes ftid over !1s when both present", () => {
    const url =
      "https://www.google.com/maps/place/Foo/data=!1s0xaaa:0xbbb?ftid=0xccc:0xddd";
    expect(extractPlaceIdFromUrl(url)).toBe("0xccc:0xddd");
  });

  it("returns null when neither pattern matches", () => {
    expect(extractPlaceIdFromUrl("https://www.google.com/maps")).toBeNull();
  });

  it("handles percent-encoded colon (%3A) from URLSearchParams", () => {
    expect(
      extractPlaceIdFromUrl(
        "https://www.google.com/maps?ftid=0x3e2ee3641f7016d7%3A0x8e3a8bcf52dad296&hl=en",
      ),
    ).toBe("0x3e2ee3641f7016d7:0x8e3a8bcf52dad296");
  });

  it("handles uppercase hex digits", () => {
    expect(
      extractPlaceIdFromUrl(
        "https://www.google.com/maps?ftid=0x3E2EE364:0x8E3A8BCF",
      ),
    ).toBe("0x3E2EE364:0x8E3A8BCF");
  });
});
