import { existsSync } from "node:fs";
import { rm } from "node:fs/promises";
import { logger } from "../utils/logger.js";
import {
  launchBrowser,
  closeBrowser,
  trackBrowser,
  PROFILE_DIR,
} from "../scraper/browser.js";
import {
  isSignedIn,
  hasLimitedView,
  waitForSignIn,
  waitForBrowserClose,
} from "../scraper/auth.js";
import { handleConsent } from "../scraper/consent.js";
import { UnrecoverableError } from "../core/errors.js";

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

    const alreadySignedIn = await isSignedIn(page);

    console.log(`
  Sign in to your Google account:

  1. Click "Sign in" in the top-right corner
  2. Enter your Google email and password
  3. Complete any 2FA prompts if required
  4. Wait until Google Maps fully loads

  The session is saved to ${PROFILE_DIR} and reused by every later run.
`);

    // This command is the credential-entry step, so it must never short-circuit
    // on an existing session: the window has to stay open for the user to sign
    // in, switch accounts, or sign in again.
    if (alreadySignedIn) {
      logger.info(
        "Already signed in. The browser stays open so you can switch accounts – close the window when you're done.",
      );
      await waitForBrowserClose(context);
      logger.success("Browser closed. Google session saved for later runs.");
      return;
    }

    logger.info(
      "Waiting for sign-in... The browser closes automatically once sign-in is detected (timeout: 5 minutes).",
    );

    const outcome = await waitForSignIn(context, page);
    if (outcome === "browser-closed") {
      logger.warn(
        "Browser closed before sign-in was detected. Run `revcli auth status` to check the saved session.",
      );
      return;
    }
    logger.success("Signed in to Google Maps. Session saved for later runs.");
  } catch (err) {
    // Commander does not await async action handlers, so an escaping
    // UnrecoverableError (the 5-minute timeout) would surface as an unhandled
    // rejection with a raw stack trace.
    if (err instanceof UnrecoverableError) {
      logger.error(err.message);
      process.exitCode = 1;
      return;
    }
    throw err;
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
