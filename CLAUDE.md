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

src/scraper/scrape-location.ts  ── shared orchestrator, accepts ParsedUrl (used by both commands); delegates final payload construction to exported pure helper `assembleScrapeResult()` which reconciles `business.totalReviews` with `reviews.length`
│
├── browser.ts              ── persistent Chromium context (~/.revcli/chrome-profile/), anti-detection, SIGINT cleanup
├── auth.ts                 ── isSignedIn(), hasLimitedView(), waitForUserAuth() – Google auth detection
├── navigator.ts            ── orchestrates state eviction → consent → locale → limited-view check → tab → sort; verifies loaded placeId against parsed.placeId
├── consent.ts              ── Google consent handling, hl=en enforcement, g_ep/entry stripping
├── business-extractor.ts   ── business name/rating/totalReviews/address extraction; page.evaluate() returns raw DOM strings only, parsing happens Node-side via parseReviewCount + parseRatingText; PII-scrubbed debug logging of candidate strings
├── scroller.ts             ── mouse wheel scrolling, deduplication by review ID, exponential backoff stale-scroll detection, loading spinner awareness
├── extractor.ts            ── single page.evaluate() for bulk DOM extraction, staleness warnings
├── parser.ts               ── RawReview → validated Review via Zod, language detection
├── selectors.ts            ── ALL Google Maps CSS selectors in one place (fragile, version-dated)
└── storage-types.ts        ── pure VOLATILE_STORAGE_TYPES constant (CDP storage tokens cleared before each scrape; cookies excluded)

src/core/
├── schema.ts       ── Zod schemas + SortOrder/OutputFormat union types + SORT_ORDERS/OUTPUT_FORMATS constants
├── retry.ts        ── withRetry() – exponential backoff, isUnrecoverable() detection (instanceof UnrecoverableError + substring fallback)
├── errors.ts       ── UnrecoverableError typed class with `kind` discriminator – prefer over magic-substring Error for anything we throw
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
- **Rating=0 sentinel (per-review only)**: When the stars selector is stale, individual reviews get `rating: 0` instead of being silently discarded; parser and extractor both warn. This applies to review-level ratings only. The business-level `business.rating` returned by `parseRatingText()` in business-extractor.ts uses `null` on parse failure – zero is treated as a valid user rating, not a sentinel.
- **Batch safety**: Filename deduplication prevents overwrites. Per-location timeout (`--location-timeout`, default 5 min) prevents indefinite hangs. Invalid URLs logged with warnings.
- **Sort order verification**: After selecting a sort order via the dropdown, `setSortOrder()` verifies the ARIA live region (`div[aria-live="polite"][aria-atomic="true"]`) contains the expected keyword (e.g., "newest"). Google Maps announces sort changes via this accessibility element. If verification fails, the scraper exits with an unrecoverable error. The `hl=en` locale enforcement guarantees English announcement text.
- **Volatile state eviction between scrapes**: Before every navigation, `clearVolatileBrowserState()` in `browser.ts` uses CDP `Storage.clearDataForOrigin` to clear `service_workers,cache_storage,local_storage,indexeddb` for `https://www.google.com`. Cookies are intentionally preserved so Google auth stays intact. This prevents Google Maps' SPA shell from replaying a previously-loaded place via cached state during sequential scrapes.
- **Navigation target verification**: After navigating, `navigateToReviews()` compares the loaded page's placeId (extracted from `page.url()`) against `parsed.placeId` using `placeIdsMatch()`. On mismatch, it throws an `UnrecoverableError` with kind `"NAV_VERIFY"` – `isUnrecoverable()` detects this structurally via `instanceof`, so `withRetry` will not mask a cross-contamination bug. Verification only runs when `canVerifyPlaceIdFormat(parsed.placeId)` is true (i.e., the `0x...:0x...` format). Short URLs, CID URLs, and ChIJ Place ID strings skip verification because their format does not align with `extractPlaceIdFromUrl()` output; the resolved placeId is logged at debug level for post-hoc audit.
- **Typed unrecoverable errors**: `src/core/errors.ts` exports `UnrecoverableError` with a `kind` discriminator. Prefer this over plain `Error` with magic-substring messages. `isUnrecoverable()` in `retry.ts` detects `UnrecoverableError` via `instanceof` first, then falls back to substring matching for errors thrown by Playwright or third-party libraries we cannot modify.
- **Supported URL formats**: Long URLs (`/maps/place/...`), short URLs (`maps.app.goo.gl/...`), CID URLs (`maps?cid=...`), ftid URLs (`maps?ftid=0x...:0x...`), and Place ID strings (`ChIJ...`). The ftid and CID regexes accept an optional trailing slash (`/maps/?`). Hex digits in ftid/placeId are case-insensitive.
- **Percent-encoding resilience**: `extractPlaceIdFromUrl()` applies `decodeURIComponent()` before regex matching because `appendHlParam()` routes through `URLSearchParams` which encodes `:` to `%3A` in query values. Without decoding, the `FTID_IN_URL` regex fails to match the encoded colon.
- **Shell quoting**: Google Maps URLs contain `!` characters that zsh/bash interpret as history expansion. Always use single quotes (`'...'`) around URLs in CLI examples and commands.
- **totalReviews reconciliation**: `assembleScrapeResult()` in `src/scraper/scrape-location.ts` is an exported pure helper called from `scrapeLocation()` to enforce the invariant `business.totalReviews === reviews.length` at the single seam where `businessInfo` (header-derived) and `reviews` (scraped) first coexist. The original Google-header value is preserved as `business.headerTotalReviews`. See issue #5. When `--max-reviews N` caps collection, `totalReviews === N` (not the header) and `headerTotalReviews` holds Google's larger number.
- **Header parsing extracted for testability**: `src/scraper/parser.ts` exports `parseReviewCount(text)` and `src/scraper/business-extractor.ts` exports `parseRatingText(text)`. Both are pure functions called from the Node side after `page.evaluate()` returns raw DOM strings. This matches the repo's "extract pure logic out of Playwright-coupled code" convention (see `parseInputFile`, `extractPlaceIdFromUrl`, `calculateStaleDelay`). `parseReviewCount` assumes the `hl=en` locale – comma thousand separator, period is a decimal and not a thousands separator. Suffix forms (`1.6K reviews`) return null; reconciliation backfills via `reviews.length`.
- **Business header debug logging**: `business-extractor.ts` emits PII-scrubbed debug-level logs of raw DOM candidate strings (tab text, aria-label badge, scoped `[role="main"]` body snippet) so selector staleness can be diagnosed from `--verbose` output without leaking reviewer names or review content. The scrub preserves digits, separators, K/M/B suffixes, and the letters of "reviews"; all other characters become `·`.

## Conventions

- ESM-only (`"type": "module"`, `.js` extensions in imports)
- Node 22+ required
- Strict TypeScript, zero `any` types
- Tests use vitest (235 tests across 14 files) – pure-function tests for parser, schema, URL, CSV, JSON, retry, rate-limiter, consent, unrecoverable, batch-utils, validate, scroller, storage-types, scrape-location; Playwright-dependent modules are not unit tested
- `parseInputFile()`, `slugify()`, and `deduplicateFilename()` in batch.ts are exported for testability
- `parseReview()`, `parseReviewCount()`, and `detectLanguage()` in parser.ts are exported for testability
- `parseRatingText()` in business-extractor.ts is exported for testability (called Node-side after `page.evaluate()` returns the raw aria-label string)
- `assembleScrapeResult()` in scrape-location.ts is exported for testability – pure helper that enforces `business.totalReviews === reviews.length` and preserves the header value in `business.headerTotalReviews`
- `appendHlParam()` in consent.ts and `isUnrecoverable()` in retry.ts are exported for testability
- `extractPlaceIdFromUrl()`, `placeIdsMatch()`, and `canVerifyPlaceIdFormat()` in url.ts are exported for testability (direct tests cover priority, encoding, edge cases, null handling, case-insensitivity, and ChIJ vs 0x format discrimination)
- `VOLATILE_STORAGE_TYPES` in `src/scraper/storage-types.ts` is a pure constant kept separate from `browser.ts` so tests can pin the cookies-excluded invariant without pulling in Playwright
- `calculateStaleDelay()` and `shouldContinueScrolling()` in scroller.ts are exported for testability
