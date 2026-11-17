import type { Page } from "playwright";
import { logger } from "../utils/logger.js";
import { isShortLinkUrl } from "../utils/url.js";

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

/** Query parameters that trigger Google's limited view; see appendHlParam. */
const LIMITED_VIEW_PARAMS = ["g_ep", "entry"] as const;

/**
 * The URL to navigate to so the page is English, or null when the current URL
 * already is (or cannot be rewritten: unparseable, or still a short link).
 * Decides from parsed query parameters, not substrings, so `hl=en-GB` or an
 * `hl=en` inside another parameter's value does not count.
 *
 * With `stripLimitedViewParams` the tracking params that trigger the limited
 * view also force a navigation. That is only wanted right after a short-link
 * redirect, the one case where they were not stripped before the page loaded;
 * otherwise Google's own page script may add them back and every scrape would
 * pay a second page load. Pure and exported for testability.
 */
export function englishLocaleTarget(
  currentUrl: string,
  options: { stripLimitedViewParams?: boolean } = {},
): string | null {
  let params: URLSearchParams;
  try {
    params = new URL(currentUrl).searchParams;
  } catch {
    return null;
  }
  if (isShortLinkUrl(currentUrl)) return null;
  const isEnglish = params.get("hl") === "en";
  const hasLimitedViewParam =
    options.stripLimitedViewParams === true &&
    LIMITED_VIEW_PARAMS.some((p) => params.has(p));
  if (isEnglish && !hasLimitedViewParam) return null;
  return appendHlParam(currentUrl);
}

export async function ensureEnglishLocale(
  page: Page,
  options: { stripLimitedViewParams?: boolean } = {},
): Promise<void> {
  const target = englishLocaleTarget(page.url(), options);
  if (target === null) return;

  logger.debug("Forcing English locale...");
  await page.goto(target, {
    waitUntil: "domcontentloaded",
    timeout: 15000,
  });
}

export function appendHlParam(url: string): string {
  // Short URLs can't have params appended – they redirect
  if (isShortLinkUrl(url)) return url;
  try {
    const u = new URL(url);
    u.searchParams.set("hl", "en");
    // Remove tracking/experiment params that trigger Google's "limited view",
    // which hides the Reviews tab entirely. The combination of entry=ttu and
    // g_ep causes this – stripping both is the safe fix.
    for (const param of LIMITED_VIEW_PARAMS) u.searchParams.delete(param);
    return u.toString();
  } catch {
    return url;
  }
}
