import { describe, it, expect } from "vitest";
import {
  isGoogleAuthUrl,
  hasGoogleAuthSession,
} from "../src/scraper/auth.js";

describe("isGoogleAuthUrl", () => {
  it("treats the sign-in identifier page as auth", () => {
    expect(
      isGoogleAuthUrl(
        "https://accounts.google.com/v3/signin/identifier?continue=https%3A%2F%2Fwww.google.com%2Fmaps",
      ),
    ).toBe(true);
  });

  it("treats the password challenge page as auth", () => {
    expect(
      isGoogleAuthUrl(
        "https://accounts.google.com/signin/v2/challenge/abc?hl=en",
      ),
    ).toBe(true);
  });

  it("treats AccountChooser and ServiceLogin as auth", () => {
    expect(isGoogleAuthUrl("https://accounts.google.com/AccountChooser")).toBe(
      true,
    );
    expect(isGoogleAuthUrl("https://accounts.google.com/ServiceLogin")).toBe(
      true,
    );
  });

  it("treats the bare accounts.google.com root as auth", () => {
    expect(isGoogleAuthUrl("https://accounts.google.com/")).toBe(true);
  });

  it("treats oauth endpoints as auth", () => {
    expect(
      isGoogleAuthUrl("https://accounts.google.com/o/oauth2/auth"),
    ).toBe(true);
  });

  it("does not treat myaccount.google.com as part of the auth flow", () => {
    expect(isGoogleAuthUrl("https://myaccount.google.com/")).toBe(false);
  });

  it("does not treat Google Maps as auth", () => {
    expect(isGoogleAuthUrl("https://www.google.com/maps?hl=en")).toBe(false);
  });

  it("does not treat other Google pages as auth", () => {
    expect(isGoogleAuthUrl("https://www.google.com/")).toBe(false);
  });

  it("does not treat non-Google URLs as auth", () => {
    expect(isGoogleAuthUrl("https://example.com/")).toBe(false);
  });
});

describe("hasGoogleAuthSession", () => {
  it("is true when an SID cookie is present", () => {
    expect(hasGoogleAuthSession(["NID", "SOCS", "SID"])).toBe(true);
  });

  it("is true when a hardened __Secure-1PSID cookie is present", () => {
    expect(hasGoogleAuthSession(["NID", "__Secure-1PSID"])).toBe(true);
  });

  it("is true for HSID and the 3PSID variants", () => {
    expect(hasGoogleAuthSession(["HSID"])).toBe(true);
    expect(hasGoogleAuthSession(["__Secure-3PSID"])).toBe(true);
  });

  it("is false for a signed-out profile (only non-auth cookies)", () => {
    expect(
      hasGoogleAuthSession([
        "SEARCH_SAMESITE",
        "SOCS",
        "NID",
        "__Secure-STRP",
      ]),
    ).toBe(false);
  });

  it("is false for an empty cookie set", () => {
    expect(hasGoogleAuthSession([])).toBe(false);
  });
});
