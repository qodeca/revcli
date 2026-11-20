import { describe, expect, it, vi } from "vitest";
import type { BrowserContext } from "playwright";
import { browserLaunchOptions, closeBrowser, withBrowserSession } from "../src/scraper/browser.js";

/**
 * Issue #33: the scrape's browser must close as soon as its signal aborts
 * (timeout or shutdown), and always when the work ends. Tested with a fake
 * context – no browser, no profile.
 */

function fakeSession() {
  const close = vi.fn().mockResolvedValue(undefined);
  const context = { close } as unknown as BrowserContext;
  return { session: { context }, close };
}

describe("withBrowserSession (issue #33)", () => {
  it("closes the browser as soon as the signal aborts, while the work still runs", async () => {
    const { session, close } = fakeSession();
    const controller = new AbortController();
    let closedDuringWork = false;

    await withBrowserSession(async () => session, controller.signal, async () => {
      controller.abort();
      closedDuringWork = close.mock.calls.length > 0;
    });

    expect(closedDuringWork).toBe(true);
  });

  it("closes the browser when the work fails", async () => {
    const { session, close } = fakeSession();
    await expect(
      withBrowserSession(async () => session, undefined, async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect(close).toHaveBeenCalled();
  });

  it("closes at once and does not start the work when the signal is already aborted", async () => {
    const { session, close } = fakeSession();
    const controller = new AbortController();
    controller.abort(new Error("Location timeout"));
    const body = vi.fn();

    await expect(withBrowserSession(async () => session, controller.signal, body)).rejects.toThrow(
      "Location timeout",
    );
    expect(close).toHaveBeenCalled();
    expect(body).not.toHaveBeenCalled();
  });

  it("stops listening once the work is done", async () => {
    const { session, close } = fakeSession();
    const controller = new AbortController();
    await withBrowserSession(async () => session, controller.signal, async () => "ok");
    const callsAfterWork = close.mock.calls.length;
    controller.abort();
    expect(close.mock.calls.length).toBe(callsAfterWork);
  });
});

describe("closeBrowser (issue #33)", () => {
  it("makes every caller wait for the one close in progress", async () => {
    let finish: () => void = () => {};
    const close = vi.fn(() => new Promise<void>((resolve) => (finish = resolve)));
    const context = { close } as unknown as BrowserContext;

    let firstDone = false;
    let secondDone = false;
    void closeBrowser(context).then(() => (firstDone = true));
    void closeBrowser(context).then(() => (secondDone = true));
    await new Promise((r) => setTimeout(r, 20));

    expect(close).toHaveBeenCalledTimes(1);
    expect(secondDone).toBe(false);
    finish();
    await vi.waitFor(() => expect(firstDone && secondDone).toBe(true));
  });

  it("the session settles only after the browser has finished closing", async () => {
    let finish: () => void = () => {};
    const close = vi.fn(() => new Promise<void>((resolve) => (finish = resolve)));
    const context = { close } as unknown as BrowserContext;
    const controller = new AbortController();

    let settled = false;
    const run = withBrowserSession(async () => ({ context }), controller.signal, async () => {
      controller.abort();
      throw new Error("Target page, context or browser has been closed");
    })
      .catch(() => {})
      .then(() => (settled = true));
    await new Promise((r) => setTimeout(r, 20));
    expect(settled).toBe(false);

    finish();
    await run;
    expect(settled).toBe(true);
  });
});

describe("browserLaunchOptions (issue #33)", () => {
  it("turns off Playwright's own signal handlers, which kept revcli alive after kill", () => {
    const opts = browserLaunchOptions({ headless: true });
    expect(opts.handleSIGTERM).toBe(false);
    expect(opts.handleSIGINT).toBe(false);
    expect(opts.handleSIGHUP).toBe(false);
  });
});
