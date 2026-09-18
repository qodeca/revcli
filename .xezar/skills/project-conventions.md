---
name: project-conventions
description: What good work looks like in this project — its goal, deliverables, constraints and how results are checked.
---

# Project conventions

revcli is an open-source MIT-licensed CLI (`revcli`) that scrapes Google Maps location reviews with Playwright and writes them as JSON or CSV. A workflow step uses this skill with `skill: project-conventions`. `AGENTS.md` at the repository root is the authoritative contract: commands, module map, patterns, conventions. Read it first.

## What the work is for
- Developers and analysts who need a place's reviews as data they own: four commands — `scrape` (one URL), `batch` (a file of URLs), `validate` (schema check of a JSON file), `auth` (Google sign-in, needed for the EEA limited view).
- The output has to be trustworthy: validated through Zod at the boundary, deduplicated by review id, consistent (`business.totalReviews === reviews.length`), safe to open in a spreadsheet (CSV formula-injection protection), and free of anything we have no right to collect — reviewer names and review text never enter logs.
- Secondary user: whoever maintains the scraper, because Google rotates the obfuscated class names it uses. `src/scraper/selectors.ts` and `docs/selector-maintenance.md` exist for that day.

## What a finished result looks like
- Working TypeScript in the module `AGENTS.md` names — CLI routing in `src/index.ts`, per-command wrappers in `src/commands/`, orchestration in `src/scraper/`, contracts in `src/core/schema.ts`, output in `src/output/`, helpers in `src/utils/`.
- A pure, exported, unit-tested helper wherever a decision is made from a string (`parseReviewCount()`, `parseRatingText()`, `parseReview()`, `extractPlaceIdFromUrl()`, `calculateStaleDelay()`, `assembleScrapeResult()` are the existing shape), instead of logic buried inside `page.evaluate()`.
- A test in `tests/<module>.test.ts` that was red before the change; documentation updated in the same change when a flag, an output field or an invariant moved (`README.md` for users, `AGENTS.md` for agents, `docs/selector-maintenance.md` for selectors, `docs/specs/` for specs).
- Nothing extra: no drive-by dependency or version bump, no reformatting of untouched files, no commit, push, publish or message sent unless the task authorized it.

## Constraints
- ESM only (`"type": "module"`, `.js` extensions on relative imports), Node 22+, strict TypeScript, zero `any`. Types are derived from Zod with `z.infer<>`; constants `SORT_ORDERS` / `OUTPUT_FORMATS` / `VOLATILE_STORAGE_TYPES` are single sources of truth.
- This repo is driven only by open-source agent clients (OpenCode, pi, Qwen) with local models. Do not switch agent, and do not introduce Claude Code or Codex configuration.
- All Google Maps selectors live in `src/scraper/selectors.ts` (version-dated). Scope with chained locators, never concatenated selector strings. Prefer semantic attributes (`jsaction`, `aria-*`, `data-*`, ARIA roles) over obfuscated classes and never over visible text.
- Failure taxonomy matters: an `UnrecoverableError` with a `kind` is never retried by `withRetry()`; per-review `rating: 0` is a sentinel for a stale stars selector, while a business-level rating that cannot be parsed is `null`, not 0.
- The browser is headed by default (auth needs a visible window) and the persistent profile in `~/.revcli/chrome-profile/` holds the owner's Google session — never sign in on their behalf, never copy or expose that profile, and treat a live scrape as authorized only when the task says so.
- Single-quote example URLs in docs and commands: `!` is shell history expansion.

## How results are checked
- `npm run typecheck`, then `npm test` (the vitest pure-function suite, offline), then `npm run build`. All three are browser-free; a green suite is required, never sufficient, for anything only a live scrape can prove.
- Live scraping is the owner's verification: it needs `npx playwright install chromium`, network to Google and usually `revcli auth`. When you cannot run it, say "not verifiable here" — never pass.
- Do not weaken a check to get green (no `.skip`/`.only`, no relaxed assertion or schema, no swallowed error), and prove a regression test is red without the fix. `revcli-quality-gates` carries the full rule set.

## Examples
- "Reviews from this place stop at ~790 and the log shows rogue tab opens — reproduce with a failing test on the expand-button selector shape, fix the selector scoping, keep `tests/extractor-selectors.test.ts` honest."
- "Add a `--sort` option that survives URL parsing through to the scraper, extend the Zod schema first, cover it in `tests/schema.test.ts` and `tests/url.test.ts`, and document the flag in `README.md`."
- "`business.totalReviews` disagrees with the number of reviews collected for a capped run — pin the reconciliation invariant in a test, then fix `assembleScrapeResult()`."

None of these examples authorizes publishing, sending or submitting anything.
