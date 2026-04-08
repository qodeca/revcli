import { chromium, type Browser, type Page } from "playwright";
import { logger } from "../utils/logger.js";

export interface BrowserOptions {
  headed: boolean;
}

export interface BrowserSession {
  browser: Browser;
  page: Page;
}

export async function launchBrowser(
  options: BrowserOptions,
): Promise<BrowserSession> {
  logger.debug("Launching browser...");

  const browser = await chromium.launch({
    headless: !options.headed,
    args: [
      "--disable-blink-features=AutomationControlled",
      "--no-sandbox",
      "--disable-dev-shm-usage",
    ],
  });

  const context = await browser.newContext({
    viewport: { width: 1366, height: 768 },
    locale: "en-US",
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  });

  // Remove navigator.webdriver flag
  await context.addInitScript(() => {
    Object.defineProperty(navigator, "webdriver", {
      get: () => undefined,
    });
  });

  const page = await context.newPage();
  logger.debug("Browser launched");

  return { browser, page };
}

let activeBrowser: Browser | null = null;

// Clean up browser on unexpected termination
process.on("SIGINT", async () => {
  if (activeBrowser) {
    await closeBrowser(activeBrowser);
  }
  process.exit(130);
});

export function trackBrowser(browser: Browser): void {
  activeBrowser = browser;
}

export async function closeBrowser(browser: Browser): Promise<void> {
  try {
    await browser.close();
    if (activeBrowser === browser) {
      activeBrowser = null;
    }
    logger.debug("Browser closed");
  } catch {
    // Browser may already be closed
  }
}
