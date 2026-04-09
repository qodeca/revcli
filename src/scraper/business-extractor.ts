import type { Page } from "playwright";
import type { ParsedUrl } from "../utils/url.js";
import type { Business } from "../core/schema.js";
import { logger } from "../utils/logger.js";
import { SELECTORS } from "./selectors.js";

export async function extractBusinessInfo(
  page: Page,
  parsed: ParsedUrl,
): Promise<Omit<Business, "scrapeDate">> {
  const addressSelector = SELECTORS.addressButton;
  const tabSelector = SELECTORS.tab;

  const info = await page.evaluate(
    ({ placeId, url, addressSel, tabSel }) => {
      const name =
        document.querySelector("h1")?.textContent?.trim() ?? "Unknown";

      // Rating element can be either span or div with role="img"
      const ratingEl = document.querySelector(
        '[role="img"][aria-label*="star"]',
      );
      let rating: number | null = null;
      if (ratingEl) {
        const ratingMatch = ratingEl
          .getAttribute("aria-label")
          ?.match(/([\d.]+)/);
        if (ratingMatch) {
          rating = parseFloat(ratingMatch[1]);
        }
      }
      // Fallback: look for a plain text span with the rating number
      if (rating === null) {
        const spans = document.querySelectorAll("span");
        for (const s of spans) {
          const text = s.textContent?.trim() ?? "";
          if (/^\d\.\d$/.test(text) && s.getAttribute("aria-hidden") === "true") {
            rating = parseFloat(text);
            break;
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

  if (info.name === "Unknown") {
    logger.warn("Could not extract business name – selector may be stale");
  }

  return info;
}
