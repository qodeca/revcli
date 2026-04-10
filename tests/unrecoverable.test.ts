import { describe, it, expect } from "vitest";
import { isUnrecoverable } from "../src/core/retry.js";
import { UnrecoverableError } from "../src/core/errors.js";

describe("isUnrecoverable", () => {
  it("detects 'invalid input'", () => {
    expect(isUnrecoverable(new Error("invalid input: not a Maps URL"))).toBe(true);
  });

  it("detects 'invalid url'", () => {
    expect(isUnrecoverable(new Error("invalid url provided"))).toBe(true);
  });

  it("detects 'captcha'", () => {
    expect(isUnrecoverable(new Error("CAPTCHA detected on page"))).toBe(true);
  });

  it("detects 'access denied'", () => {
    expect(isUnrecoverable(new Error("Access Denied by server"))).toBe(true);
  });

  it("detects 'Executable doesn't exist'", () => {
    expect(isUnrecoverable(new Error("Executable doesn't exist at /path"))).toBe(true);
  });

  it("detects 'browser has been closed'", () => {
    expect(isUnrecoverable(new Error("browser has been closed"))).toBe(true);
  });

  it("detects 'browserType.launch'", () => {
    expect(isUnrecoverable(new Error("browserType.launch: failed to launch"))).toBe(true);
  });

  it("detects 'sort verification failed'", () => {
    expect(isUnrecoverable(new Error('Sort verification failed: expected "newest" but sort button shows "Most relevant"'))).toBe(true);
  });

  it("detects 'navigation verification failed'", () => {
    expect(
      isUnrecoverable(
        new Error(
          'Navigation verification failed: expected placeId "0xabc:0xdef" but loaded page resolves to "0x123:0x456"',
        ),
      ),
    ).toBe(true);
  });

  it("detects UnrecoverableError instances via instanceof (structural)", () => {
    // Typed errors bypass the substring match – structural detection is
    // resilient to message edits.
    expect(
      isUnrecoverable(
        new UnrecoverableError("NAV_VERIFY", "anything at all, no magic string needed"),
      ),
    ).toBe(true);
    expect(isUnrecoverable(new UnrecoverableError("SORT_VERIFY", ""))).toBe(true);
  });

  it("matches the exact navigation verification error template thrown by navigator.ts", () => {
    // Pin the exact message shape so retry.ts classifier and navigator.ts
    // thrower cannot silently drift apart. Mirrors navigator.ts:58-62 template.
    const expected = "0x3e2ee5004f7f2f8d:0xc8ef09460ea7172";
    const actual = "0x3e2f002e51674071:0x4534d81cb555dd27";
    const resolvedUrl =
      "https://www.google.com/maps/place/WrongPlace/@0,0/data=!1s0x3e2f002e51674071:0x4534d81cb555dd27";
    const msg = `Navigation verification failed: expected placeId "${expected}" but loaded page resolves to "${actual}" (resolved URL: ${resolvedUrl})`;
    expect(isUnrecoverable(new Error(msg))).toBe(true);
    // Also check the "unknown" fallback used when placeIdFromUrl is null.
    const msgUnknown = `Navigation verification failed: expected placeId "${expected}" but loaded page resolves to "unknown" (resolved URL: https://www.google.com/maps)`;
    expect(isUnrecoverable(new Error(msgUnknown))).toBe(true);
  });

  it("returns false for timeout errors", () => {
    expect(isUnrecoverable(new Error("Navigation timeout of 30000ms exceeded"))).toBe(false);
  });

  it("returns false for network errors", () => {
    expect(isUnrecoverable(new Error("net::ERR_CONNECTION_REFUSED"))).toBe(false);
  });

  it("returns false for generic errors", () => {
    expect(isUnrecoverable(new Error("Something went wrong"))).toBe(false);
  });

  it("is case-insensitive", () => {
    expect(isUnrecoverable(new Error("CAPTCHA DETECTED"))).toBe(true);
    expect(isUnrecoverable(new Error("Invalid Input"))).toBe(true);
  });
});
