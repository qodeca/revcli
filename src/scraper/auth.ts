import type { BrowserContext, Page } from "playwright";
import { logger } from "../utils/logger.js";
import { UnrecoverableError } from "../core/errors.js";
import { handleConsent } from "./consent.js";

/**
 * Google's authoritative signed-in session cookies. Per Google's cookie policy,
 * `SID` and `HSID` contain the digitally signed/encrypted Google Account ID and
 * most recent sign-in time; `__Secure-1PSID`/`__Secure-3PSID` are the hardened
 * variants. Presence of any of these on `.google.com` means the browser has an
 * authenticated Google session. `__Secure-STRP`, `SOCS`, `NID`, etc. are set
 * even when signed out, so they are deliberately excluded.
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
 * Decide the signed-in state. The cookie check is authoritative; the DOM
 * "Sign in" button heuristic is only used when cookie inspection itself fails.
 * On any uncertainty return false so `auth` prompts rather than falsely
 * reporting success. Pure and exported for testability.
 */
export function decideSignedIn(
  cookieCheckSucceeded: boolean,
  hasAuthCookies: boolean,
  signInButtonVisible: boolean,
): boolean {
  if (cookieCheckSucceeded) return hasAuthCookies;
  return !signInButtonVisible;
}

/**
 * Checks if the user is signed in to Google Maps.
 *
 * Cookie-based detection is authoritative: the DOM "Sign in" button heuristic
 * is fragile (Google Maps' SPA may not have rendered it yet, and a stale
 * profile can show a button while the session is already authenticated).
 * Falling back to the DOM heuristic only when cookie inspection itself fails,
 * and returning false (not signed in) on any uncertainty so `auth` prompts
 * rather than falsely reporting success.
 */
export async function isSignedIn(page: Page): Promise<boolean> {
  try {
    const cookies = await page.context().cookies("https://www.google.com");
    return decideSignedIn(
      true,
      hasGoogleAuthSession(cookies.map((cookie) => cookie.name)),
      false,
    );
  } catch {
    try {
      // Exact aria-label match only – `:has-text("Sign in")` is a substring
      // match that can collide with "Sign in to continue" or "Sign out".
      const signInButton = page.locator(
        'a[aria-label="Sign in"], button[aria-label="Sign in"]',
      );
      const visible = await signInButton.first().isVisible({ timeout: 3000 });
      return decideSignedIn(false, false, visible);
    } catch {
      return false;
    }
  }
}

/**
 * Detects the "limited view" banner that Google shows to
 * unauthenticated EEA users.
 */
export async function hasLimitedView(page: Page): Promise<boolean> {
  return page.evaluate(() =>
    document.body.innerText.includes("limited view"),
  );
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
}

/** How a `waitForSignIn` poll loop ended. */
export type SignInOutcome = "signed-in" | "browser-closed";

/**
 * Poll until the user has signed in, re-resolving the active page each tick
 * (sign-in can open a new tab/window or close the original page) and using the
 * authoritative `isSignedIn`/`isGoogleAuthUrl` checks. Shared by
 * `waitForUserAuth` and the `auth login` command so the two poll loops never
 * diverge.
 *
 * Resolves `"signed-in"` once an authenticated Maps page is seen, or
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
          if (await isSignedIn(activePage)) return "signed-in";
          continue;
        }
        // Sign-in completed on another Google page – return to Maps to confirm.
        await activePage.goto("https://www.google.com/maps?hl=en", {
          waitUntil: "domcontentloaded",
          timeout: 30000,
        });
        await handleConsent(activePage);
        await activePage.waitForTimeout(3000);
        if (await isSignedIn(activePage)) return "signed-in";
      }
    } catch (err) {
      if (isClosedContext(err)) return "browser-closed";
      logger.debug(
        `Sign-in poll error (will retry): ${err instanceof Error ? err.message : String(err)}`,
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
  logger.warn(
    "Google Maps is showing a limited view – sign in required for full access.",
  );
  logger.info(
    "Please sign in to your Google account in the browser window.",
  );
  logger.info(
    "The scraper will continue automatically once you're signed in.\n",
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
