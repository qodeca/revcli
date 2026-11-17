import { describe, it, expect, vi } from "vitest";
import { withRetry } from "../src/core/retry.js";
import { UnrecoverableError } from "../src/core/errors.js";
import { logger } from "../src/utils/logger.js";

describe("withRetry", () => {
  it("returns result on first success", async () => {
    const fn = vi.fn().mockResolvedValue("ok");
    const result = await withRetry(fn, "test");
    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("retries on failure and succeeds", async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error("fail"))
      .mockResolvedValue("ok");

    const result = await withRetry(fn, "test", {
      maxRetries: 2,
      baseDelayMs: 10,
    });
    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("throws after max retries", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("always fails"));
    await expect(
      withRetry(fn, "test", { maxRetries: 2, baseDelayMs: 10 }),
    ).rejects.toThrow("always fails");
    expect(fn).toHaveBeenCalledTimes(3); // 1 initial + 2 retries
  });

  it("does not retry unrecoverable errors", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("invalid input"));
    await expect(
      withRetry(fn, "test", { maxRetries: 3, baseDelayMs: 10 }),
    ).rejects.toThrow("invalid input");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("does not retry captcha errors", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("captcha detected"));
    await expect(
      withRetry(fn, "test", { maxRetries: 3, baseDelayMs: 10 }),
    ).rejects.toThrow("captcha");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("does not retry Playwright launch errors", async () => {
    const fn = vi
      .fn()
      .mockRejectedValue(new Error("Executable doesn't exist"));
    await expect(
      withRetry(fn, "test", { maxRetries: 3, baseDelayMs: 10 }),
    ).rejects.toThrow("Executable");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("does not retry a typed AUTH_REQUIRED error", async () => {
    const fn = vi
      .fn()
      .mockRejectedValue(new UnrecoverableError("AUTH_REQUIRED", "limited view"));
    await expect(
      withRetry(fn, "test", { maxRetries: 3, baseDelayMs: 10 }),
    ).rejects.toThrow("limited view");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("does not log an UnrecoverableError at error level (the caller prints it once)", async () => {
    const errorSpy = vi.spyOn(logger, "error");
    try {
      const fn = vi.fn().mockRejectedValue(new UnrecoverableError("NOT_A_PLACE", "search page"));
      await expect(
        withRetry(fn, "test", { maxRetries: 3, baseDelayMs: 10 }),
      ).rejects.toThrow("search page");
      expect(errorSpy).not.toHaveBeenCalled();
    } finally {
      errorSpy.mockRestore();
    }
  });

  it("wraps non-Error throwables", async () => {
    const fn = vi.fn().mockRejectedValue("string error");
    await expect(
      withRetry(fn, "test", { maxRetries: 0, baseDelayMs: 10 }),
    ).rejects.toThrow("string error");
  });
});
