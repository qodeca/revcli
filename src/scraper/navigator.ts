import type { Page } from "playwright";
import type { ParsedUrl } from "../utils/url.js";
import type { Business } from "../core/schema.js";
import { logger } from "../utils/logger.js";

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
  // Handle browser dialogs
  page.on("dialog", async (dialog) => {
    await dialog.accept();
  });

  // Navigate – use networkidle for short URLs that redirect
  const waitUntil = parsed.isShortUrl ? "networkidle" : "domcontentloaded";
  logger.debug(`Navigating to ${parsed.url}`);
  await page.goto(parsed.url, { waitUntil, timeout: 30000 });

  // Handle Google consent page (redirects to consent.google.com)
  await handleConsent(page);

  // Force English locale if not already set by appending hl=en
  await forceEnglishLocale(page);

  // Wait for the place panel to load
  await page.waitForSelector("h1", { timeout: 15000 });

  // Update placeId from the resolved URL (useful for short URLs)
  const resolvedUrl = page.url();
  const placeIdFromUrl = extractPlaceIdFromResolvedUrl(resolvedUrl);

  // Extract business information from the place panel
  const businessInfo = await extractBusinessInfo(page, {
    ...parsed,
    placeId: parsed.placeId ?? placeIdFromUrl,
    url: resolvedUrl,
  });

  // Click on the "Reviews" tab using role selector (locale-independent)
  await openReviewsTab(page);

  // Set sort order
  if (sortOrder !== "relevant") {
    await setSortOrder(page, sortOrder);
  }

  return businessInfo;
}

async function handleConsent(page: Page): Promise<void> {
  const currentUrl = page.url();
  if (!currentUrl.includes("consent.google.com")) return;

  logger.debug("Handling Google consent page...");

  // Try multiple consent button selectors (varies by locale)
  const consentSelectors = [
    'button:has-text("Accept all")',
    'button:has-text("Zaakceptuj wszystko")', // Polish
    'button:has-text("Alle akzeptieren")', // German
    'button:has-text("Accepter tout")', // French
    'button:has-text("Aceptar todo")', // Spanish
    'form[action*="consent"] button:nth-child(2)', // Fallback: second button is usually "Accept"
    'button[aria-label*="Accept"], button[aria-label*="consent"]',
  ];

  for (const selector of consentSelectors) {
    try {
      const button = page.locator(selector).first();
      if (await button.isVisible({ timeout: 1000 })) {
        await button.click();
        logger.debug("Accepted cookie consent");
        // Wait for redirect back to Maps
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

async function forceEnglishLocale(page: Page): Promise<void> {
  const currentUrl = page.url();

  // If already has hl=en, skip
  if (currentUrl.includes("hl=en")) return;

  // Add or replace hl parameter
  const url = new URL(currentUrl);
  url.searchParams.set("hl", "en");

  logger.debug("Forcing English locale...");
  await page.goto(url.toString(), {
    waitUntil: "domcontentloaded",
    timeout: 15000,
  });
}

function extractPlaceIdFromResolvedUrl(url: string): string | null {
  const placeIdMatch = url.match(/!1s(0x[0-9a-f]+:0x[0-9a-f]+)/);
  if (placeIdMatch) return placeIdMatch[1];

  const ftidMatch = url.match(/ftid=(0x[0-9a-f]+:0x[0-9a-f]+)/);
  if (ftidMatch) return ftidMatch[1];

  return null;
}

async function extractBusinessInfo(
  page: Page,
  parsed: ParsedUrl,
): Promise<Omit<Business, "scrapeDate">> {
  return await page.evaluate(
    ({ placeId, url }) => {
      const name =
        document.querySelector("h1")?.textContent?.trim() ?? "Unknown";

      // Overall rating – look for the star rating display
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
          // Try textContent for aria-hidden spans
          const text = ratingEl.textContent?.trim();
          if (text && /^\d+\.?\d*$/.test(text)) {
            rating = parseFloat(text);
          }
        }
      }

      // Total review count from the reviews tab or rating area
      let totalReviews: number | null = null;
      const tabButtons = document.querySelectorAll('button[role="tab"]');
      for (const tab of tabButtons) {
        const text = tab.textContent ?? "";
        // Match "Reviews" tab which often contains count like "Reviews (1,234)"
        if (text.includes("Reviews") || text.includes("review")) {
          const countMatch = text.match(/([\d,]+)/);
          if (countMatch) {
            totalReviews = parseInt(countMatch[1].replace(/,/g, ""));
          }
        }
      }

      // Fallback: look for review count in the header area
      if (totalReviews === null) {
        const allText = document.body.innerText;
        const countMatch = allText.match(/([\d,]+)\s*reviews?/i);
        if (countMatch) {
          totalReviews = parseInt(countMatch[1].replace(/,/g, ""));
        }
      }

      // Address
      const addressEl = document.querySelector(
        'button[data-item-id="address"] div.fontBodyMedium, [data-item-id="address"]',
      );
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
    { placeId: parsed.placeId, url: parsed.url },
  );
}

async function openReviewsTab(page: Page): Promise<void> {
  // Use role="tab" selector – the reviews tab is always the second tab
  // This works regardless of locale (Polish "Opinie", English "Reviews", etc.)
  const tabs = page.locator('button[role="tab"]');
  const tabCount = await tabs.count();

  if (tabCount >= 2) {
    // Reviews tab is typically the second tab (index 1)
    const reviewsTab = tabs.nth(1);
    const tabText = await reviewsTab.textContent();
    logger.debug(`Clicking tab: "${tabText?.trim()}"`);
    await reviewsTab.click();
  } else {
    // Fallback: try text-based matching
    const reviewsTab = page.locator(
      'button:has-text("Reviews"), button:has-text("Opinie"), button:has-text("review")',
    );
    try {
      await reviewsTab.first().click({ timeout: 5000 });
    } catch {
      logger.warn(
        "Could not find Reviews tab – reviews may already be visible",
      );
    }
  }

  // Wait for review cards to appear
  await page.waitForSelector("div.jftiEf", { timeout: 10000 });
  logger.debug("Reviews panel loaded");
}

async function setSortOrder(page: Page, sortOrder: string): Promise<void> {
  const sortIndex = SORT_OPTIONS[sortOrder];
  if (sortIndex === undefined) {
    logger.warn(`Unknown sort order "${sortOrder}", using default`);
    return;
  }

  try {
    // Click the sort dropdown – look for a button with "Sort" or sort-related aria-label
    // Also try the menu button near reviews that controls sorting
    const sortButton = page.locator(
      'button[aria-label*="Sort"], button[aria-label*="sort"], button[data-value="Sort"], button:has-text("Most relevant"), button:has-text("Newest")',
    );
    await sortButton.first().click({ timeout: 5000 });

    // Wait for dropdown menu
    await page.waitForSelector('div[role="menuitemradio"]', {
      timeout: 3000,
    });

    // Click the desired sort option by index
    const menuItems = page.locator('div[role="menuitemradio"]');
    const count = await menuItems.count();
    if (sortIndex < count) {
      await menuItems.nth(sortIndex).click();
      logger.debug(`Sort order set to: ${sortOrder}`);

      // Wait for reviews to reload
      await page.waitForTimeout(2000);
    }
  } catch {
    logger.warn(`Could not set sort order to "${sortOrder}"`);
  }
}
