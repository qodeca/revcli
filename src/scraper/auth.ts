import type { Page } from "playwright";
import { logger } from "../utils/logger.js";

/**
 * Checks if the user is signed in to Google Maps by looking for
 * the "Sign in" button. If present, the user is not authenticated.
 */
export async function isSignedIn(page: Page): Promise<boolean> {
  try {
    const signInButton = page.locator(
      'a[aria-label="Sign in"], a:has-text("Sign in"), button:has-text("Sign in")',
    );
    const visible = await signInButton.first().isVisible({ timeout: 3000 });
    return !visible;
  } catch {
    // If we can't find the sign-in button, assume signed in
    return true;
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
