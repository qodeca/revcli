import { existsSync } from "node:fs";
import { rm } from "node:fs/promises";
import { logger } from "../utils/logger.js";
import {
  launchBrowser,
  closeBrowser,
  trackBrowser,
  PROFILE_DIR,
} from "../scraper/browser.js";
import { isSignedIn, hasLimitedView } from "../scraper/auth.js";
import { handleConsent } from "../scraper/consent.js";

export async function authLoginCommand(): Promise<void> {
  logger.info("Opening Google Maps in Chrome...");

  const { context, page } = await launchBrowser({ headless: false });
  trackBrowser(context);

  try {
    await page.goto("https://www.google.com/maps?hl=en", {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });
    await handleConsent(page);
    await page.waitForTimeout(3000);

    if (await isSignedIn(page)) {
      logger.success("Already signed in to Google Maps. No action needed.");
      return;
    }

    console.log(`
  Sign in to your Google account:

  1. Click "Sign in" in the top-right corner
  2. Enter your Google email and password
  3. Complete any 2FA prompts if required
  4. Wait until Google Maps fully loads

  The browser will close automatically once sign-in is detected.
`);

    logger.info("Waiting for sign-in... (timeout: 5 minutes)");

    const maxWaitMs = 300000;
    const pollIntervalMs = 3000;
    const startTime = Date.now();

    while (Date.now() - startTime < maxWaitMs) {
      await page.waitForTimeout(pollIntervalMs);
      const url = page.url();

      if (url.includes("google.com/maps")) {
        if (await isSignedIn(page)) {
          logger.success("Signed in to Google Maps. Session saved.");
          return;
        }
      } else if (
        url.includes("myaccount.google.com") ||
        (url.includes("google.com") &&
          !url.includes("accounts.google.com/signin") &&
          !url.includes("accounts.google.com/v3/signin") &&
          !url.includes("accounts.google.com/o/oauth") &&
          !url.includes("accounts.google.com/ServiceLogin"))
      ) {
        // User completed sign-in on another Google page – go back to Maps
        await page.goto("https://www.google.com/maps?hl=en", {
          waitUntil: "domcontentloaded",
          timeout: 30000,
        });
        await handleConsent(page);
        await page.waitForTimeout(3000);

        if (await isSignedIn(page)) {
          logger.success("Signed in to Google Maps. Session saved.");
          return;
        }
      }
    }

    throw new Error(
      "Timed out waiting for Google sign-in (5 minutes). Please try again.",
    );
  } finally {
    await closeBrowser(context);
  }
}

export async function authStatusCommand(): Promise<void> {
  logger.info("Checking authentication status...");

  const { context, page } = await launchBrowser({ headless: true });
  trackBrowser(context);

  try {
    await page.goto("https://www.google.com/maps?hl=en", {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });
    await handleConsent(page);
    await page.waitForTimeout(3000);

    const signedIn = await isSignedIn(page);
    const limited = await hasLimitedView(page);

    if (signedIn && !limited) {
      logger.success("Signed in to Google Maps. Ready to scrape.");
    } else {
      logger.warn("Not signed in to Google. Run: revcli auth");
      process.exitCode = 1;
    }
  } finally {
    await closeBrowser(context);
  }
}

export async function authLogoutCommand(): Promise<void> {
  if (existsSync(PROFILE_DIR)) {
    await rm(PROFILE_DIR, { recursive: true, force: true });
    logger.success("Browser profile cleared. You are now logged out.");
  } else {
    logger.info("No browser profile found. Already logged out.");
  }
}
