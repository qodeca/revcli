import { afterEach, describe, expect, it, vi } from "vitest";
import { runWithTimeout } from "../src/core/timeout.js";
import { hasUnrecoverableKind } from "../src/core/errors.js";

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** A task that runs until aborted, then takes `closeMs` to finish. */
function untilAborted(events: string[], closeMs: number) {
  return (signal: AbortSignal) =>
    new Promise<string>((_, reject) => {
      signal.addEventListener(
        "abort",
        () =>
          setTimeout(() => {
            events.push("closed");
            reject(new Error("closed"));
          }, closeMs),
        { once: true },
      );
    });
}

describe("runWithTimeout (issue #33)", () => {
  it("returns the task's value when it finishes in time", async () => {
    await expect(runWithTimeout(async () => "ok", { timeoutMs: 1_000 })).resolves.toBe("ok");
  });

  it("rethrows the task's own error when it fails in time", async () => {
    await expect(
      runWithTimeout(async () => Promise.reject(new Error("boom")), { timeoutMs: 1_000 }),
    ).rejects.toThrow("boom");
  });

  it("on timeout aborts the task and waits for it to finish before rejecting", async () => {
    const events: string[] = [];
    const err = await runWithTimeout(untilAborted(events, 100), { timeoutMs: 50 }).catch(
      (e: unknown) => e,
    );
    expect(events).toEqual(["closed"]);
    expect(hasUnrecoverableKind(err, "LOCATION_TIMEOUT")).toBe(true);
    expect((err as Error).message).toBe("Location timeout after 0.05s");
  });

  it("passes the timeout as the abort reason", async () => {
    let reason: unknown;
    await runWithTimeout(
      (signal) =>
        new Promise((_, reject) =>
          signal.addEventListener("abort", () => {
            reason = signal.reason;
            reject(signal.reason);
          }),
        ),
      { timeoutMs: 20 },
    ).catch(() => {});
    expect(hasUnrecoverableKind(reason, "LOCATION_TIMEOUT")).toBe(true);
  });

  it("rejects with the timeout even when the task resolves after it", async () => {
    const err = await runWithTimeout(
      async () => {
        await wait(100);
        return "late";
      },
      { timeoutMs: 20 },
    ).catch((e: unknown) => e);
    expect(hasUnrecoverableKind(err, "LOCATION_TIMEOUT")).toBe(true);
  });

  it("reports BROWSER_NOT_CLOSED when the task does not finish within the grace period", async () => {
    const start = Date.now();
    const err = await runWithTimeout(() => new Promise<never>(() => {}), {
      timeoutMs: 20,
      settleGraceMs: 100,
    }).catch((e: unknown) => e);
    expect(hasUnrecoverableKind(err, "BROWSER_NOT_CLOSED")).toBe(true);
    expect(Date.now() - start).toBeLessThan(1_000);
  });

  it("stops the task when the outer signal aborts", async () => {
    const outer = new AbortController();
    setTimeout(() => outer.abort(new Error("shutdown")), 20);
    const err = await runWithTimeout(
      (signal) =>
        new Promise((_, reject) => signal.addEventListener("abort", () => reject(signal.reason))),
      { timeoutMs: 5_000, signal: outer.signal },
    ).catch((e: unknown) => e);
    expect((err as Error).message).toBe("shutdown");
  });

  describe("leaves no timer running (a stray timer kept revcli alive after the last place)", () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    it("after success", async () => {
      vi.useFakeTimers();
      await runWithTimeout(async () => "ok", { timeoutMs: 60_000 });
      expect(vi.getTimerCount()).toBe(0);
    });

    it("after the task fails", async () => {
      vi.useFakeTimers();
      await runWithTimeout(async () => Promise.reject(new Error("x")), { timeoutMs: 60_000 }).catch(() => {});
      expect(vi.getTimerCount()).toBe(0);
    });

    it("after a timeout", async () => {
      vi.useFakeTimers();
      const done = runWithTimeout(
        (signal) => new Promise((_, reject) => signal.addEventListener("abort", () => reject(signal.reason))),
        { timeoutMs: 1_000 },
      ).catch(() => {});
      await vi.advanceTimersByTimeAsync(1_000);
      await done;
      expect(vi.getTimerCount()).toBe(0);
    });
  });
});
