import { join } from "node:path";
import { homedir } from "node:os";
import { mkdirSync, chmodSync } from "node:fs";
import { chromium, type BrowserContext, type Page } from "playwright";
import { logger } from "../utils/logger.js";
import { safeErrorMessage } from "../core/errors.js";
import { VOLATILE_STORAGE_TYPES } from "./storage-types.js";
import { installShutdownHandlers, shutdownSignal } from "../core/shutdown.js";

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

type PersistentLaunchOptions = NonNullable<
  Parameters<typeof chromium.launchPersistentContext>[1]
>;

/**
 * The options every revcli browser is launched with. Exported so the signal
 * test can start a browser exactly like revcli does, on a temporary profile.
 */
export function browserLaunchOptions(options: BrowserOptions): PersistentLaunchOptions {
  return {
    headless: options.headless,
    // revcli owns SIGHUP/SIGINT/SIGTERM (src/core/shutdown.ts). Playwright's
    // own SIGTERM/SIGHUP handlers close browsers without exiting, which kept
    // revcli alive after `kill <pid>` (issue #33); its SIGINT handler raced ours.
    handleSIGHUP: false,
    handleSIGINT: false,
    handleSIGTERM: false,
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
  };
}

/**
 * Launch the persistent revcli browser. Refuses (throws the shutdown reason)
 * once `shutdownSignal` has aborted, and tracks the browser at once so the
 * signal handler closes it.
 */
export async function launchBrowser(
  options: BrowserOptions,
): Promise<BrowserSession> {
  // Never start a browser once revcli is shutting down: it would not be
  // closed by the handler that is already running.
  shutdownSignal.throwIfAborted();
  logger.debug("Launching browser with persistent profile...");

  ensureProfileDir();

  // ToS / anti-automation note: revcli intentionally behaves like a human
  // browser session (persistent profile, spoofed UA, init-script that masks
  // navigator.webdriver) so unauthenticated-EEA scraping works and auth cookies
  // survive between runs. Google's Terms of Service restrict automated access
  // to Maps; this tool is for data you have the right to collect. Use
  // responsibly and only on your own data. See README.

  const context = await chromium.launchPersistentContext(
    PROFILE_DIR,
    browserLaunchOptions(options),
  );
  // Tracked at once, so a signal during the rest of the launch still closes it.
  trackBrowser(context);

  try {
    // Remove navigator.webdriver flag. Passed as a string, not a function, so no
    // transform (tsx/esbuild keepNames injecting `__name`) can ever touch the code
    // that runs in the page – a broken init script would fail silently.
    await context.addInitScript({
      content:
        "Object.defineProperty(navigator, 'webdriver', { get: () => undefined });",
    });

    const page = context.pages()[0] ?? (await context.newPage());
    logger.debug("Browser launched");

    return { context, page };
  } catch (err) {
    // A half-launched browser would keep holding the profile.
    await closeBrowser(context);
    throw err;
  }
}

const activeContexts = new Set<BrowserContext>();

export function trackBrowser(context: BrowserContext): void {
  activeContexts.add(context);
}

/** Close every tracked browser; never throws. */
export async function closeAllBrowsers(): Promise<void> {
  await Promise.all([...activeContexts].map((c) => closeBrowser(c)));
}

/**
 * Close `context` as soon as `signal` aborts (a location timeout or a
 * shutdown). Closing the browser makes every pending Playwright call reject,
 * so the scrape unwinds through its own `finally` and frees the profile.
 * Returns a function that removes the listener.
 */
export function closeOnAbort(context: BrowserContext, signal: AbortSignal): () => void {
  const onAbort = (): void => {
    void closeBrowser(context);
  };
  if (signal.aborted) {
    onAbort();
    return () => {};
  }
  signal.addEventListener("abort", onAbort, { once: true });
  return () => signal.removeEventListener("abort", onAbort);
}

/**
 * Open a browser session, run `body`, and always close the browser – at once
 * when `signal` aborts (a timeout or a shutdown), otherwise when `body`
 * settles. Generic over the session so it is testable with a fake.
 */
export async function withBrowserSession<S extends { context: BrowserContext }, T>(
  launch: () => Promise<S>,
  signal: AbortSignal | undefined,
  body: (session: S) => Promise<T>,
): Promise<T> {
  const session = await launch();
  const stopClosing = signal ? closeOnAbort(session.context, signal) : () => {};
  try {
    // Aborted during launch: the browser is already closing, report why.
    signal?.throwIfAborted();
    return await body(session);
  } finally {
    stopClosing();
    await closeBrowser(session.context);
  }
}

/** Install the SIGHUP/SIGINT/SIGTERM handlers that close every browser and exit. */
export function installBrowserShutdown(): void {
  installShutdownHandlers({
    source: process,
    cleanup: closeAllBrowsers,
    exit: (code) => process.exit(code),
    // SIGHUP only when attached to a terminal: a handler would override the
    // "ignore SIGHUP" that `nohup` sets up for long unattended batches.
    signals: process.stdout.isTTY || process.stderr.isTTY
      ? ["SIGHUP", "SIGINT", "SIGTERM"]
      : ["SIGINT", "SIGTERM"],
  });
}

/** The close in progress per browser, so every caller waits for the same one. */
const closing = new WeakMap<BrowserContext, Promise<void>>();

/**
 * Close a browser; never throws. Every call – the abort listener, the
 * session's `finally`, the signal handler – awaits the same close, because a
 * second `context.close()` returns at once while the first is still running
 * (issue #33: the next place must not start before Chromium has exited).
 */
export function closeBrowser(context: BrowserContext): Promise<void> {
  const inFlight = closing.get(context);
  if (inFlight) return inFlight;
  const done = (async () => {
    try {
      await context.close();
      logger.debug("Browser closed");
    } catch {
      // Browser may already be closed
    } finally {
      activeContexts.delete(context);
    }
  })();
  closing.set(context, done);
  return done;
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
      `Failed to clear volatile browser state for ${origin}: ${safeErrorMessage(err)}`,
    );
  } finally {
    if (cdp) {
      await cdp.detach().catch(() => {
        // detach failures are non-fatal; session will be reaped when page closes
      });
    }
  }
}
