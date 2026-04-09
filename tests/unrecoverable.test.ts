import { describe, it, expect } from "vitest";
import { isUnrecoverable } from "../src/core/retry.js";

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
