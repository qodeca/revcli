import type { Page } from "playwright";
import { logger } from "../utils/logger.js";

/**
 * Google's authoritative signed-in session cookies. Per Google's cookie policy,
 * `SID` and `HSID` contain the digitally signed/encrypted Google Account ID and
 * most recent sign-in time; `__Secure-1PSID`/`__Secure-3PSID` are the hardened
 * variants. Presence of any of these on `.google.com` means the browser has an
 * authenticated Google session. `__Secure-STRP`, `SOCS`, `NID`, etc. are set
 * even when signed out, so they are deliberately excluded.
 */
export const GOOGLE_AUTH_COOKIES = [
  "SID",
  "HSID",
  "SSID",
  "APISID",
  "SAPISID",
  "__Secure-1PSID",
  "__Secure-3PSID",
  "__Secure-1PAPISID",
  "__Secure-3PAPISID",
] as const;

/**
 * Pure predicate: true when any cookie name indicates a signed-in Google
 * session. Extracted for testability (the repo convention for pure logic).
 */
export function hasGoogleAuthSession(
  cookieNames: readonly string[],
): boolean {
  return cookieNames.some((name) =>
    (GOOGLE_AUTH_COOKIES as readonly string[]).includes(name),
  );
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
    return hasGoogleAuthSession(cookies.map((cookie) => cookie.name));
  } catch {
    try {
      const signInButton = page.locator(
        'a[aria-label="Sign in"], a:has-text("Sign in"), button:has-text("Sign in")',
      );
      const visible = await signInButton.first().isVisible({ timeout: 3000 });
      return !visible;
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
  return url.includes("accounts.google.com") && !url.includes("myaccount.google.com");
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

  // Poll until signed in (check for profile avatar or myaccount redirect)
  const maxWaitMs = 300000; // 5 minutes
  const pollIntervalMs = 2000;
  const startTime = Date.now();

  while (Date.now() - startTime < maxWaitMs) {
    await page.waitForTimeout(pollIntervalMs);

    const url = page.url();
    // User has completed sign-in if redirected to myaccount or main Google page
    if (
      url.includes("myaccount.google.com") ||
      (url.includes("google.com") &&
        !url.includes("accounts.google.com/signin") &&
        !url.includes("accounts.google.com/v3/signin") &&
        !url.includes("accounts.google.com/o/oauth") &&
        !url.includes("accounts.google.com/ServiceLogin"))
    ) {
      logger.success("Sign-in detected – continuing scrape.");
      return;
    }
  }

  throw new Error(
    "Timed out waiting for Google sign-in (5 minutes). Please try again.",
  );
}
