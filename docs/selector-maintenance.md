# Selector maintenance guide

Google Maps uses obfuscated CSS class names (e.g., `div.jftiEf`, `span.kvMYJc`) that change without notice – typically every few weeks to months. When this happens, the scraper silently returns zero reviews.

All selectors live in **`src/scraper/selectors.ts`** – the single file to update.

## Diagnosing stale selectors

**Symptoms:**
- Scraper returns 0 reviews with no errors
- Warning: "No reviews extracted but page has content – selectors may be stale"
- Warning: "N reviews have rating=0 – stars selector may be stale"

**Quick check – run with `--verbose`:**
```bash
npx tsx src/index.ts scrape 'https://maps.app.goo.gl/MTVGWdpd8vVqTouv9' --max-reviews 5 --verbose
```

The browser shows by default. If reviews are visually present but the CLI reports 0, selectors are stale. Use `--headless` only if you don't need to see the browser.

## Finding new selectors

### 1. Open Chrome DevTools on Google Maps

Navigate to any Google Maps place with reviews, click the Reviews tab, then inspect the DOM.

### 2. Identify the review card container

Look for the repeating container element that wraps each review. Previously `div.jftiEf`. The card typically has a `data-review-id` attribute – that's the stable anchor.

### 3. Map each field inside the card

| Field | What to look for | Current selector |
|-------|-----------------|------------------|
| **Review card** | Repeating container with `data-review-id` | `div.jftiEf` |
| **Author name** | Text element with reviewer name | `div.d4r55` |
| **Author link** | Button with `data-href` containing `/contrib/` | `button[data-href*="/contrib/"]` |
| **Stars** | `span[role="img"]` with `aria-label="N stars"` | `span.kvMYJc[role="img"]` |
| **Review time** | Span showing "2 weeks ago" (inside review metadata, NOT inside owner response) | `span.rsqaWe` inside `div.DU9Pgb` |
| **Review text** | Text span inside a content div | `span.wiI7pd` inside `div.MyEned` |
| **Expand button** | Review-text / owner-response "Read more" button (see "Expand button lesson" below before editing) | `button.w8nwRe, button[jsaction*="review.expand"]` |
| **Owner response** | Container below review text | `div.CDe7pd` |
| **Response text** | `div.wiI7pd` (note: div, not span – different from review text) | `div.wiI7pd` inside `div.CDe7pd` |
| **Response time** | Span with relative time inside response | `span.DZSIDd` |
| **Photos** | Photo thumbnail buttons | `button.Tya61d` |
| **Sort button** | Button to open sort menu (text always shows "Sort", not the selected option) | `button[aria-label*="Sort" i], button[data-value="Sort"]` |
| **Sort option** | Menu item in sort dropdown | `div[role="menuitemradio"]` |
| **Address** | Business address element | `button[data-item-id="address"] div.fontBodyMedium` |
| **Scroll container** | Scrollable parent of review cards (4 fallbacks tried in order) | `div.m6QErb.DxyBCb.kA9KIf.dS8AEf` |
| **Loading indicator** | Material Design spinner at bottom of scroll container during lazy-load (CSS animation state toggles paused/running) | `div.lXJj5c` |
| **Sort live region** | ARIA live region announcing sort changes (e.g., "sorted from newest to oldest") | `div[aria-live="polite"][aria-atomic="true"]` |

### 4. Business header selectors

The business header (name, rating, review count, address) is read by `src/scraper/business-extractor.ts`. After the fix/5 refactor, `page.evaluate()` returns only raw DOM strings and all parsing runs on the Node side via the pure helpers `parseReviewCount()` in `src/scraper/parser.ts` and `parseRatingText()` in `business-extractor.ts`. When a scrape logs `parsed totalReviews=N from source="..."` at `--verbose` level, the `source` token names which selector below actually caught the parse.

**Selectors centralized in `src/scraper/selectors.ts`:**

| Field | Selector | Notes |
|-------|----------|-------|
| **Reviews tab** | `SELECTORS.tab` | First tab button whose text contains "review". Used both to click-into the Reviews panel and as the primary review-count source |
| **Review count badge** | `SELECTORS.reviewBadge` → `[aria-label*="review" i]` | Added in fix/5. Scoped to the `mainRegion` below. Catches the count on narrow viewports and place types where the Reviews tab text is only "Reviews" with no inline number |
| **Main content region** | `SELECTORS.mainRegion` → `[role="main"]` | Added in fix/5. Scopes the body-text fallback so the parser cannot grab count hints from reviewer profile sidebars, suggestions, or adjacent place blocks |
| **Address** | `SELECTORS.addressButton` → `button[data-item-id="address"] div.fontBodyMedium, [data-item-id="address"]` | Stable data attribute |

**Selectors hardcoded inside `business-extractor.ts`:**

| Field | Selector | Notes |
|-------|----------|-------|
| **Business name** | `h1` | First heading on the page. Stable HTML tag |
| **Business rating** | `[role="img"][aria-label*="star"]` with fallback to a `span[aria-hidden="true"]` whose text matches `/^\d\.\d$/` | Tag-agnostic ARIA pattern. Raw `aria-label` string is returned to the Node side and parsed by `parseRatingText()`, which rejects values outside `[0, 5]` and returns `null` (not 0) on parse failure |

**Review-count fallback chain (three rungs, tried in order):**

1. **`reviewTabText`** – text content of the first tab button matching `/review/i`
2. **`reviewBadgeText`** – `aria-label` of `SELECTORS.reviewBadge` inside `SELECTORS.mainRegion`
3. **`reviewBodySnippet`** – `textContent` of `SELECTORS.mainRegion`, capped at 10,000 chars before crossing the browser/Node boundary

`parseReviewCount()` runs against each candidate until one returns a non-null integer. If all three rungs return null, `business-extractor.ts` logs a `warn`-level `Could not extract review count from header` and the `headerTotalReviews` field in the output JSON becomes `null`. The end-of-scrape reconciliation in `assembleScrapeResult()` still sets `business.totalReviews = reviews.length`, so user-visible consistency holds even when the header parser bails.

**Debug diagnosis when the header parse is wrong:**

Run with `--verbose` and grep the log for the four `raw ...` lines and the `parsed totalReviews=...` line. The raw lines are PII-scrubbed: digits, separators, K/M/B suffixes, and the letters of "reviews" are preserved; everything else is replaced with `·`. That keeps reviewer names and review text out of shareable debug output while leaving enough signal to see what the parser saw.

### 5. Expand button lesson – do not use `:has-text("More")`

The `expandButton` selector has gone through three revisions. Future maintainers editing this selector **must** read this section before reverting to a text-based fallback.

**History:**
1. **Original**: `'button.w8nwRe, button:has-text("More")'` used via `` page.locator(`${reviewCard} ${expandButton}`) `` – the template literal produced a flat CSS selector list where the comma made `button:has-text("More")` unscoped (CSS parses `A B, C` as `(A B), (C)`, not `(A B), (A C)`), so the second alternative matched buttons page-wide.
2. **First fix** rewrote the call site to chain per-card locators (`cards.nth(i).locator(expandButton).first()`) which fixed the scope leak but introduced a per-card 500 ms click timeout bomb: every card without a match burned the full auto-wait before failing, producing 10–20 s delays per scroll iteration.
3. **Second fix** collapsed into a single chained locator `page.locator(reviewCard).locator(expandButton)` – Playwright's chained API distributes scope across comma alternatives, so one locator query + fast `count()` iteration.
4. **Third fix** (this section's motivation) dropped the text fallback entirely. `:has-text("X")` is a **case-insensitive substring match over descendant text content**. Reviewer names containing the letters "more" – `KHALID ALMORET`, Elmore, Moore, Latimore, Seymore, Dunmore, etc. – made author buttons match the fallback. Clicks on those author buttons opened a flood of new Local Guide profile tabs and disrupted the scroll state enough to plateau the scraper at ~790 reviews on places with a matching reviewer. Live DOM audit on a 820-card page found 150 `has-text("More")` matches in cards: 149 legitimate expand buttons, **1 rogue author button**.

**Current selector**: `button.w8nwRe, button[jsaction*="review.expand"]`

- Primary `button.w8nwRe` matches the stable class used by both review-text and owner-response expand buttons.
- Fallback `button[jsaction*="review.expand"]` keys on Google Maps' semantic action routes (`review.expandReview` and `review.expandOwnerResponse`). Author buttons use `review.reviewerLink`, so there is no substring overlap.

**General principle**: prefer semantic attributes (`jsaction`, `aria-label`, `data-*`, ARIA roles) over text content or obfuscated class names when writing selector fallbacks. Text is user data – reviewer names, review content, owner responses – and any substring match can collide with it.

**Call-site reference**: `expandAllReviews()` in `src/scraper/extractor.ts`. The string-level regression guard is `tests/extractor-selectors.test.ts`.

### 6. Tips

- **`data-review-id`** and **`role="img"`** with **`aria-label="N stars"`** are semantic attributes that tend to survive class name changes
- **`data-href`** on author buttons is more stable than class names
- Use `document.querySelectorAll("NEW_SELECTOR")` in the DevTools console to verify matches
- Check that the scroll container has `scrollHeight > clientHeight` – that confirms it's the right scrollable element

## Updating selectors

1. Edit `src/scraper/selectors.ts`
2. Update the "Last verified" date comment at the top
3. Run a test scrape:
   ```bash
   npx tsx src/index.ts scrape 'https://maps.app.goo.gl/MTVGWdpd8vVqTouv9' --max-reviews 10 --verbose -o /dev/null
   ```
4. Verify reviews are extracted with correct fields (ratings, text, owner responses)
5. Run `npm test` – existing tests for parser, schema, etc. should still pass

## Stable vs fragile selectors

**Stable** (survive most changes):
- `[data-review-id]` – semantic attribute
- `button[role="tab"]` – ARIA role
- `[role="img"][aria-label*="star"]` – ARIA pattern (both review stars and business rating)
- `button[data-href*="/contrib/"]` – data attribute pattern
- `div[role="menuitemradio"]` – ARIA role for sort options
- `button[data-item-id="address"]` – data attribute for address
- `button[jsaction*="review.expand"]` – Google's internal action route (see "Expand button lesson")
- `h1` – business name (standard HTML tag)

**Fragile** (likely to change):
- All single-class selectors: `.jftiEf`, `.d4r55`, `.kvMYJc`, `.rsqaWe`, `.wiI7pd`, `.CDe7pd`, `.DZSIDd`, `.DU9Pgb`, `.Tya61d`, `.w8nwRe`, `.lXJj5c`
- Compound class selectors: `.m6QErb.DxyBCb.kA9KIf.dS8AEf`
