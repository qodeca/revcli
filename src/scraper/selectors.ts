/**
 * Centralized CSS selectors for Google Maps DOM elements.
 * Google uses obfuscated class names that change periodically.
 * Update this file when selectors go stale.
 *
 * Last verified: 2026-04-08
 */

export const SELECTORS = {
  // Review cards
  reviewCard: "div.jftiEf",
  reviewId: "[data-review-id]",

  // Author
  authorName: "div.d4r55",
  authorButton: 'button[data-href*="/contrib/"]',

  // Rating stars
  stars: 'span.kvMYJc[role="img"]',

  // Review content
  reviewTimeContainer: "div.DU9Pgb",
  reviewTime: "span.rsqaWe",
  reviewText: "div.MyEned span.wiI7pd",
  expandButton: 'button.w8nwRe, button:has-text("More")',

  // Owner response
  ownerResponseContainer: "div.CDe7pd",
  ownerResponseText: "div.wiI7pd",
  ownerResponseTime: "span.DZSIDd",

  // Photos
  photoButton: "button.Tya61d",

  // Scroll container candidates (in priority order)
  scrollContainers: [
    "div.m6QErb.DxyBCb.kA9KIf.dS8AEf",
    'div.m6QErb[aria-label]',
    'div[role="feed"]',
    "div.section-scrollbox",
  ],

  // Navigation
  tab: 'button[role="tab"]',
  sortMenuItem: 'div[role="menuitemradio"]',
  sortButton:
    'button[aria-label*="Sort" i], button[data-value="Sort"], button:has-text("Most relevant"), button:has-text("Newest")',
  addressButton:
    'button[data-item-id="address"] div.fontBodyMedium, [data-item-id="address"]',
} as const;
