import type { Page } from "playwright";
import type { ParsedUrl } from "../utils/url.js";
import { extractPlaceIdFromUrl } from "../utils/url.js";
import type { Business } from "../core/schema.js";
import { logger } from "../utils/logger.js";
import { SELECTORS } from "./selectors.js";

const SORT_OPTIONS: Record<string, number> = {
  relevant: 0,
  newest: 1,
  highest: 2,
  lowest: 3,
};

export async function navigateToReviews(
  page: Page,
  parsed: ParsedUrl,
  sortOrder: string,
): Promise<Omit<Business, "scrapeDate">> {
  page.on("dialog", async (dialog) => {
    await dialog.accept();
  });

  // Prepare URL with hl=en to avoid double navigation
  const targetUrl = appendHlParam(parsed.url);

  const waitUntil = parsed.isShortUrl ? "networkidle" : "domcontentloaded";
  logger.debug(`Navigating to ${targetUrl}`);
  await page.goto(targetUrl, { waitUntil, timeout: 30000 });

  // Handle Google consent page
  await handleConsent(page);

  // Force English locale if consent redirect stripped hl=en
  await ensureEnglishLocale(page);

  // Wait for the place panel to load
  await page.waitForSelector("h1", { timeout: 15000 });

  // Extract placeId from the resolved URL (useful for short URLs)
  const resolvedUrl = page.url();
  const placeIdFromUrl = extractPlaceIdFromUrl(resolvedUrl);

  const businessInfo = await extractBusinessInfo(page, {
    ...parsed,
    placeId: parsed.placeId ?? placeIdFromUrl,
    url: resolvedUrl,
  });

  await openReviewsTab(page);

  if (sortOrder !== "relevant") {
    await setSortOrder(page, sortOrder);
  }

  return businessInfo;
}

function appendHlParam(url: string): string {
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

async function handleConsent(page: Page): Promise<void> {
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

async function ensureEnglishLocale(page: Page): Promise<void> {
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

async function extractBusinessInfo(
  page: Page,
  parsed: ParsedUrl,
): Promise<Omit<Business, "scrapeDate">> {
  const addressSelector = SELECTORS.addressButton;
  const tabSelector = SELECTORS.tab;

  return await page.evaluate(
    ({ placeId, url, addressSel, tabSel }) => {
      const name =
        document.querySelector("h1")?.textContent?.trim() ?? "Unknown";

      const ratingEl = document.querySelector(
        'div[role="img"][aria-label*="star"], span[aria-hidden="true"]',
      );
      let rating: number | null = null;
      if (ratingEl) {
        const ratingMatch = ratingEl
          .getAttribute("aria-label")
          ?.match(/([\d.]+)/);
        if (ratingMatch) {
          rating = parseFloat(ratingMatch[1]);
        } else {
          const text = ratingEl.textContent?.trim();
          if (text && /^\d+\.?\d*$/.test(text)) {
            rating = parseFloat(text);
          }
        }
      }

      let totalReviews: number | null = null;
      const tabButtons = document.querySelectorAll(tabSel);
      for (const tab of tabButtons) {
        const text = tab.textContent ?? "";
        if (/review/i.test(text)) {
          const countMatch = text.match(/([\d,]+)/);
          if (countMatch) {
            totalReviews = parseInt(countMatch[1].replace(/,/g, ""));
          }
        }
      }

      if (totalReviews === null) {
        const allText = document.body.innerText;
        const countMatch = allText.match(/([\d,]+)\s*reviews?/i);
        if (countMatch) {
          totalReviews = parseInt(countMatch[1].replace(/,/g, ""));
        }
      }

      const addressEl = document.querySelector(addressSel);
      const address = addressEl?.textContent?.trim() ?? null;

      return {
        name,
        placeId: placeId ?? null,
        url,
        address,
        rating,
        totalReviews,
      };
    },
    {
      placeId: parsed.placeId,
      url: parsed.url,
      addressSel: addressSelector,
      tabSel: tabSelector,
    },
  );
}

async function openReviewsTab(page: Page): Promise<void> {
  await page.waitForSelector(SELECTORS.tab, { timeout: 10000 });
  await page.waitForTimeout(1000);

  // Content-based tab detection – find the tab containing "Review" text
  const tabs = page.locator(SELECTORS.tab);
  const tabCount = await tabs.count();
  let clicked = false;

  for (let i = 0; i < tabCount; i++) {
    const text = (await tabs.nth(i).textContent()) ?? "";
    if (/review/i.test(text)) {
      logger.debug(`Clicking tab: "${text.trim()}"`);
      await tabs.nth(i).click();
      clicked = true;
      break;
    }
  }

  if (!clicked) {
    // Fallback for non-English locale remnants
    const reviewsTab = page.locator(
      'button:has-text("Reviews"), button:has-text("Opinie"), button:has-text("Bewertungen")',
    );
    try {
      await reviewsTab.first().click({ timeout: 5000 });
    } catch {
      logger.warn(
        "Could not find Reviews tab – reviews may already be visible",
      );
    }
  }

  await page.waitForSelector(SELECTORS.reviewCard, { timeout: 15000 });
  await page.waitForTimeout(1000);
  logger.debug("Reviews panel loaded");
}

async function setSortOrder(page: Page, sortOrder: string): Promise<void> {
  const sortIndex = SORT_OPTIONS[sortOrder];
  if (sortIndex === undefined) {
    logger.warn(`Unknown sort order "${sortOrder}", using default`);
    return;
  }

  try {
    const sortButton = page.locator(SELECTORS.sortButton);
    await sortButton.first().click({ timeout: 5000 });

    await page.waitForSelector(SELECTORS.sortMenuItem, { timeout: 3000 });

    const menuItems = page.locator(SELECTORS.sortMenuItem);
    const count = await menuItems.count();
    if (sortIndex < count) {
      await menuItems.nth(sortIndex).click();
      logger.debug(`Sort order set to: ${sortOrder}`);
      await page.waitForTimeout(3000);
    }
  } catch {
    logger.warn(`Could not set sort order to "${sortOrder}"`);
  }
}
