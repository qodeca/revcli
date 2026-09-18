import { describe, it, expect } from "vitest";
import type { BrowserContext, Page } from "playwright";
import {
  isGoogleAuthUrl,
  hasGoogleAuthSession,
  decideSignedIn,
  GOOGLE_AUTH_COOKIES,
  waitForBrowserClose,
  waitForSignIn,
  waitForUserAuth,
  type ClosableBrowser,
} from "../src/scraper/auth.js";
import { UnrecoverableError } from "../src/core/errors.js";

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

  it("is true for every cookie in GOOGLE_AUTH_COOKIES", () => {
    // Pin the whole authoritative set so a name dropped from the source of
    // truth can never silently pass here. The presence of any one of these
    // on `.google.com` means an authenticated session.
    for (const name of GOOGLE_AUTH_COOKIES) {
      expect(hasGoogleAuthSession([name])).toBe(true);
    }
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

describe("decideSignedIn", () => {
  it("uses the authoritative cookie result when cookie inspection succeeds", () => {
    expect(decideSignedIn(true, true, false)).toBe(true);
    expect(decideSignedIn(true, false, false)).toBe(false);
    expect(decideSignedIn(true, false, true)).toBe(false);
  });

  it("falls back to the DOM sign-in button when cookie inspection fails", () => {
    // No "Sign in" button rendered => treated as signed in.
    expect(decideSignedIn(false, false, false)).toBe(true);
    // "Sign in" button rendered => not signed in.
    expect(decideSignedIn(false, false, true)).toBe(false);
  });
});

/**
 * Stand-in for a BrowserContext covering only the surface the waiters touch.
 * `ClosableBrowser` exists as a narrow structural type precisely so this needs
 * no cast and no real browser.
 */
class FakeBrowser implements ClosableBrowser {
  private pageCount: number;
  private listeners = new Set<() => void>();

  constructor(pageCount: number) {
    this.pageCount = pageCount;
  }

  pages(): readonly unknown[] {
    return Array.from({ length: this.pageCount }, () => ({}));
  }

  once(_event: "close", listener: () => void): unknown {
    this.listeners.add(listener);
    return this;
  }

  off(_event: "close", listener: () => void): unknown {
    this.listeners.delete(listener);
    return this;
  }

  /** Simulate the user closing the browser window. */
  closeWindow(): void {
    this.pageCount = 0;
  }

  /** Simulate the context's own `close` event firing. */
  emitClose(): void {
    for (const listener of this.listeners) listener();
  }

  get listenerCount(): number {
    return this.listeners.size;
  }
}

/** Fake page + context pair for driving waitForSignIn. */
function makePage(url: string, cookieNames: string[] = []) {
  const page = {
    waitForTimeout: async () => {},
    url: () => url,
    context: () => ({
      cookies: async () => cookieNames.map((name) => ({ name })),
    }),
  };
  return {
    page: page as unknown as Page,
    context: { pages: () => [page] } as unknown as BrowserContext,
  };
}

describe("waitForBrowserClose", () => {
  it("resolves immediately when no window is open", async () => {
    await expect(waitForBrowserClose(new FakeBrowser(0), 5)).resolves.toBeUndefined();
  });

  it("resolves once the last page is gone", async () => {
    const browser = new FakeBrowser(1);
    const waited = waitForBrowserClose(browser, 5);
    setTimeout(() => browser.closeWindow(), 15);
    await expect(waited).resolves.toBeUndefined();
  });

  it("resolves when the context close event fires", async () => {
    const browser = new FakeBrowser(1);
    const waited = waitForBrowserClose(browser, 5);
    setTimeout(() => browser.emitClose(), 15);
    await expect(waited).resolves.toBeUndefined();
  });

  it("keeps waiting while a page is still open", async () => {
    const browser = new FakeBrowser(1);
    let resolved = false;
    const waited = waitForBrowserClose(browser, 5).then(() => {
      resolved = true;
    });

    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(resolved).toBe(false);

    browser.closeWindow();
    await waited;
    expect(resolved).toBe(true);
  });

  it("treats a context whose pages() throws as closed", async () => {
    const browser: ClosableBrowser = {
      pages: () => {
        throw new Error("context has been closed");
      },
      once: () => {},
      off: () => {},
    };
    await expect(waitForBrowserClose(browser, 5)).resolves.toBeUndefined();
  });

  it("removes its close listener once it resolves", async () => {
    const browser = new FakeBrowser(1);
    const waited = waitForBrowserClose(browser, 5);
    browser.closeWindow();
    await waited;
    expect(browser.listenerCount).toBe(0);
  });
});

describe("waitForSignIn", () => {
  it("returns signed-in for an authenticated Maps page", async () => {
    const { page, context } = makePage(
      "https://www.google.com/maps?hl=en",
      ["SID"],
    );
    await expect(
      waitForSignIn(context, page, { timeoutMs: 1000, pollIntervalMs: 5 }),
    ).resolves.toBe("signed-in");
  });

  it("returns browser-closed when the user closed the window", async () => {
    const context = { pages: () => [] } as unknown as BrowserContext;
    await expect(
      waitForSignIn(context, {} as unknown as Page),
    ).resolves.toBe("browser-closed");
  });

  it("throws a typed AUTH_POLL timeout when sign-in never completes", async () => {
    const { page, context } = makePage("https://example.com/");
    const err = await waitForSignIn(context, page, {
      timeoutMs: 30,
      pollIntervalMs: 5,
    }).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(UnrecoverableError);
    expect((err as UnrecoverableError).kind).toBe("AUTH_POLL");
  });
});

describe("waitForUserAuth", () => {
  it("treats a closed window as fatal for the scrape flow", async () => {
    const page = {
      goto: async () => {},
      context: () => ({ pages: () => [] }),
    } as unknown as Page;

    const err = await waitForUserAuth(page).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(UnrecoverableError);
    expect((err as UnrecoverableError).kind).toBe("AUTH_POLL");
  });
});
