# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev -- scrape <url> [options]   # Run CLI directly during development
npm run build                           # Build to dist/ via tsup (ESM, shebang)
npm test                                # Run all tests (vitest)
npm run test:watch                      # Watch mode
npx vitest run tests/parser.test.ts     # Run a single test file
npm run typecheck                       # Type check without emitting
npx playwright install chromium         # Required once before first scrape
```

## Architecture

```
CLI (src/index.ts)  ─── commander routes to 3 commands:
│                       scrape (single URL), batch (file of URLs), validate (schema check)
│
├── src/commands/scrape.ts    ── wraps scrapeLocation + retry + output
├── src/commands/batch.ts     ── reads URL file, iterates with rate limiting + resume state
└── src/commands/validate.ts  ── Zod schema validation of JSON files

src/scraper/scrape-location.ts  ── shared orchestrator (used by both scrape + batch)
│
├── browser.ts      ── Chromium launch with anti-detection, SIGINT cleanup
├── navigator.ts    ── consent handling, hl=en locale, business info extraction, tab + sort
├── scroller.ts     ── mouse wheel scrolling, deduplication by review ID, stale-scroll detection
├── extractor.ts    ── single page.evaluate() for bulk DOM extraction, staleness warnings
├── parser.ts       ── RawReview → validated Review via Zod, language detection
└── selectors.ts    ── ALL Google Maps CSS selectors in one place (fragile, version-dated)

src/core/
├── schema.ts       ── Zod schemas (ScrapeResult, Review, Business, Metadata) + types
├── retry.ts        ── withRetry() – exponential backoff, unrecoverable error detection
└── rate-limiter.ts ── minimum delay between operations

src/output/
├── json.ts         ── pretty JSON to file or stdout
└── csv.ts          ── CSV with formula injection protection
```

### Key data flow

URL input → `parseGoogleMapsInput()` validates → `scrapeLocation()` launches browser → `navigateToReviews()` handles consent + locale + opens Reviews tab → `scrollAndCollectReviews()` loops: mouse-wheel scroll → `extractReviews()` bulk DOM read → `parseReview()` validates each through Zod → deduplicate by ID → repeat until max reached or no new reviews → close browser → write JSON/CSV.

### Patterns to know

- **Centralized selectors**: All Google Maps CSS class selectors live in `src/scraper/selectors.ts`. Google obfuscates these names and changes them periodically. When scraping breaks, check selectors first. See [docs/selector-maintenance.md](docs/selector-maintenance.md) for the full update procedure.
- **Mouse wheel scrolling**: Google Maps' virtualized review list only lazy-loads from real scroll events. `page.mouse.wheel()` triggers it; `scrollTop` alone does not.
- **Zod as source of truth**: Types are derived from Zod schemas via `z.infer<>`. The `parseReview()` function validates every review at the boundary before it enters the output.
- **Content-based tab detection**: The Reviews tab is found by searching tab text for "Review" (case-insensitive), not by positional index, because tab order varies by place type (restaurants have "Menu", hotels have "Rooms").
- **Batch resume**: `.revcli-state.json` in the output directory tracks completed URLs. `--resume` flag skips them on re-run.

## Conventions

- ESM-only (`"type": "module"`, `.js` extensions in imports)
- Node 22+ required
- Strict TypeScript, zero `any` types
- Tests use vitest – pure-function tests for parser, schema, URL, CSV, retry, rate-limiter; Playwright-dependent modules are not unit tested
- `parseInputFile()` and `slugify()` in batch.ts are exported for testability
- `detectLanguage()` in parser.ts is a simple Arabic/Latin heuristic, not full language detection
