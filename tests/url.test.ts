import { describe, it, expect } from "vitest";
import { parseGoogleMapsInput, isGoogleMapsUrl } from "../src/utils/url.js";

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
  });

  it("returns false for non-Maps URLs", () => {
    expect(isGoogleMapsUrl("https://example.com")).toBe(false);
    expect(isGoogleMapsUrl("hello world")).toBe(false);
  });
});
