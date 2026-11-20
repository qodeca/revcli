import type { BrowserContext, Locator, Page } from "playwright";
import { logger } from "../utils/logger.js";
import { UnrecoverableError, safeErrorMessage } from "../core/errors.js";
import { handleConsent } from "./consent.js";
import { SELECTORS, TEXT_MARKERS } from "./selectors.js";

/** How long `getSessionState` waits for an account marker by default (`auth`, `auth status`). */
export const SESSION_PROBE_TIMEOUT_MS = 15000;
/** Marker wait per probe inside polling loops and on the scrape's failure path. */
export const POLL_PROBE_TIMEOUT_MS = 5000;
/**
 * A "Sign in" link seen with auth cookies must stay the only marker this long
 * to count as an expired session. `auth` and `auth status` report the state to
 * the user once, so they wait longer than the sign-in poll loop, which simply
 * asks again on its next tick.
 */
export const SESSION_SIGN_IN_STABLE_MS = 3000;
/** Stability window inside polling loops and on the scrape's failure path. */
export const POLL_SIGN_IN_STABLE_MS = 1500;

/** Options for `getSessionState`. */
export interface SessionProbeOptions {
  /** Total wait for an account marker. Default SESSION_PROBE_TIMEOUT_MS. */
  timeoutMs?: number;
  /** Stability window for a "Sign in" link with auth cookies. Default SESSION_SIGN_IN_STABLE_MS. */
  stableMs?: number;
}

/** The probe used by polling loops and the scrape's failure path. */
export const POLL_PROBE: Required<SessionProbeOptions> = {
  timeoutMs: POLL_PROBE_TIMEOUT_MS,
  stableMs: POLL_SIGN_IN_STABLE_MS,
};

/**
 * Google's signed-in session cookies. Per Google's cookie policy, `SID` and
 * `HSID` contain the digitally signed/encrypted Google Account ID and most
 * recent sign-in time; `__Secure-1PSID`/`__Secure-3PSID` are the hardened
 * variants. Their presence on `.google.com` proves a session *exists* – not
 * that Google still *accepts* it: an expired session keeps its cookies while
 * Maps shows the "Sign in" link. `getSessionState` therefore combines them
 * with the account marker on the page. `__Secure-STRP`, `SOCS`, `NID`, etc. are
 * set even when signed out, so they are deliberately excluded.
 *
 * A `ReadonlySet` (not a const array) so the membership test is O(1) and no
 * widening cast is needed in `hasGoogleAuthSession`.
 */
export const GOOGLE_AUTH_COOKIES: ReadonlySet<string> = new Set([
  "SID",
  "HSID",
  "SSID",
  "APISID",
  "SAPISID",
  "__Secure-1PSID",
  "__Secure-3PSID",
  "__Secure-1PAPISID",
  "__Secure-3PAPISID",
]);

/**
 * Pure predicate: true when any cookie name indicates a signed-in Google
 * session. Extracted for testability (the repo convention for pure logic).
 */
export function hasGoogleAuthSession(
  cookieNames: readonly string[],
): boolean {
  return cookieNames.some((name) => GOOGLE_AUTH_COOKIES.has(name));
}

/**
 * The Google session as seen from a Maps page – the single source of truth for
 * `auth`, `auth status` and the sign-in wait:
 * - signed-in: Google shows the account link
 * - expired: auth cookies are present but Google shows the "Sign in" link
 * - signed-out: no auth cookies (or no cookies readable and a "Sign in" link)
 * - unconfirmed: auth cookies are present but no stable marker appeared in time
 */
export type SessionState = "signed-in" | "expired" | "signed-out" | "unconfirmed";

/** Which account marker was visible: the account link, the "Sign in" link, or neither. */
export type AccountMarker = "account" | "sign-in" | "none";

/** Result of reading the `.google.com` cookies. `ok` is false when reading failed. */
export interface CookieState {
  ok: boolean;
  hasAuthCookies: boolean;
}

/**
 * Combine the cookie check and the account marker into a session state. Pure
 * and exported for testability.
 */
export function decideSessionState(
  cookies: CookieState,
  marker: AccountMarker,
): SessionState {
  if (cookies.ok && !cookies.hasAuthCookies) return "signed-out";
  if (marker === "account") return "signed-in";
  if (marker === "sign-in") return cookies.hasAuthCookies ? "expired" : "signed-out";
  if (cookies.ok && cookies.hasAuthCookies) return "unconfirmed";
  return "signed-out";
}

async function readCookieState(page: Page): Promise<CookieState> {
  try {
    const cookies = await page.context().cookies("https://www.google.com");
    return {
      ok: true,
      hasAuthCookies: hasGoogleAuthSession(cookies.map((c) => c.name)),
    };
  } catch {
    return { ok: false, hasAuthCookies: false };
  }
}

/** Visible-match presence check (never `isVisible()` on a multi-match locator). */
async function isShown(locator: Locator): Promise<boolean> {
  return (await locator.filter({ visible: true }).count()) > 0;
}

/**
 * Wait (up to `timeoutMs`) for a stable account marker. The account link
 * always wins. A "Sign in" link counts at once without auth cookies; with
 * auth cookies it must still be shown, with no account link, after
 * `stableMs` – Google can render "Sign in" briefly before it confirms
 * a valid session. A stability window cut short by the deadline yields "none".
 *
 * Every error maps to "none" and nothing from Playwright is logged: its error
 * call logs print element markup, and the account link's label holds the
 * user's name and email.
 */
async function readAccountMarker(
  page: Page,
  timeoutMs: number,
  stableMs: number,
  hasAuthCookies: boolean,
): Promise<AccountMarker> {
  const deadline = Date.now() + timeoutMs;
  const account = page.locator(SELECTORS.accountButton);
  const signIn = page.locator(SELECTORS.signInLink);
  try {
    while (Date.now() < deadline) {
      await account
        .or(signIn)
        .filter({ visible: true })
        .first()
        .waitFor({ state: "visible", timeout: Math.max(1, deadline - Date.now()) });

      if (await isShown(account)) return "account";
      if (!(await isShown(signIn))) continue;
      if (!hasAuthCookies) return "sign-in";

      const remaining = deadline - Date.now();
      if (remaining < stableMs) {
        await page.waitForTimeout(Math.max(0, remaining));
        return (await isShown(account)) ? "account" : "none";
      }
      await page.waitForTimeout(stableMs);
      if (await isShown(account)) return "account";
      if (await isShown(signIn)) return "sign-in";
    }
  } catch {
    // Timeout, closed page, navigation – all mean "no confirmed marker".
  }
  return "none";
}

/**
 * Read the Google session state from the current Maps page: cookies first
 * (no auth cookies is a fast "signed-out" with no DOM wait), then the account
 * marker, waited for up to `timeoutMs`. Never throws for page errors.
 */
export async function getSessionState(
  page: Page,
  {
    timeoutMs = SESSION_PROBE_TIMEOUT_MS,
    stableMs = SESSION_SIGN_IN_STABLE_MS,
  }: SessionProbeOptions = {},
): Promise<SessionState> {
  const cookies = await readCookieState(page);
  if (cookies.ok && !cookies.hasAuthCookies) {
    logger.debug("Session state: signed-out (no auth cookies)");
    return "signed-out";
  }
  const marker = await readAccountMarker(page, timeoutMs, stableMs, cookies.hasAuthCookies);
  const state = decideSessionState(cookies, marker);
  logger.debug(`Session state: ${state} (marker: ${marker}, cookies read: ${cookies.ok})`);
  return state;
}

/**
 * Detects Google's limited-view banner ("You’re seeing a limited view of
 * Google Maps"). Matches the phrase only in rendered text outside review cards
 * and outside script/style content, so a review quoting the banner or a
 * string in Google's inline scripts cannot trigger a hard failure.
 */
export async function hasLimitedView(page: Page): Promise<boolean> {
  return page.evaluate(
    ({ marker, cardSel }) => {
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const parent = node.parentElement;
        if (!parent) continue;
        if (!(node.textContent ?? "").toLowerCase().includes(marker)) continue;
        if (parent.closest(cardSel)) continue;
        if (parent.closest("script, style, noscript, template")) continue;
        if (parent.getClientRects().length === 0) continue;
        return true;
      }
      return false;
    },
    { marker: TEXT_MARKERS.limitedViewBanner, cardSel: SELECTORS.reviewCard },
  );
}

/**
 * The limited-view error text (M1 / M1b). The wording depends on what the
 * session probe saw, so a profile that `auth status` reports as signed in is
 * not simply told to "sign in" again with no hint.
 */
export function authRequiredMessage(state?: SessionState): string {
  if (state === "signed-in" || state === "unconfirmed") {
    return (
      "Google Maps is showing a limited view even though this browser profile appears to be signed in. " +
      "Run `revcli auth` to sign in again or switch accounts, then run this command again. " +
      "If it keeps happening, run without --headless to see what Google shows."
    );
  }
  return (
    "Google Maps is showing a limited view: this browser profile is not signed in to Google, " +
    "or its saved session has expired. Run `revcli auth` to sign in, then run this command again."
  );
}

/** The typed, non-retried limited-view error (kind `AUTH_REQUIRED`). */
export function authRequiredError(state?: SessionState): UnrecoverableError {
  return new UnrecoverableError("AUTH_REQUIRED", authRequiredMessage(state));
}

/**
 * True when the URL is still inside the Google account sign-in flow.
 * Any `accounts.google.com` page (identifier, challenge, AccountChooser,
 * ServiceLogin, oauth, bare root) means the user is mid-sign-in and we must
 * NOT navigate away – doing so races the pending login redirect and closes
 * the browser. `myaccount.google.com` is the post-sign-in landing page and is
 * deliberately not treated as part of the auth flow.
 */
export function isGoogleAuthUrl(url: string): boolean {
  return (
    url.includes("accounts.google.com") &&
    !url.includes("myaccount.google.com")
  );
}

/** True when the error indicates a closed page/context. */
function isClosedContext(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /target closed|has been closed|browser has been closed/i.test(msg);
}

export interface SignInWaitOptions {
  timeoutMs?: number;
  pollIntervalMs?: number;
  /**
   * Reads the session state of a Maps page. Defaults to `getSessionState`
   * with POLL_PROBE (5 s marker wait, 1.5 s stability); injectable so tests need no
   * real browser.
   */
  probe?: (page: Page) => Promise<SessionState>;
}

/** How a `waitForSignIn` poll loop ended. */
export type SignInOutcome = "signed-in" | "browser-closed";

/**
 * Poll until the user has signed in, re-resolving the active page each tick
 * (sign-in can open a new tab/window or close the original page) and using the
 * session probe (`getSessionState` by default) and `isGoogleAuthUrl`. Shared
 * by `waitForUserAuth` and the `auth login` command so the two poll loops
 * never diverge.
 *
 * Resolves `"signed-in"` only when the probe reports `signed-in` (an
 * `unconfirmed` state keeps polling, so the window is never closed on a
 * guess), or
 * `"browser-closed"` when the user closes the window first – the caller
 * decides whether that is a failure (the scrape flow, which cannot continue)
 * or a normal end (the `auth` command). Throws a typed
 * `UnrecoverableError("AUTH_POLL", …)` on timeout instead of leaking a raw
 * "Target closed" error.
 */
export async function waitForSignIn(
  context: BrowserContext,
  initialPage: Page,
  options: SignInWaitOptions = {},
): Promise<SignInOutcome> {
  const { timeoutMs = 300000, pollIntervalMs = 2000 } = options;
  const probe =
    options.probe ??
    ((p: Page) => getSessionState(p, POLL_PROBE));
  const startTime = Date.now();

  while (Date.now() - startTime < timeoutMs) {
    try {
      const pages = context.pages();
      // The user closed the browser window instead of signing in.
      if (pages.length === 0) return "browser-closed";
      const activePage = pages[pages.length - 1] ?? initialPage;
      await activePage.waitForTimeout(pollIntervalMs);

      const url = activePage.url();
      // Still inside the sign-in flow – keep waiting, never navigate away.
      if (isGoogleAuthUrl(url)) continue;

      if (
        url.includes("google.com") ||
        url.includes("myaccount.google.com")
      ) {
        if (url.includes("google.com/maps")) {
          if ((await probe(activePage)) === "signed-in") return "signed-in";
          continue;
        }
        // Sign-in completed on another Google page – return to Maps to confirm.
        await activePage.goto("https://www.google.com/maps?hl=en", {
          waitUntil: "domcontentloaded",
          timeout: 30000,
        });
        await handleConsent(activePage);
        await activePage.waitForTimeout(3000);
        if ((await probe(activePage)) === "signed-in") return "signed-in";
      }
    } catch (err) {
      if (isClosedContext(err)) return "browser-closed";
      logger.debug(
        `Sign-in poll error (will retry): ${safeErrorMessage(err)}`,
      );
    }
  }

  throw new UnrecoverableError(
    "AUTH_POLL",
    `Timed out waiting for Google sign-in (${Math.round(timeoutMs / 1000)} seconds).`,
  );
}

/**
 * Minimal structural view of a browser context. `waitForBrowserClose` only
 * needs to observe whether any page is still open and to react to the
 * context's `close` event; narrowing the parameter keeps the helper testable
 * without a real browser. `BrowserContext` satisfies it structurally.
 */
export interface ClosableBrowser {
  pages(): readonly unknown[];
  once(event: "close", listener: () => void): unknown;
  off(event: "close", listener: () => void): unknown;
}

/**
 * Resolves once the user has closed the browser window.
 *
 * Used by `revcli auth` when the profile is already authenticated: there is no
 * sign-in to detect, so the window stays open for switching accounts or
 * signing in again, and the user closing it is the only end state. Polls
 * `pages()` in addition to the `close` event because closing the last window
 * on macOS leaves the browser process – and therefore the context – alive.
 */
export async function waitForBrowserClose(
  browser: ClosableBrowser,
  pollIntervalMs = 1000,
): Promise<void> {
  let closed = false;
  const onClose = () => {
    closed = true;
  };
  browser.once("close", onClose);

  try {
    while (!closed && !hasNoPages(browser)) {
      await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
    }
  } finally {
    browser.off("close", onClose);
  }
}

function hasNoPages(browser: ClosableBrowser): boolean {
  try {
    return browser.pages().length === 0;
  } catch {
    return true;
  }
}

/**
 * Waits for the user to sign in to Google Maps interactively.
 * Opens the Google sign-in page and polls until authentication is detected.
 */
export async function waitForUserAuth(page: Page): Promise<void> {
  logger.warn("Google Maps is showing a limited view – sign in to continue.");
  logger.info(
    "Sign in to your Google account in the browser window. The scrape continues automatically once sign-in is detected (timeout: 5 minutes).",
  );

  // Navigate to Google sign-in
  await page.goto("https://accounts.google.com/signin", {
    waitUntil: "domcontentloaded",
    timeout: 30000,
  });

  const outcome = await waitForSignIn(page.context(), page);
  // A scrape cannot continue without a session, so a closed window is fatal
  // here even though `revcli auth` treats it as a normal end.
  if (outcome === "browser-closed") {
    throw new UnrecoverableError(
      "AUTH_POLL",
      "Browser closed before sign-in was detected.",
    );
  }
  logger.success("Sign-in detected – continuing scrape.");
}
