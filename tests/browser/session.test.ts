import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Browser, BrowserContext } from "playwright";
import {
  getSessionState,
  POLL_PROBE,
  SESSION_SIGN_IN_STABLE_MS,
  waitForSignIn,
} from "../../src/scraper/auth.js";
import { hasUnrecoverableKind } from "../../src/core/errors.js";
import { logger } from "../../src/utils/logger.js";
import { buildMapsPage, type MapsFixtureOptions } from "./fixtures/maps-page.js";
import { launchTestBrowser, newFixtureContext, newFixturePage, routeFixture } from "./harness.js";

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

/** Made-up values: the context blocks all network, so these never reach Google. */
const FAKE_AUTH_COOKIES = ["SID", "HSID", "SSID", "APISID", "SAPISID", "__Secure-1PSID", "__Secure-3PSID"];
const PII = ["test.user@example.com", "Konto Google"];

let browser: Browser;
let context: BrowserContext;

beforeAll(async () => {
  browser = await launchTestBrowser();
});

afterAll(async () => {
  await browser?.close();
});

beforeEach(async () => {
  context = await newFixtureContext(browser);
});

afterEach(async () => {
  await context?.close();
});

async function addFakeAuthCookies(): Promise<void> {
  await context.addCookies(
    FAKE_AUTH_COOKIES.map((name) => ({
      name,
      value: `revcli-fake-${name}`,
      domain: ".google.com",
      path: "/",
      secure: true,
    })),
  );
}

function page(opts: Partial<MapsFixtureOptions>) {
  return newFixturePage(context, buildMapsPage({ totalReviews: 0, batchSize: 1, ...opts }));
}

async function timed<T>(fn: () => Promise<T>): Promise<{ value: T; ms: number }> {
  const start = Date.now();
  const value = await fn();
  return { value, ms: Date.now() - start };
}

describe("getSessionState (issue #31 findings 3–4)", () => {
  it("reports a dead session (cookies + steady Sign in link) as expired", async () => {
    await addFakeAuthCookies();
    const p = await page({ markerTimeline: [{ atMs: 0, marker: "sign-in" }] });

    const { value, ms } = await timed(() => getSessionState(p));

    expect(value).toBe("expired");
    expect(ms).toBeGreaterThanOrEqual(SESSION_SIGN_IN_STABLE_MS);
  });

  it("uses a longer stability window for the commands than for the poll loop", async () => {
    // "Sign in" for 2 s, then the account link: longer than the poll loop's
    // 1.5 s window, shorter than the commands' 3 s window.
    await addFakeAuthCookies();
    const timeline = [
      { atMs: 0, marker: "sign-in" as const },
      { atMs: 2000, marker: "account" as const },
    ];

    const forCommands = await page({ markerTimeline: timeline });
    expect(await getSessionState(forCommands)).toBe("signed-in");

    const forPolling = await page({ markerTimeline: timeline });
    expect(await getSessionState(forPolling, POLL_PROBE)).toBe("expired");
  });

  it("reports cookies + account link as signed-in", async () => {
    await addFakeAuthCookies();
    const p = await page({ markerTimeline: [{ atMs: 0, marker: "account" }], markerLang: "en" });

    expect(await getSessionState(p)).toBe("signed-in");
  });

  it("reads the markers independently of the page language", async () => {
    await addFakeAuthCookies();
    const account = await page({ markerTimeline: [{ atMs: 0, marker: "account" }], markerLang: "pl" });
    expect(await getSessionState(account)).toBe("signed-in");

    const signIn = await page({ markerTimeline: [{ atMs: 0, marker: "sign-in" }], markerLang: "pl" });
    expect(await getSessionState(signIn)).toBe("expired");
  });

  it("reports signed-out quickly when there are no auth cookies", async () => {
    const p = await page({ markerTimeline: [{ atMs: 0, marker: "sign-in" }] });

    const { value, ms } = await timed(() => getSessionState(p));

    expect(value).toBe("signed-out");
    expect(ms).toBeLessThan(1000);
  });

  it("waits for a slow account marker, and is unconfirmed when none appears", async () => {
    await addFakeAuthCookies();
    const slow = await page({ markerTimeline: [{ atMs: 1500, marker: "account" }] });
    expect(await getSessionState(slow)).toBe("signed-in");

    const none = await page({});
    expect(await getSessionState(none, { timeoutMs: 500 })).toBe("unconfirmed");
  });

  it("never reports a transient Sign in link on a valid session as expired", async () => {
    await addFakeAuthCookies();
    const p = await page({
      markerTimeline: [
        { atMs: 0, marker: "sign-in" },
        { atMs: 800, marker: "account" },
      ],
    });

    expect(await getSessionState(p)).toBe("signed-in");
  });

  it("ignores a hidden duplicate Sign in link earlier in the DOM", async () => {
    await addFakeAuthCookies();
    const p = await page({
      hiddenDuplicateMarker: "sign-in",
      markerTimeline: [{ atMs: 0, marker: "account" }],
    });

    const { value, ms } = await timed(() => getSessionState(p));

    expect(value).toBe("signed-in");
    expect(ms).toBeLessThan(2000);
  });

  it("never logs the account label (name, email)", async () => {
    const spies = (["debug", "info", "warn", "error"] as const).map((level) =>
      vi.spyOn(logger, level),
    );
    try {
      await addFakeAuthCookies();
      for (const markerLang of ["en", "pl"] as const) {
        for (const marker of ["account", "sign-in"] as const) {
          const p = await page({ markerTimeline: [{ atMs: 0, marker }], markerLang });
          await getSessionState(p, POLL_PROBE);
        }
      }
      const unconfirmed = await page({ hiddenDuplicateMarker: "account" });
      await getSessionState(unconfirmed, { timeoutMs: 300 });

      const logged = spies.flatMap((s) => s.mock.calls).map((args) => args.map(String).join(" "));
      expect(logged.length).toBeGreaterThan(0);
      for (const line of logged) {
        for (const secret of PII) expect(line).not.toContain(secret);
      }
    } finally {
      for (const spy of spies) spy.mockRestore();
    }
  });
});

// The real session probe inside the sign-in poll loop (no injected `probe`).
// A cookie-only check would report "signed-in" for the dead session below.
describe("waitForSignIn with the real session probe", () => {
  const MAPS_HOME = "https://www.google.com/maps?hl=en";
  const isMapsHome = (u: URL) => u.hostname === "www.google.com" && u.pathname === "/maps";

  it("keeps waiting on a dead session (cookies + steady Sign in link) and times out", async () => {
    await addFakeAuthCookies();
    await routeFixture(
      context,
      isMapsHome,
      buildMapsPage({ totalReviews: 0, batchSize: 1, markerTimeline: [{ atMs: 0, marker: "sign-in" }] }),
    );
    const p = await context.newPage();
    await p.goto(MAPS_HOME);

    const err = await waitForSignIn(context, p, { timeoutMs: 8000, pollIntervalMs: 50 }).catch(
      (e: unknown) => e,
    );

    expect(hasUnrecoverableKind(err, "AUTH_POLL")).toBe(true);
  });

  it("returns signed-in once Google shows the account link", async () => {
    await addFakeAuthCookies();
    await routeFixture(
      context,
      isMapsHome,
      buildMapsPage({ totalReviews: 0, batchSize: 1, markerTimeline: [{ atMs: 0, marker: "account" }] }),
    );
    const p = await context.newPage();
    await p.goto(MAPS_HOME);

    await expect(waitForSignIn(context, p, { timeoutMs: 8000, pollIntervalMs: 50 })).resolves.toBe(
      "signed-in",
    );
  });
});
