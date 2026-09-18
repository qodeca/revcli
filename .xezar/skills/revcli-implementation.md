---
name: revcli-implementation
description: Implement a feature or change in revcli end to end — schema first, pure helper out of the Playwright-coupled code, tests, docs — then verify.
---

# Implementing in revcli

Read `AGENTS.md` first: it names the four commands, the module map and the patterns that already exist. Prefer the shape the repository already uses over a new one.

## Working order

1. **Contract first.** Types come from Zod in `src/core/schema.ts` — add or extend the schema and derive the type with `z.infer<>`; never hand-write an interface that duplicates it. New enumerations go through the `SORT_ORDERS` / `OUTPUT_FORMATS` constants, which are the single source of truth.
2. **Pull the logic out of Playwright.** Anything that decides something from a string is a pure function on the Node side, exported for testability, with `page.evaluate()` returning raw DOM strings only. `parseReviewCount()`, `parseRatingText()`, `parseReview()`, `extractPlaceIdFromUrl()`, `calculateStaleDelay()`, `parseInputFile()`, `assembleScrapeResult()` are the existing pattern — follow one of them rather than inventing a fifth shape.
3. **Selectors only in `src/scraper/selectors.ts`**, dated with a comment when you add one. Scope with chained locators (`page.locator(A).locator(B)`), never string-concatenated selector lists — a comma in a concatenated selector escapes the parent scope. Prefer semantic `jsaction` routes over `:has-text()`, which substring-matches reviewer data.
4. **Verify at the seam.** Anything that must hold across scraped data is asserted once where the data meets — `assembleScrapeResult()` is the reference: it enforces `business.totalReviews === reviews.length` and keeps Google's header number in `business.headerTotalReviews`.
5. **Errors are typed.** Throw `UnrecoverableError` with a `kind` discriminator for anything `withRetry` must not retry; plain `Error` for everything that may be retried.
6. **Output goes through `writeOutput()`**, so every format (JSON, CSV) gets the change — CSV keeps its formula-injection protection.
7. **Tests and docs land in the same change**: a pure-function test in `tests/<module>.test.ts`; a user-visible flag or output change is documented in `README.md` and, when it changes an invariant, in `AGENTS.md`. Single-quote example URLs — `!` is shell history expansion.

## Constraints

- ESM only: `"type": "module"`, and relative imports carry the `.js` extension. Node 22+. Strict TypeScript, zero `any`.
- Version is read from `package.json` at runtime; bump `package.json` only when the task asks for a release, never incidentally.
- A scrape step, batch run or auth flow is not run as part of implementing — it is verified by the pure tests plus the owner's live run. Do not start Chromium.
- Keep every `page.evaluate()` payload small and PII-safe; debug logs of page content are scrubbed, as in `business-extractor.ts`.

## Done means

`npm run typecheck`, `npm test` and `npm run build` all pass on the committed revision, with the new behaviour covered by a test that was red before the change. Report what you could not verify (typically the live scrape) instead of assuming it.
