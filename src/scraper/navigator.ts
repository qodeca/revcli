import type { Page } from "playwright";
import type { ParsedUrl } from "../utils/url.js";
import { extractPlaceIdFromUrl } from "../utils/url.js";
import type { Business, SortOrder } from "../core/schema.js";
import { logger } from "../utils/logger.js";
import { SELECTORS } from "./selectors.js";
import { handleConsent, ensureEnglishLocale, appendHlParam } from "./consent.js";
import { extractBusinessInfo } from "./business-extractor.js";
import { hasLimitedView } from "./auth.js";

const SORT_OPTIONS: Record<SortOrder, number> = {
  relevant: 0,
  newest: 1,
  highest: 2,
  lowest: 3,
};

export async function navigateToReviews(
  page: Page,
  parsed: ParsedUrl,
  sortOrder: SortOrder,
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

async function openReviewsTab(page: Page): Promise<void> {
  await page.waitForSelector(SELECTORS.tab, { timeout: 10000 });
  await page.waitForTimeout(1000);

  // Check for limited view before attempting to find Reviews tab
  if (await hasLimitedView(page)) {
    logger.warn("Limited view detected – Reviews tab is hidden");
    return;
  }

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

export async function setSortOrder(page: Page, sortOrder: SortOrder): Promise<void> {
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
