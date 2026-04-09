import { join } from "node:path";
import { homedir } from "node:os";
import { chromium, type BrowserContext, type Page } from "playwright";
import { logger } from "../utils/logger.js";

export interface BrowserOptions {
  headless: boolean;
}

export interface BrowserSession {
  context: BrowserContext;
  page: Page;
}

export const PROFILE_DIR = join(homedir(), ".revcli", "chrome-profile");

export async function launchBrowser(
  options: BrowserOptions,
): Promise<BrowserSession> {
  logger.debug("Launching browser with persistent profile...");

  const context = await chromium.launchPersistentContext(PROFILE_DIR, {
    headless: options.headless,
    args: [
      "--disable-blink-features=AutomationControlled",
      "--no-sandbox",
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
