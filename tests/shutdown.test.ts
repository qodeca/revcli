import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import { installShutdownHandlers, SIGNAL_EXIT_CODES } from "../src/core/shutdown.js";
import { hasUnrecoverableKind } from "../src/core/errors.js";

/** A fake `process` that only emits signals. */
function fakeSource() {
  const emitter = new EventEmitter();
  return {
    source: { on: (event: string, fn: () => void) => emitter.on(event, fn) },
    send: (event: "SIGHUP" | "SIGINT" | "SIGTERM") => emitter.emit(event),
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("installShutdownHandlers (issue #33)", () => {
  it("closes the browsers and exits 143 on SIGTERM", async () => {
    const { source, send } = fakeSource();
    const cleanup = vi.fn().mockResolvedValue(undefined);
    const exit = vi.fn();
    installShutdownHandlers({ source, cleanup, exit }, new AbortController());

    send("SIGTERM");
    await vi.waitFor(() => expect(exit).toHaveBeenCalled());

    expect(cleanup).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledWith(SIGNAL_EXIT_CODES.SIGTERM);
    expect(SIGNAL_EXIT_CODES.SIGTERM).toBe(143);
  });

  it("closes the browsers and exits 130 on SIGINT", async () => {
    const { source, send } = fakeSource();
    const cleanup = vi.fn().mockResolvedValue(undefined);
    const exit = vi.fn();
    installShutdownHandlers({ source, cleanup, exit }, new AbortController());

    send("SIGINT");
    await vi.waitFor(() => expect(exit).toHaveBeenCalled());

    expect(cleanup).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledWith(130);
  });

  it("aborts the shutdown signal before cleanup runs, so running work stops", async () => {
    const { source, send } = fakeSource();
    const controller = new AbortController();
    let abortedAtCleanup: boolean | undefined;
    const cleanup = vi.fn(async () => {
      abortedAtCleanup = controller.signal.aborted;
    });
    const exit = vi.fn();
    installShutdownHandlers({ source, cleanup, exit }, controller);

    send("SIGTERM");
    await vi.waitFor(() => expect(exit).toHaveBeenCalled());

    expect(abortedAtCleanup).toBe(true);
  });

  it("still exits when cleanup fails", async () => {
    const { source, send } = fakeSource();
    const exit = vi.fn();
    installShutdownHandlers(
      { source, cleanup: () => Promise.reject(new Error("boom")), exit },
      new AbortController(),
    );

    send("SIGTERM");
    await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(143));
  });

  it("forces the exit when cleanup hangs", async () => {
    vi.useFakeTimers();
    const { source, send } = fakeSource();
    const exit = vi.fn();
    installShutdownHandlers(
      { source, cleanup: () => new Promise<void>(() => {}), exit, forceExitMs: 5_000 },
      new AbortController(),
    );

    send("SIGTERM");
    await vi.advanceTimersByTimeAsync(4_999);
    expect(exit).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(exit).toHaveBeenCalledWith(143);
  });

  it("exits only once when both signals arrive", async () => {
    const { source, send } = fakeSource();
    const exit = vi.fn();
    installShutdownHandlers(
      { source, cleanup: vi.fn().mockResolvedValue(undefined), exit },
      new AbortController(),
    );

    send("SIGTERM");
    send("SIGINT");
    await vi.waitFor(() => expect(exit).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 20));

    expect(exit).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledWith(143);
  });

  it("exits 129 on SIGHUP (terminal closed)", async () => {
    const { source, send } = fakeSource();
    const exit = vi.fn();
    installShutdownHandlers(
      { source, cleanup: vi.fn().mockResolvedValue(undefined), exit },
      new AbortController(),
    );
    send("SIGHUP");
    await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(129));
  });

  it("a second signal exits at once while cleanup still hangs", async () => {
    vi.useFakeTimers();
    const { source, send } = fakeSource();
    const exit = vi.fn();
    installShutdownHandlers(
      { source, cleanup: () => new Promise<void>(() => {}), exit, forceExitMs: 5_000 },
      new AbortController(),
    );

    send("SIGTERM");
    await vi.advanceTimersByTimeAsync(100);
    expect(exit).not.toHaveBeenCalled();
    send("SIGTERM");
    expect(exit).toHaveBeenCalledWith(143);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(exit).toHaveBeenCalledTimes(1);
  });

  it("aborts with a typed SHUTDOWN error, so nothing retries it", async () => {
    const { source, send } = fakeSource();
    const controller = new AbortController();
    installShutdownHandlers(
      { source, cleanup: vi.fn().mockResolvedValue(undefined), exit: vi.fn() },
      controller,
    );
    send("SIGINT");
    expect(hasUnrecoverableKind(controller.signal.reason, "SHUTDOWN")).toBe(true);
  });

  it("handles only the signals it is given (no SIGHUP under nohup)", async () => {
    const { source, send } = fakeSource();
    const exit = vi.fn();
    installShutdownHandlers(
      { source, cleanup: vi.fn().mockResolvedValue(undefined), exit, signals: ["SIGINT", "SIGTERM"] },
      new AbortController(),
    );
    send("SIGHUP");
    await new Promise((r) => setTimeout(r, 20));
    expect(exit).not.toHaveBeenCalled();
    send("SIGTERM");
    await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(143));
  });
});
