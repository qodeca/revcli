# Selector maintenance guide

Google Maps uses obfuscated CSS class names (e.g., `div.jftiEf`, `span.kvMYJc`) that change without notice – typically every few weeks to months. When this happens, the scraper silently returns zero reviews.

All selectors live in **`src/scraper/selectors.ts`** – the single file to update.

## Diagnosing stale selectors

**Symptoms:**
- Scraper returns 0 reviews with no errors
- Warning: "No reviews extracted but page has content – selectors may be stale"
- Warning: "N reviews have rating=0 – stars selector may be stale"

**Quick check – run with `--headed --verbose`:**
```bash
npx tsx src/index.ts scrape "https://maps.app.goo.gl/MTVGWdpd8vVqTouv9" --max-reviews 5 --headed --verbose
```

Watch the browser: if reviews are visually present but the CLI reports 0, selectors are stale.

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
| **Expand button** | Button with "More" text | `button.w8nwRe` |
| **Owner response** | Container below review text | `div.CDe7pd` |
| **Response text** | `div.wiI7pd` (note: div, not span – different from review text) | `div.wiI7pd` inside `div.CDe7pd` |
| **Response time** | Span with relative time inside response | `span.DZSIDd` |
| **Photos** | Photo thumbnail buttons | `button.Tya61d` |
| **Scroll container** | Scrollable parent of review cards | `div.m6QErb.DxyBCb.kA9KIf.dS8AEf` |

### 4. Tips

- **`data-review-id`** and **`role="img"`** with **`aria-label="N stars"`** are semantic attributes that tend to survive class name changes
- **`data-href`** on author buttons is more stable than class names
- Use `document.querySelectorAll("NEW_SELECTOR")` in the DevTools console to verify matches
- Check that the scroll container has `scrollHeight > clientHeight` – that confirms it's the right scrollable element

## Updating selectors

1. Edit `src/scraper/selectors.ts`
2. Update the "Last verified" date comment at the top
3. Run a test scrape:
   ```bash
   npx tsx src/index.ts scrape "https://maps.app.goo.gl/MTVGWdpd8vVqTouv9" --max-reviews 10 --verbose -o /dev/null
   ```
4. Verify reviews are extracted with correct fields (ratings, text, owner responses)
5. Run `npm test` – existing tests for parser, schema, etc. should still pass

## Stable vs fragile selectors

**Stable** (survive most changes):
- `[data-review-id]` – semantic attribute
- `button[role="tab"]` – ARIA role
- `span[role="img"]` with `aria-label` – ARIA pattern
- `button[data-href*="/contrib/"]` – data attribute pattern
- `div[role="menuitemradio"]` – ARIA role for sort options

**Fragile** (likely to change):
- All single-class selectors: `.jftiEf`, `.d4r55`, `.kvMYJc`, `.rsqaWe`, `.wiI7pd`, `.CDe7pd`, `.DZSIDd`, `.DU9Pgb`, `.Tya61d`, `.w8nwRe`
- Compound class selectors: `.m6QErb.DxyBCb.kA9KIf.dS8AEf`
