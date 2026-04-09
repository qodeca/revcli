# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev -- scrape '<url>' [options] # Run CLI directly (single-quote URLs!)
npm run dev -- auth                     # Authenticate with Google (opens browser)
npm run dev -- auth status              # Check if signed in
npm run build                           # Build to dist/ via tsup (ESM, shebang)
npm test                                # Run all tests (vitest)
npm run test:watch                      # Watch mode
npx vitest run tests/parser.test.ts     # Run a single test file
npm run typecheck                       # Type check without emitting
npx playwright install chromium         # Required once before first scrape
```

## Architecture

```
CLI (src/index.ts)  ─── commander routes to 4 commands:
│                       scrape (single URL), batch (file of URLs),
│                       validate (schema check), auth (Google sign-in)
│
├── src/commands/scrape.ts    ── wraps scrapeLocation + retry + output
├── src/commands/batch.ts     ── reads URL file, rate limiting, resume state, per-location timeout
├── src/commands/validate.ts  ── Zod schema validation of JSON files
└── src/commands/auth.ts      ── login (headed), status (headless), logout (delete profile)

src/scraper/scrape-location.ts  ── shared orchestrator, accepts ParsedUrl (used by both commands)
│
├── browser.ts              ── persistent Chromium context (~/.revcli/chrome-profile/), anti-detection, SIGINT cleanup
├── auth.ts                 ── isSignedIn(), hasLimitedView(), waitForUserAuth() – Google auth detection
├── navigator.ts            ── orchestrates consent → locale → limited-view check → tab → sort
├── consent.ts              ── Google consent handling, hl=en enforcement, g_ep/entry stripping
├── business-extractor.ts   ── business name/rating/totalReviews/address extraction
├── scroller.ts             ── mouse wheel scrolling, deduplication by review ID, stale-scroll detection
├── extractor.ts            ── single page.evaluate() for bulk DOM extraction, staleness warnings
├── parser.ts               ── RawReview → validated Review via Zod, language detection
└── selectors.ts            ── ALL Google Maps CSS selectors in one place (fragile, version-dated)

src/core/
├── schema.ts       ── Zod schemas + SortOrder/OutputFormat union types + SORT_ORDERS/OUTPUT_FORMATS constants
├── retry.ts        ── withRetry() – exponential backoff, isUnrecoverable() detection
└── rate-limiter.ts ── minimum delay between operations

src/output/
├── write.ts        ── writeOutput() – centralized format dispatch
├── json.ts         ── pretty JSON to file or stdout
└── csv.ts          ── CSV with formula injection protection (includes author_url column)

src/utils/
├── url.ts          ── Google Maps URL parsing + validation (parseGoogleMapsInput)
├── logger.ts       ── consola-based logger, setVerbose()
└── progress.ts     ── batch progress display
```

### Key data flow

URL input → `parseGoogleMapsInput()` validates → `scrapeLocation(parsed)` launches persistent browser → `navigateToReviews()` handles consent + locale + limited-view check + opens Reviews tab → `scrollAndCollectReviews()` loops: mouse-wheel scroll → `extractReviews()` bulk DOM read → `parseReview()` validates each through Zod → deduplicate by ID → repeat until max reached or no new reviews → close browser → `writeOutput()` dispatches to JSON/CSV.

### Patterns to know

- **Persistent browser profile**: `launchBrowser()` uses `chromium.launchPersistentContext()` with `~/.revcli/chrome-profile/`. Google auth cookies survive between CLI runs. The `PROFILE_DIR` constant is exported from `browser.ts`.
- **Authentication flow**: Google Maps shows a "limited view" (no Reviews tab) to unauthenticated EEA users. `revcli auth` opens a browser for manual sign-in. The scrape command also detects limited view inline and can prompt for auth in headed mode.
- **Default headed mode**: The browser shows by default so users can observe scraping. Use `--headless` to hide it. This is the opposite of most scrapers – it's intentional because auth requires a visible browser.
- **URL normalization**: `appendHlParam()` in `consent.ts` always forces `hl=en` and strips `g_ep`/`entry` tracking params that trigger Google's limited view. This runs before every navigation.
- **Centralized selectors**: All Google Maps CSS class selectors live in `src/scraper/selectors.ts`. Google obfuscates these names and changes them periodically. When scraping breaks, check selectors first. See [docs/selector-maintenance.md](docs/selector-maintenance.md) for the full update procedure.
- **Mouse wheel scrolling**: Google Maps' virtualized review list only lazy-loads from real scroll events. `page.mouse.wheel()` triggers it; `scrollTop` alone does not.
- **Zod as source of truth**: Types are derived from Zod schemas via `z.infer<>`. The `parseReview()` function validates every review at the boundary before it enters the output.
- **Content-based tab detection**: The Reviews tab is found by searching tab text for "Review" (case-insensitive), not by positional index, because tab order varies by place type (restaurants have "Menu", hotels have "Rooms").
- **Batch resume**: `.revcli-state.json` in the output directory tracks completed URLs (Zod-validated, atomic writes). `--resume` flag skips them on re-run.
- **Type-safe options**: `SortOrder` and `OutputFormat` union types in `schema.ts` provide compile-time safety. Constants `SORT_ORDERS` and `OUTPUT_FORMATS` are the single source of truth.
- **Rating=0 sentinel**: When stars selector is stale, reviews get `rating: 0` instead of being silently discarded. Parser and extractor both warn about this.
- **Batch safety**: Filename deduplication prevents overwrites. Per-location timeout (`--location-timeout`, default 5 min) prevents indefinite hangs. Invalid URLs logged with warnings.
- **Multi-sort collection**: When a sort order is exhausted but `maxReviews` isn't reached, the scroller automatically switches to additional sort orders (highest, lowest) to collect more reviews. Deduplication by `reviewId` prevents duplicates across sorts.
- **Shell quoting**: Google Maps URLs contain `!` characters that zsh/bash interpret as history expansion. Always use single quotes (`'...'`) around URLs in CLI examples and commands.

## Conventions

- ESM-only (`"type": "module"`, `.js` extensions in imports)
- Node 22+ required
- Strict TypeScript, zero `any` types
- Tests use vitest (108 tests across 11 files) – pure-function tests for parser, schema, URL, CSV, JSON, retry, rate-limiter, consent, unrecoverable, batch-utils, validate; Playwright-dependent modules are not unit tested
- `parseInputFile()`, `slugify()`, and `deduplicateFilename()` in batch.ts are exported for testability
- `appendHlParam()` in consent.ts and `isUnrecoverable()` in retry.ts are exported for testability
- `detectLanguage()` in parser.ts is a simple Arabic/Latin heuristic, not full language detection
