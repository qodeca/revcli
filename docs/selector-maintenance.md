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
| **Review text container** | Content div that carries the `lang` attribute of the currently-displayed text (`en` for the Google translation, the original ISO code once toggled) | `div.MyEned` |
| **Expand button** | Review-text / owner-response "Read more" button (see "Expand button lesson" below before editing) | `button.w8nwRe, button[jsaction*="review.expand"]` |
| **Translated-review toggle** | Button that switches a translated review between the Google translation and its original language (see "Translated-review toggle lesson" below before editing) | `button[jsaction*="review.showReview"]` |
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
| **Account link** (`accountButton`) | Top-right account avatar link, shown when Google accepts the session. Matched by its `href`, which is language-independent; its `aria-label` is localized and holds the user's name and email, so never select by it or log it (see §7) | `a[href^="https://accounts.google.com/SignOutOptions"]` |
| **Sign-in link** (`signInLink`) | Top-right "Sign in" link, shown when signed out **and** for a dead session that still has cookies (see §7) | `a[href^="https://accounts.google.com/ServiceLogin"]` |
| **Sign-in dialog** (`signInDialog`) | Limited view only: clicking Sort opens "Sign-in to get the best of Google Maps" instead of the sort menu | `[role="dialog"][aria-label*="sign-in" i], [role="dialog"][aria-label*="sign in" i]` |
| **Limited-view banner** (`TEXT_MARKERS.limitedViewBanner`) | Text marker, compared against lower-cased rendered text outside review cards: "You're seeing a limited view of Google Maps" | `limited view of google maps` |

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

The `expandButton` selector has gone through three revisions, and its call site through a fourth. Future maintainers editing this selector **must** read this section before reverting to a text-based fallback.

**History:**
1. **Original**: `'button.w8nwRe, button:has-text("More")'` used via `` page.locator(`${reviewCard} ${expandButton}`) `` – the template literal produced a flat CSS selector list where the comma made `button:has-text("More")` unscoped (CSS parses `A B, C` as `(A B), (C)`, not `(A B), (A C)`), so the second alternative matched buttons page-wide.
2. **First fix** rewrote the call site to chain per-card locators (`cards.nth(i).locator(expandButton).first()`) which fixed the scope leak but introduced a per-card 500 ms click timeout bomb: every card without a match burned the full auto-wait before failing, producing 10–20 s delays per scroll iteration.
3. **Second fix** collapsed into a single chained locator `page.locator(reviewCard).locator(expandButton)` – Playwright's chained API distributes scope across comma alternatives, so one locator query + fast `count()` iteration.
4. **Third fix** (this section's motivation) dropped the text fallback entirely. `:has-text("X")` is a **case-insensitive substring match over descendant text content**. Reviewer names containing the letters "more" – `KHALID ALMORET`, Elmore, Moore, Latimore, Seymore, Dunmore, etc. – made author buttons match the fallback. Clicks on those author buttons opened a flood of new Local Guide profile tabs and disrupted the scroll state enough to plateau the scraper at ~790 reviews on places with a matching reviewer. Live DOM audit on a 820-card page found 150 `has-text("More")` matches in cards: 149 legitimate expand buttons, **1 rogue author button**.

5. **Fourth fix** (2026-11, issue #31) changed the call site, not the selector. Google now **removes** the "More" button once it is clicked. The old loop took `count()` once and then clicked `nth(i)`: every removal shifted the remaining buttons down by one, so `nth(i)` skipped every second button and those reviews stayed cut off at ~240 characters. `expandAllReviews()` now uses **mark-and-confirm**:
   - One `page.evaluate` scans every review card that has not been collected yet. Inside each card it uses `card.querySelectorAll(expandButton)` – card-scoped, so the comma list stays scoped – and picks the *pending* buttons: rendered (`getClientRects().length > 0`) and not `aria-expanded="true"`. Each one is stamped with `data-revcli-expand="<token>"` (Node-generated, `[a-z0-9-]` only; old stamps are cleared first).
   - Each token is clicked by attribute, then a `waitForFunction` confirms the button is gone, disconnected, hidden, or `aria-expanded="true"`. The element itself is the identity, so removals cannot shift anything.
   - A second pass re-stamps whatever is still pending (re-rendered cards, late buttons, failed clicks).
   - Collected cards are skipped (issue #33): after each collect the scroller marks them `data-revcli-collected="<review id>"` (`COLLECTED_MARK_ATTR`), and both this scan and `extractReviews()` skip a card while its mark equals its current review id. A card element Google reuses for another review is read again. The scroller therefore passes no `skipIds`; a stuck button costs at most two clicks per scroll iteration until its card is collected.
   - The truncation warning ("Could not expand the full text of N of M collected reviews…") is counted at extraction time: `extractReviews()` flags each card that still has a pending button (`expandPending`, same predicate), and the scroller counts newly collected reviews with that flag. Reviews still cut off are collected anyway with the warning – deferring them risks losing the whole review when the virtualized list drops the card.

   **Owner-response "More" buttons** match the same selector and are handled in the same pass. The confirm step accepts all three plausible reactions – removed, `aria-expanded="true"`, or hidden – and `tests/browser/expand.test.ts` covers each. Verified live on 2026-11-17: Google removes the owner-response button from the DOM on click, the same as the review-text button.

**Current selector**: `button.w8nwRe, button[jsaction*="review.expand"]`

- Primary `button.w8nwRe` matches the stable class used by both review-text and owner-response expand buttons.
- Fallback `button[jsaction*="review.expand"]` keys on Google Maps' semantic action routes (`review.expandReview` and `review.expandOwnerResponse`). Author buttons use `review.reviewerLink`, so there is no substring overlap.

**General principle**: prefer semantic attributes (`jsaction`, `aria-label`, `data-*`, ARIA roles) over text content or obfuscated class names when writing selector fallbacks. Text is user data – reviewer names, review content, owner responses – and any substring match can collide with it.

**Call-site reference**: `expandAllReviews()` in `src/scraper/extractor.ts`. The string-level regression guard is `tests/extractor-selectors.test.ts`; the behavioural guard (a fixture whose "More" buttons remove themselves) is `tests/browser/expand.test.ts`.

### 5b. Translated-review toggle lesson – the original text is NOT pre-rendered

Google automatically translates reviews written in a language other than the UI locale (revcli forces `hl=en`). A translated review renders a toggle button, and the **original-language text is not present in the DOM** – it only appears after clicking the toggle, which swaps the review text span to the original language. Reading the review text span directly therefore returns the *translation*, never the original.

**State table** (verified live, 2026-09-17):

| State | `aria-checked` | `jsaction` route | `div.MyEned[lang]` | `span.wiI7pd` text | Button text |
|-------|----------------|------------------|--------------------|--------------------|-------------|
| Translation shown | `"true"` | `...showReviewInOriginal` | `"en"` | English translation | `See original (Polish)` |
| Original shown | `"false"` | `...showReviewInTranslation` | `"pl"` | Original Polish | `See translation (English)` |
| Restored | `"true"` | `...showReviewInOriginal` | `"en"` | English translation | `See original (Polish)` |

**Why this matters:**
- Detecting a translated review by the presence of the toggle button is the only reliable signal. The human-readable language name is in the button text parenthetical (`See original (Polish)`); the ISO code is in `div.MyEned[lang]` **after** toggling.
- The button text changes between states (`See original (X)` vs `See translation (Y)`), so a `:has-text("See original")` substring match only catches the translation-shown state and can be brittle. The semantic `jsaction` route (`review.showReviewInOriginal` / `review.showReviewInTranslation`) is stable across both states and cannot collide with reviewer content.
- The `aria-checked` attribute is the reliable state signal: `"true"` means the translation is displayed, `"false"` means the original is displayed.

**How the scraper captures the original text:**
1. During bulk extraction, `extractReviews()` records `isTranslated` (toggle button present) and the raw button text as a language hint, parsed Node-side by `extractOriginalLanguageFromButtonText()`.
2. `captureOriginalTexts()` (defined in `src/scraper/extractor.ts`) is called from `scroller.ts` with only not-yet-collected reviews, toggling each to the original, reading the text and `lang`, then restoring the translation. Filtering by collected IDs ensures each review is toggled at most once per scrape.
3. `parseReview()` in `parser.ts` then uses the captured `originalText`/`originalLanguage` directly. The old behavior of mirroring `originalText = text` was removed because it produced meaningless data.

**Call-site reference**: `captureOriginalTexts()`, `readOriginalText()`, and `waitForToggleState()` in `src/scraper/extractor.ts`. The pure helper `extractOriginalLanguageFromButtonText()` and the `viewOriginalButton` selector are regression-guarded in `tests/extractor.test.ts` and `tests/extractor-selectors.test.ts`.

### 6. Tips

- **`data-review-id`** and **`role="img"`** with **`aria-label="N stars"`** are semantic attributes that tend to survive class name changes
- **`data-href`** on author buttons is more stable than class names
- Use `document.querySelectorAll("NEW_SELECTOR")` in the DevTools console to verify matches
- Check that the scroll container has `scrollHeight > clientHeight` – that confirms it's the right scrollable element

### 7. Limited view and session markers (verified 2026-11-17)

**Limited view.** Google shows signed-out EEA users – and profiles whose saved session has expired – a *limited view*:
- The Reviews tab is **still present**, but only about 3–5 review cards load.
- A banner reads "You're seeing a limited view of Google Maps. See more". `hasLimitedView()` matches `TEXT_MARKERS.limitedViewBanner` in rendered text only, skipping review cards (a review may quote the phrase), script/style content and hidden elements. `openReviewsTab()` checks **twice** – after the tabs appear and again after the review cards appear – because the banner can render late, and with sort `relevant` there is no Sort click to catch it.
- Clicking Sort opens a "Sign-in to get the best of Google Maps" dialog instead of the menu. `setSortOrder()` waits for whichever of the menu items or `signInDialog` becomes visible first. A visible menu always wins; it fails with `AUTH_REQUIRED` only when the dialog is shown and no menu item appears (after a 0.5 s grace). With sort `relevant` there is no Sort click, so only the banner can signal the limited view.
- Either signal throws `UnrecoverableError` kind `AUTH_REQUIRED`: headless runs stop with a "run `revcli auth`" message, headed runs ask the user to sign in and navigate again.

**Session markers.** The top-right corner of any Maps page shows either the account link (`href` starting `https://accounts.google.com/SignOutOptions`) or the "Sign in" link (`href` starting `https://accounts.google.com/ServiceLogin`). Both hrefs are the same under `hl=en` and `hl=pl`; the aria-labels are localized ("Google Account: …" / "Konto Google: …") and the account label contains the user's name and email, so revcli matches hrefs only and never logs labels or Playwright error text.
- A **dead session keeps its cookies** (`SID`, `HSID`, …) while Maps shows the "Sign in" link. Cookies alone therefore prove a session exists, not that Google accepts it; `getSessionState()` combines both and reports `expired`.
- Google can render "Sign in" **briefly** before it confirms a valid session. With auth cookies present, a "Sign in" link must still be the only marker after a stability window to count: 3 s for `revcli auth` and `revcli auth status` (`SESSION_SIGN_IN_STABLE_MS`), 1.5 s inside the sign-in poll loop and for the scrape's error-wording check, which asks again on its next tick (`POLL_SIGN_IN_STABLE_MS`). The account link always wins.
- No marker within the wait → `unconfirmed` (cookies trusted by `auth status` and `auth`, with a warning; the sign-in wait keeps polling).

**Search results pages.** A link that does not resolve to one place (for example an old share link) lands on `/maps/search/…`: no `h1`, no place tabs, and the text may be in another language. Detection is by URL path only (`isSearchResultsUrl()`), and only after the `h1` or tab wait has timed out, because CID and some redirect links pass through `/maps/search/` on their way to `/maps/place/`. The result is `UnrecoverableError` kind `NOT_A_PLACE` after about 15 seconds, once.

## Updating selectors

1. Edit `src/scraper/selectors.ts`
2. Update the "Last verified" date comment at the top
3. Run a test scrape:
   ```bash
   npx tsx src/index.ts scrape 'https://maps.app.goo.gl/MTVGWdpd8vVqTouv9' --max-reviews 10 --verbose -o /dev/null
   ```
4. Verify reviews are extracted with correct fields (ratings, text, owner responses)
5. Run `npm test` – existing tests for parser, schema, etc. should still pass
6. Run `npm run test:browser`. The browser tests run the in-page code against a local fixture (`tests/browser/fixtures/maps-page.ts`) that mimics Google's DOM and behaviour. When Google's behaviour changes (not just a class name), update the fixture too, so the tests keep describing what Google actually does

## Stable vs fragile selectors

**Stable** (survive most changes):
- `[data-review-id]` – semantic attribute
- `button[role="tab"]` – ARIA role
- `[role="img"][aria-label*="star"]` – ARIA pattern (both review stars and business rating)
- `button[data-href*="/contrib/"]` – data attribute pattern
- `div[role="menuitemradio"]` – ARIA role for sort options
- `button[data-item-id="address"]` – data attribute for address
- `button[jsaction*="review.expand"]` – Google's internal action route (see "Expand button lesson")
- `button[jsaction*="review.showReview"]` – Google's internal action route for the translated-review toggle (see "Translated-review toggle lesson")
- `h1` – business name (standard HTML tag)
- `a[href^="https://accounts.google.com/SignOutOptions"]` / `a[href^="https://accounts.google.com/ServiceLogin"]` – account / sign-in links, same in every UI language (see §7)

**Fragile** (likely to change):
- All single-class selectors: `.jftiEf`, `.d4r55`, `.kvMYJc`, `.rsqaWe`, `.wiI7pd`, `.CDe7pd`, `.DZSIDd`, `.DU9Pgb`, `.Tya61d`, `.w8nwRe`, `.lXJj5c`
- Compound class selectors: `.m6QErb.DxyBCb.kA9KIf.dS8AEf`
