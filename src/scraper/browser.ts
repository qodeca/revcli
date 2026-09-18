import { join } from "node:path";
import { homedir } from "node:os";
import { mkdirSync, chmodSync } from "node:fs";
import { chromium, type BrowserContext, type Page } from "playwright";
import { logger } from "../utils/logger.js";
import { VOLATILE_STORAGE_TYPES } from "./storage-types.js";

export interface BrowserOptions {
  headless: boolean;
}

export interface BrowserSession {
  context: BrowserContext;
  page: Page;
}

export const PROFILE_DIR = join(homedir(), ".revcli", "chrome-profile");

/**
 * Ensure the persistent Chrome profile directory exists with owner-only
 * permissions (0700). The profile holds Google auth cookies and session state,
 * so other local users must not be able to read it. Playwright's
 * launchPersistentContext creates the dir if missing but does not restrict
 * permissions, so we set them explicitly both before and after launch.
 */
function ensureProfileDir(): void {
  mkdirSync(PROFILE_DIR, { recursive: true, mode: 0o700 });
  chmodSync(PROFILE_DIR, 0o700);
}

export async function launchBrowser(
  options: BrowserOptions,
): Promise<BrowserSession> {
  logger.debug("Launching browser with persistent profile...");

  ensureProfileDir();

  // ToS / anti-automation note: revcli intentionally behaves like a human
  // browser session (persistent profile, spoofed UA, init-script that masks
  // navigator.webdriver) so unauthenticated-EEA scraping works and auth cookies
  // survive between runs. Google's Terms of Service restrict automated access
  // to Maps; this tool is for data you have the right to collect. Use
  // responsibly and only on your own data. See README.
  const context = await chromium.launchPersistentContext(PROFILE_DIR, {
    headless: options.headless,
    args: [
      "--disable-blink-features=AutomationControlled",
      "--disable-dev-shm-usage",
      "--lang=en-US",
    ],
    viewport: { width: 1366, height: 768 },
    locale: "en-US",
    extraHTTPHeaders: { "Accept-Language": "en-US,en;q=0.9" },
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36",
  });

  // Remove navigator.webdriver flag
  await context.addInitScript(() => {
    Object.defineProperty(navigator, "webdriver", {
      get: () => undefined,
    });
  });

  const page = context.pages()[0] ?? (await context.newPage());
  logger.debug("Browser launched");

  return { context, page };
}

const activeContexts = new Set<BrowserContext>();

// Clean up browsers on unexpected termination
process.once("SIGINT", () => {
  const cleanups = [...activeContexts].map((c) => c.close().catch(() => {}));
  Promise.all(cleanups).finally(() => {
    process.exit(130);
  });
});

export function trackBrowser(context: BrowserContext): void {
  activeContexts.add(context);
}

export async function closeBrowser(context: BrowserContext): Promise<void> {
  try {
    await context.close();
    logger.debug("Browser closed");
  } catch {
    // Browser may already be closed
  } finally {
    activeContexts.delete(context);
  }
}

/**
 * Clear volatile per-origin browser state (service workers, cache storage,
 * localStorage, IndexedDB) via CDP. Used between sequential scrapes to prevent
 * cross-contamination from stale SPA state. Cookies are preserved so Google
 * authentication remains intact. Best-effort: logs and continues on failure.
 *
 * The caller passes the target origin so `browser.ts` stays provider-agnostic.
 * Adds ~50-150ms overhead per call (newCDPSession + send + detach).
 *
 * Requires Playwright >=1.11 for `newCDPSession`.
 */
export async function clearVolatileBrowserState(
  page: Page,
  origin: string,
): Promise<void> {
  let cdp: Awaited<ReturnType<BrowserContext["newCDPSession"]>> | null = null;
  try {
    cdp = await page.context().newCDPSession(page);
    await cdp.send("Storage.clearDataForOrigin", {
      origin,
      storageTypes: VOLATILE_STORAGE_TYPES,
    });
    logger.debug(`Cleared volatile browser state for ${origin}`);
  } catch (err) {
    logger.warn(
      `Failed to clear volatile browser state for ${origin}: ${err instanceof Error ? err.message : String(err)}`,
    );
  } finally {
    if (cdp) {
      await cdp.detach().catch(() => {
        // detach failures are non-fatal; session will be reaped when page closes
      });
    }
  }
}
