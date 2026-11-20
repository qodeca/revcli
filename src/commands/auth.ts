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
  getSessionState,
  waitForSignIn,
  waitForBrowserClose,
  SESSION_PROBE_TIMEOUT_MS,
  type SessionState,
} from "../scraper/auth.js";
import { handleConsent } from "../scraper/consent.js";

const UNCONFIRMED_WARNING = `Google did not confirm the saved session within ${SESSION_PROBE_TIMEOUT_MS / 1000} seconds – trusting the saved cookies.`;
const ALREADY_SIGNED_IN =
  "Already signed in. The browser stays open so you can switch accounts – close the window when you're done.";
const WAITING_FOR_SIGN_IN =
  "Waiting for sign-in... The browser closes automatically once sign-in is detected (timeout: 5 minutes).";

/** One line of command output. */
export interface OutputLine {
  level: "success" | "info" | "warn";
  text: string;
}

/** What `revcli auth status` prints and exits with for a session state. */
export interface StatusOutcome {
  lines: OutputLine[];
  exitCode: 0 | 1;
}

/** What `revcli auth` does for the session state it found at start-up. */
export interface LoginPlan {
  /**
   * "wait-for-close": a real session – keep the window open until the user
   * closes it (#24, account switching). "wait-for-sign-in": poll until sign-in
   * is detected, then close.
   */
  action: "wait-for-close" | "wait-for-sign-in";
  lines: OutputLine[];
}

/** Message M5 and exit code per state. Pure and exported for testability. */
export function statusOutcome(state: SessionState): StatusOutcome {
  switch (state) {
    case "signed-in":
      return {
        lines: [{ level: "success", text: "Signed in to Google. Ready to scrape." }],
        exitCode: 0,
      };
    case "unconfirmed":
      return {
        lines: [
          { level: "success", text: "Signed in to Google. Ready to scrape." },
          { level: "warn", text: UNCONFIRMED_WARNING },
        ],
        exitCode: 0,
      };
    case "expired":
      return {
        lines: [
          {
            level: "warn",
            text: "Not signed in: the saved Google session has expired. Run: revcli auth",
          },
        ],
        exitCode: 1,
      };
    case "signed-out":
      return {
        lines: [{ level: "warn", text: "Not signed in to Google. Run: revcli auth" }],
        exitCode: 1,
      };
  }
}

/** The `revcli auth` start-up decision per state. Pure and exported for testability. */
export function loginPlan(state: SessionState): LoginPlan {
  switch (state) {
    case "signed-in":
      return { action: "wait-for-close", lines: [{ level: "info", text: ALREADY_SIGNED_IN }] };
    case "unconfirmed":
      return {
        action: "wait-for-close",
        lines: [
          { level: "warn", text: UNCONFIRMED_WARNING },
          { level: "info", text: ALREADY_SIGNED_IN },
        ],
      };
    case "expired":
      return {
        action: "wait-for-sign-in",
        lines: [
          { level: "info", text: "The saved Google session has expired – sign in again." },
          { level: "info", text: WAITING_FOR_SIGN_IN },
        ],
      };
    case "signed-out":
      return { action: "wait-for-sign-in", lines: [{ level: "info", text: WAITING_FOR_SIGN_IN }] };
  }
}

function printLines(lines: OutputLine[]): void {
  for (const { level, text } of lines) logger[level](text);
}

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

    const state = await getSessionState(page);

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
    const plan = loginPlan(state);
    printLines(plan.lines);
    if (plan.action === "wait-for-close") {
      await waitForBrowserClose(context);
      logger.success("Browser closed. Google session saved for later runs.");
      return;
    }

    // An AUTH_POLL timeout propagates to the top-level handler in index.ts,
    // which prints its message once without a stack trace.
    const outcome = await waitForSignIn(context, page);
    if (outcome === "browser-closed") {
      logger.warn(
        "Browser closed before sign-in was detected. Run `revcli auth status` to check the saved session.",
      );
      return;
    }
    logger.success("Signed in to Google Maps. Session saved for later runs.");
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

    const outcome = statusOutcome(await getSessionState(page));
    printLines(outcome.lines);
    if (outcome.exitCode !== 0) process.exitCode = outcome.exitCode;
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
