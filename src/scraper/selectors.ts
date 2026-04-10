/**
 * Centralized CSS selectors for Google Maps DOM elements.
 * Google uses obfuscated class names that change periodically.
 * Update this file when selectors go stale.
 *
 * Last verified: 2026-04-10
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
  // Fallback uses `jsaction` not `:has-text("More")` – the latter
  // substring-matches reviewer names like "KHALID ALMORET" (AL·MORE·T)
  // and opens their Local Guide profile on click.
  expandButton: 'button.w8nwRe, button[jsaction*="review.expand"]',

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
  sortButton: 'button[aria-label*="Sort" i], button[data-value="Sort"]',
  // ARIA live region where Google Maps announces sort changes
  // e.g., "The reviews are now sorted from newest to oldest."
  sortLiveRegion: 'div[aria-live="polite"][aria-atomic="true"]',
  addressButton:
    'button[data-item-id="address"] div.fontBodyMedium, [data-item-id="address"]',

  // Review count badge – aria-label containing "review" case-insensitively.
  // Google Maps renders the total review count in an aria-label on narrow
  // viewports and some place types (e.g. hotels) where the Reviews tab text
  // only shows "Reviews" without a count.
  reviewBadge: '[aria-label*="review" i]',

  // Main content region of Google Maps. Used to scope body-text fallbacks so
  // the parser doesn't grab review-count digits from reviewer profile sidebar
  // text or unrelated header chrome.
  mainRegion: '[role="main"]',

  // Loading indicator shown during lazy-loading of reviews
  // Multiple selectors as fallbacks since Google changes these frequently
  // Material Design spinner at bottom of scroll container during lazy-loading
  // CSS animation state toggles between paused/running
  loadingIndicator: "div.lXJj5c",
} as const;
