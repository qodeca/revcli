---
name: revcli-selector-maintenance
description: revcli's distinctive failure mode — Google Maps obfuscated selectors went stale. Diagnose from --verbose evidence, repair in selectors.ts, keep the guard tests honest.
---

# Selector maintenance for revcli

Google obfuscates class names and rotates them every few weeks or months. When it does, revcli **returns zero reviews with no error**. All selectors live in one file: `src/scraper/selectors.ts`, with a `Last verified:` date comment at the top. `docs/selector-maintenance.md` is the paired field-by-field table and must be updated in the same change.

## Symptoms and first move

- 0 reviews extracted, no exception; or "No reviews extracted but page has content – selectors may be stale".
- A storm of `rating: 0` (the per-review stars selector is stale — the sentinel, not real data).
- `headerTotalReviews` null while reviews scrape fine (the header fallback chain failed).

Diagnose with verbose evidence before editing: `npm run dev -- scrape '<url>' --max-reviews 5 --verbose` (single quotes). The browser is visible by default — if reviews are on screen but the CLI reports none, the selectors are stale. `business-extractor.ts` logs four PII-scrubbed `raw …` candidate lines plus `parsed totalReviews=… from source="…"`; the `source` token names which rung of the fallback chain actually parsed. Scrubbing keeps digits, separators, `K`/`M`/`B` and the letters of "reviews"; everything else becomes `·`.

**A live scrape needs the owner's signed-in browser and network to Google.** Run it only when this task authorizes it; otherwise diagnose from the owner's pasted `--verbose` output and say the live check was not run.

## Repair rules

1. Edit `src/scraper/selectors.ts` only; update its `Last verified:` date. Never scatter a new selector into a scraper module, and never "fix" a stale selector by relaxing a Zod schema or by swallowing the warning.
2. **Prefer semantic anchors over classes**: `[data-review-id]`, `role="img"` with `aria-label="N stars"`, `button[data-href*="/contrib/"]`, `button[role="tab"]`, `div[role="menuitemradio"]`, `button[data-item-id="address"]`, `button[jsaction*="review.expand"]`, `h1`. Classes like `.jftiEf`, `.wiI7pd`, `.w8nwRe` are the fragile ones.
3. **Never fall back to `:has-text("…")` for a UI control.** It is a case-insensitive substring match over descendant text, and reviewer names are text — `KHALID ALMORET` matched `:has-text("More")`, opened Local Guide tabs and plateaued the scraper near 790 reviews. Google's `jsaction` routes (`review.expandReview`, `review.expandOwnerResponse`, `review.reviewerLink`) cannot collide with reviewer data.
4. **Never concatenate selector constants into one selector string.** `` `${reviewCard} ${expandButton}` `` parses as `(A B), (C)`: the comma alternative escapes the card scope page-wide. Chain locators — `page.locator(SELECTORS.reviewCard).locator(SELECTORS.expandButton)` — which distributes the scope over every alternative. `expandAllReviews()` in `src/scraper/extractor.ts` is the reference and `tests/extractor-selectors.test.ts` is the string-level guard.
5. Keep parsing Node-side: `page.evaluate()` returns raw strings; `parseReviewCount()` and `parseRatingText()` do the parsing and return `null` on failure. Do not make a parse succeed by guessing — `null` and the header fallback chain are the design.
6. Update `docs/selector-maintenance.md` in the same change: the field table, the stable/fragile lists, and the reason for any new fallback.

## Verify

`npm run typecheck`, `npm test`, `npm run build`, and keep the guard tests real: `tests/extractor-selectors.test.ts` pins the scoped-selector regression shape. When you add a selector, add the assertion that pins its shape too, and prove it fails against the old broken form (`git stash push -- <source>` → red → pop). Whether reviews actually flow again is only provable by a live signed-in scrape — name that as the remaining check, never claim it from the unit suite.
