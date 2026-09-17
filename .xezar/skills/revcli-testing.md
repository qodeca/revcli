---
name: revcli-testing
description: Add or strengthen tests in revcli — pure-function tests at the boundary, single-file runs, nothing weakened, no fake coverage of Playwright code.
---

# Testing in revcli

The suite is `vitest run` over `tests/*.test.ts` and it is deliberately **pure**: parser, schema, url, csv, json, retry, rate-limiter, consent, unrecoverable, batch-utils, validate, scroller, storage-types, scrape-location, extractor-selectors. No test launches a browser; the Playwright-coupled modules are covered by testing the pure decision inside them, not by driving Google Maps.

The suite's scope is pinned in `vitest.config.ts` (`include: ["tests/**/*.test.ts"]`) — without it the default glob also sweeps the test copies inside Xezar peer-task worktrees under `.local/`, and a run then reports other tasks' work-in-progress as yours. If `npm test` prints a file count far above `ls tests/*.test.ts | wc -l`, that config has regressed; fix it before trusting any result.

## Running

- All: `npm test`. One file: `npx vitest run tests/parser.test.ts`. Watch: `npm run test:watch`.
- Always run the file for the module you touched before the whole suite, and the whole suite before you report done.

## What a good test here looks like

- It tests observable behaviour through the exported function, not through internals: `parseReview()`, `parseReviewCount()`, `detectLanguage()`, `parseRatingText()`, `parseInputFile()`, `slugify()`, `deduplicateFilename()`, `extractPlaceIdFromUrl()`, `placeIdsMatch()`, `canVerifyPlaceIdFormat()`, `appendHlParam()`, `isUnrecoverable()`, `calculateStaleDelay()`, `shouldContinueScrolling()`, `assembleScrapeResult()`. When the logic you need is unreachable because it is buried in `page.evaluate()`, **extract it** as an exported pure helper and test that — that is how this suite grew, and it is the accepted change.
- Pin the invariant, not the implementation: `business.totalReviews === reviews.length` with `headerTotalReviews` holding Google's number; `--max-reviews N` capping `totalReviews` at N; `VOLATILE_STORAGE_TYPES` excluding cookies; a `NAV_VERIFY` error being unrecoverable; the review-card selector remaining scoped (chained locator, not concatenated) as `tests/extractor-selectors.test.ts` does.
- Cover the negative and the boundary: malformed input, encoded `:` in an ftid URL, a suffix count (`1.6K reviews`) returning `null`, rating outside `[0, 5]` returning `null`, formula-injection in CSV, an empty or corrupt resume file.
- Add positive *and* negative controls when you assert a detection, so the test cannot pass by matching nothing.

## Never

- Never weaken an existing assertion, delete a test, or add `.skip`/`.only` to get green; never lower a threshold or a coverage target.
- Never fabricate a passing result: an unavailable browser, absent network or uninstalled Chromium is *unavailable*, not a pass, and is not a reason to write a test that asserts nothing.
- Never add a live scrape to the suite. Tests must run offline, deterministically, in seconds.
- Prove a new regression test is red without the fix: `git stash push -- <source files>`, run it, confirm red, `git stash pop`. Report which case you proved and which cases only pin the current (unchanged) behaviour.

Verification after any test work: `npm run typecheck` and `npm test`; `npm run build` when a source module changed.
