# revcli review checklist

Consumed by the `xez-code-review` skill from `.xezar/pipeline/config.json` → `reviewChecklist`, in addition to that skill's built-in checklist. It complements — it does not replace — `AGENTS.md`, which stays the authority. Reviews are read-only: report findings, change nothing, post nothing unless the task said so.

## Contract and types

- [ ] New or changed shapes are Zod schemas in `src/core/schema.ts`, types via `z.infer<>`; no hand-written interface duplicating a schema.
- [ ] `SORT_ORDERS` / `OUTPUT_FORMATS` (and their union types) extended through the constants, not by a loose string literal at a call site.
- [ ] Every review passes through `parseReview()` before it enters output; a rejected review is visible, not silently dropped.

## Boundaries

- [ ] `page.evaluate()` returns raw DOM strings and bounded payloads; parsing, counting and language detection run on the Node side in exported pure helpers.
- [ ] Nothing that decides behaviour lives inline in Playwright-coupled code where a testable helper belongs.
- [ ] Any new `--verbose` log of page content is PII-scrubbed (digits and separators kept, letters of "reviews" kept, everything else `·`); no reviewer name or review text in logs.

## Selectors

- [ ] Selectors changed only in `src/scraper/selectors.ts`, and its `Last verified:` date moved with them.
- [ ] No concatenated selector string (`A B, C` escapes the scope). Chained locators only.
- [ ] No `:has-text("…")` fallback for a control — reviewer names are text and will match. Semantic attributes only.
- [ ] `docs/selector-maintenance.md` updated in the same change.

## Failure semantics and invariants

- [ ] Anything that must not be retried throws `UnrecoverableError` with a `kind`; no magic-substring `Error` where the typed one belongs, no `catch` that hides it from `isUnrecoverable()`.
- [ ] `business.totalReviews === reviews.length` holds after `assembleScrapeResult()`, `headerTotalReviews` preserved, `--max-reviews` caps `totalReviews` at N.
- [ ] Per-review `rating: 0` sentinel vs business-level `null` on parse failure — not mixed up, not "fixed" into a fake 0.
- [ ] Cookies stay out of `VOLATILE_STORAGE_TYPES` (auth depends on them); state eviction still clears service workers, caches, localStorage and IndexedDB.
- [ ] placeId verification still compares the loaded URL against the parsed id where the format allows it, and skips it where it does not.

## Output and safety

- [ ] Both formats handled through `writeOutput()`; CSV keeps formula-injection protection and its columns; `--output` file vs stdout behaviour preserved.
- [ ] No secret, token, `.env` content or profile data in the diff.
- [ ] Playwright persistent-profile path and headed-by-default behaviour unchanged unless the task said so.

## Tests, docs, scope

- [ ] A test covers the change and would fail without it (author proved it red); no `.skip`, `.only`, deleted or relaxed assertions.
- [ ] No live scrape or Google request in the test suite; tests stay offline and deterministic.
- [ ] Docs updated where the change is user- or agent-visible; every documented command exists in `package.json`; example URLs single-quoted.
- [ ] Diff scope matches the task: no incidental `package.json` version bump, no new dependency without a stated need, ESM `.js` import extensions kept, zero `any`.
- [ ] The review names which commands it actually ran (`npm run typecheck`, `npm test`) and on which revision, and states what it could not verify.
