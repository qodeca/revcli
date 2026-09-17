---
name: revcli-bug-investigation
description: Reproduce a revcli bug, pin it with a failing regression test, fix the root cause — selectors and stale-state suspects first.
---

# Investigating a bug in revcli

Reproduce, then diagnose, then fix the cause — in that order, and never ship a fix without a test that was red before it.

## 1. Reproduce honestly

Turn the report into a command someone can run. Classify the failure into one of the two kinds, because the repair path differs:

- **Offline-reproducible** — URL parsing, sorting/limits, filename dedup, resume state, CSV/JSON output, validation, retry classification, scroll-stall math, selector *shape*. This belongs in a pure test in `tests/`; nearly every revcli bug does. If the bad behaviour comes from a function tangled in Playwright, extract the pure decision (`parseReviewCount`, `calculateStaleDelay`, `assembleScrapeResult` were all born this way) and test that.
- **Only-visible-live** — Google changed the page, consent/limited-view, auth, throttling. Reproduce with `npm run dev -- scrape '<url>' --max-reviews 5 --verbose` (single quotes) and read the debug lines. This needs the owner's session; if you cannot run it, say so and diagnose from the reported output rather than guessing.

Silent-zero-results and `rating: 0` storms are selector staleness, not scraper logic — see `revcli-selector-maintenance`.

## 2. Diagnose from evidence

- Read the actual output and the real code path before theorising. `--verbose` prints the scrubbed header candidates and which selector source produced the parse.
- Suspect in the order history has taught this repo: `src/scraper/selectors.ts` first, then stale/cached page state (`clearVolatileBrowserState()` clears service workers, caches, localStorage and IndexedDB but keeps cookies — a place replayed from cache looks like cross-contamination), then sort/tab detection, then scroll termination math, then output.
- Check whether a guard fired rather than being absent: a `NAV_VERIFY` `UnrecoverableError` means the loaded placeId disagreed with the parsed one; that is a real signal, not noise to suppress.
- `git log -S'<symbol>'` and `git log --oneline -- <path>` say when the behaviour arrived.

## 3. Fix the cause

Write the failing test first, confirm it fails for the reported reason, then make the smallest change that removes the cause:

- A stale selector changes in `selectors.ts`, not in the consumer.
- A parse that can fail returns `null` (business rating, review count) or the documented `0` sentinel (per-review stars) — do not paper over it with a default value that looks like data.
- A page-side string that parses wrong is fixed on the Node side in a pure helper, not inside `page.evaluate()`.
- Never "fix" a symptom by relaxing a Zod schema, widening a type, or catching an error the retry layer is supposed to see.

## 4. Prove it

Run the focused test file, then `npm run typecheck`, `npm test`, `npm run build`. Prove the new test is red without the fix (`git stash push -- <source files>` → run → red → `git stash pop`), and name any part of the report you could not exercise offline.
