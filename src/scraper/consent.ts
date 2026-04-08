import type { Page } from "playwright";
import { logger } from "../utils/logger.js";

export async function handleConsent(page: Page): Promise<void> {
  const currentUrl = page.url();
  if (!currentUrl.includes("consent.google.com")) return;

  logger.debug("Handling Google consent page...");

  const consentSelectors = [
    'button:has-text("Accept all")',
    'button:has-text("Zaakceptuj wszystko")',
    'button:has-text("Alle akzeptieren")',
    'button:has-text("Accepter tout")',
    'button:has-text("Aceptar todo")',
    'form[action*="consent"] button:nth-child(2)',
    'button[aria-label*="Accept"], button[aria-label*="consent"]',
  ];

  for (const selector of consentSelectors) {
    try {
      const button = page.locator(selector).first();
      if (await button.isVisible({ timeout: 1000 })) {
        await button.click();
        logger.debug("Accepted cookie consent");
        await page.waitForURL(/google\.[a-z.]+\/maps/, { timeout: 15000 });
        await page.waitForLoadState("domcontentloaded");
        return;
      }
    } catch {
      continue;
    }
  }

  logger.warn("Could not find consent button – proceeding anyway");
}

export async function ensureEnglishLocale(page: Page): Promise<void> {
  const currentUrl = page.url();
  if (currentUrl.includes("hl=en")) return;

  const url = new URL(currentUrl);
  url.searchParams.set("hl", "en");

  logger.debug("Forcing English locale...");
  await page.goto(url.toString(), {
    waitUntil: "domcontentloaded",
    timeout: 15000,
  });
}

export function appendHlParam(url: string): string {
  // Short URLs can't have params appended – they redirect
  if (url.includes("maps.app.goo.gl")) return url;
  try {
    const u = new URL(url);
    if (!u.searchParams.has("hl")) {
      u.searchParams.set("hl", "en");
    }
    return u.toString();
  } catch {
    return url;
  }
}
