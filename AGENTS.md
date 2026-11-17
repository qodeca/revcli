# AGENTS.md

Guidance for coding agents working in this repository.

## Agent tooling

This project is managed only by open-source agent clients — OpenCode, pi, and Qwen — running local models attached to those clients. There is no Claude Code or Codex setup here, and none should be introduced. Project guidance lives in this file (`AGENTS.md`); `CLAUDE.md` is not used.

Local scratch lives under `.local/` and is never committed.

## Commands

```bash
npm run dev -- scrape '<url>' [options] # Run CLI directly (single-quote URLs!)
npm run dev -- auth                     # Authenticate with Google (opens browser)
npm run dev -- auth status              # Check if signed in
npm run build                           # Build to dist/ via tsup (ESM, shebang)
npm test                                # Run all tests (vitest) – needs Chromium (browser tests)
npm run test:browser                    # Only the headless-browser tests (tests/browser)
npm run test:watch                      # Watch mode
npx vitest run tests/parser.test.ts     # Run a single test file
npm run typecheck                       # Type check without emitting
npm run check:pack                      # Assert the tarball contract (dist present, no src/tests)
npm run test:package                    # Pack + install into a temp consumer, assert --version
npx playwright install chromium         # Required once before first scrape and before `npm test`

# Release (see "Release and publishing" below)
node scripts/release.mjs patch|minor|major   # Prepare: stamp package.json + lock (the workflow opens the bump PR)
node scripts/release.mjs existing            # Publish the version committed on main
node scripts/release.mjs existing --dry-run  # Rehearse the publish without publishing
```

## Release and publishing

revcli publishes to npm as **`@qodeca/revcli`**, only from `main`, only through
`.github/workflows/release.yml` (`workflow_dispatch`). Runbook: [docs/releasing.md](docs/releasing.md);
one-time setup: [docs/publishing.md](docs/publishing.md).
What was learned building it (npm 2FA, registry propagation, Actions gotchas):
[docs/release-learnings.md](docs/release-learnings.md). The Qwen Code skill
`.qwen/skills/release-revcli/` mirrors this section for an agent driving a release.

### The two-step release (bump-first)

1. Dispatch `Release` with `bump = patch | minor | major` → stamps `package.json` **and
   `package-lock.json`**, opens a `release/vX.Y.Z` PR. **Publishes nothing.**
2. Merge that PR.
3. Dispatch `Release` with `bump = existing` → builds, verifies, publishes, tags `vX.Y.Z`,
   creates the GitHub Release.

The version on npm is therefore always the version committed on `main`: the tag, the manifest
and the registry agree, and `latest` can only move forward. Do not "simplify" this back to
stamp-then-publish — that is what makes the tag disagree with the manifest and lets `latest`
regress.

### Invariants — do not undo these

- **Never put `${{ }}` in a `run:` block.** Pass it through `env:` and quote the variable.
  A workflow input interpolated into a shell command is code execution in a job that can
  publish to npm.
- **Never add `registry-url` to `setup-node`** in the publish job. It writes an `_authToken`;
  npm then skips the OIDC exchange and the publish fails with a misleading `ENEEDAUTH`/404.
- **Never pass `--tag latest`** to `npm publish`. npm applies its "higher version already
  published" guard only when the tag is *default*; an explicit `--tag latest` disables it.
- **Publish with `--ignore-scripts` and install with `npm ci --ignore-scripts`**, so no
  dependency lifecycle script runs while the job holds `id-token: write`.
- **The gate is a separate job and fails loudly.** A job-level `if:` that skips reports as a
  green run, and `environment:` protection is evaluated before any step runs.
- **`release.mjs` refuses to publish without OIDC** unless `--bootstrap` is passed. There is
  deliberately no token / `npm login` fallback — a laptop publish would bypass CI, the branch
  check, the approval and provenance at once.
- **`release.mjs` never stamps in `existing` mode.** The version it publishes is the one
  committed on `main`.

### Scripts

- `scripts/release.mjs` — the orchestrator. `patch|minor|major` = prepare (stamp only);
  `existing` = publish (registry pre-checks → build → `check:pack` → `test:package` → publish
  → verify `latest`). `--dry-run` rehearses; `--bootstrap` permits the one-time local first
  publish.
- `scripts/check-pack.mjs` — tarball contract: `dist/index.js` present, no `src/`/tests,
  name `@qodeca/revcli`, version matches the manifest.
- `scripts/test-package.mjs` — packs, installs into a temp consumer with `--ignore-scripts`,
  asserts `revcli --version` equals the manifest version.

### Git conventions

- `develop` → `main` lands as a **merge commit**; feature PRs into `develop` are
  **squash**-merged. Match the direction.
- Check the license before releasing: `git show origin/main:package.json | grep license`.
  The tarball ships `LICENSE`, `README.md` and `package.json`, so a license mismatch ships
  the wrong terms to every installer.

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
├── auth.ts                 ── getSessionState()/decideSessionState() (single source of truth for the Google session), hasLimitedView(), authRequiredError()/authRequiredMessage(), waitForUserAuth(), waitForSignIn(), waitForBrowserClose()
├── navigator.ts            ── orchestrates state eviction → short-link redirect wait → consent → locale → tab (limited-view check before and after the review cards load) → sort; verifies loaded placeId against parsed.placeId
├── consent.ts              ── Google consent handling, hl=en enforcement, g_ep/entry stripping
├── business-extractor.ts   ── business name/rating/totalReviews/address extraction; page.evaluate() returns raw DOM strings only, parsing happens Node-side via parseReviewCount + parseRatingText; PII-scrubbed debug logging of candidate strings
├── scroller.ts             ── mouse wheel scrolling, deduplication by review ID, exponential backoff stale-scroll detection, loading spinner awareness
├── extractor.ts            ── single page.evaluate() for bulk DOM extraction, original-language capture (captureOriginalTexts), staleness warnings
├── parser.ts               ── RawReview → validated Review via Zod, language detection
├── selectors.ts            ── ALL Google Maps CSS selectors in one place (fragile, version-dated)
└── storage-types.ts        ── pure VOLATILE_STORAGE_TYPES constant (CDP storage tokens cleared before each scrape; cookies excluded)

src/core/
├── schema.ts       ── Zod schemas + SortOrder/OutputFormat union types + SORT_ORDERS/OUTPUT_FORMATS constants
├── retry.ts        ── withRetry() – exponential backoff, isUnrecoverable() detection (instanceof UnrecoverableError + substring fallback)
├── errors.ts       ── UnrecoverableError typed class with a `kind: UnrecoverableKind` union, hasUnrecoverableKind() – prefer over magic-substring Error for anything we throw
├── fatal.ts        ── reportFatalError() – the top-level handler index.ts installs; describeFatalError() decides what it prints (message without Playwright call log; stack at debug only); re-exports safeErrorMessage()
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

- **Persistent browser profile**: `launchBrowser()` uses `chromium.launchPersistentContext()` with `~/.revcli/chrome-profile/`. Google auth cookies survive between CLI runs. The `PROFILE_DIR` constant is exported from `browser.ts`. `ensureProfileDir()` in `browser.ts` creates the directory with owner-only `0700` permissions – it is a **credential store** holding your Google session cookies, so it must never be shared, backed up, or committed. The profile's spoofed user-agent and `navigator.webdriver` masking are ToS-sensitive (see the anti-automation note in README's Legal notice); removing them would break unauthenticated scraping.
- **Authentication flow**: Google Maps shows a "limited view" to signed-out EEA users and to profiles whose saved session has expired: the Reviews tab is still there but only ~5 reviews load, a "You're seeing a limited view of Google Maps" banner appears, and Sort opens a "Sign-in to get the best of Google Maps" dialog. **The scrape decides from these limited-view signals (banner + Sort sign-in dialog), not from session state**, because non-EEA signed-out users get the full view – do not "simplify" this to a session check. `openReviewsTab()` checks the banner twice (after the tabs, and again after the review cards, since it can render late and `relevant` has no Sort click); `setSortOrder()` waits for the first *visible* of the sort menu or `SELECTORS.signInDialog`. Both throw `authRequiredError()` (`UnrecoverableError` kind `"AUTH_REQUIRED"`, never retried). `scrapeLocation()` delegates to the exported, fake-tested `navigateWithAuthFallback()`: headless rethrows at once; headed runs `waitForUserAuth()` and navigates again, **using the second navigation's business info**. A terminal `AUTH_REQUIRED` is reworded by a 5 s session probe: `authRequiredMessage()` gives the "run `revcli auth`" text for `expired`/`signed-out`/unknown and a "appears to be signed in" text for `signed-in`/`unconfirmed`, so `auth status` and the scrape cannot contradict each other silently. Session state is only used to word that error and to detect sign-in completion. `revcli auth` opens a browser for manual sign-in and never short-circuits on a real session – for `signed-in`/`unconfirmed` the window stays open until the user closes it (#24, account switching); for `expired` it says so and waits for a fresh sign-in, closing on detection.
- **Session state (single source of truth)**: `getSessionState(page, { timeoutMs, stableMs })` in `auth.ts` returns `SessionState` (`"signed-in" | "expired" | "signed-out" | "unconfirmed"`) and is used by `auth`, `auth status` and `waitForSignIn()`; there is no second "is signed in" check. It reads the `.google.com` cookies (`GOOGLE_AUTH_COOKIES`: SID/HSID/SSID/APISID/SAPISID/`__Secure-*PSID`/`__Secure-*PAPISID`) – no auth cookies is a fast `signed-out` – then waits (default 15 s) for an account marker: `SELECTORS.accountButton` (`a[href^="https://accounts.google.com/SignOutOptions"]`) vs `SELECTORS.signInLink` (`…/ServiceLogin`). Markers are matched by **href, never aria-label**: hrefs are language-independent, while labels are localized and the account label holds the user's name and email. Cookies prove a session *exists*, not that Google *accepts* it – a dead session keeps its cookies and shows "Sign in", which `decideSessionState()` (pure, exported) maps to `expired`. With auth cookies a "Sign in" link must stay the only marker for `stableMs` because Google can render it briefly on a valid session – `SESSION_SIGN_IN_STABLE_MS` (3 s, the default, for `auth` and `auth status`, which report once) and `POLL_SIGN_IN_STABLE_MS` (1.5 s, in `POLL_PROBE`, for the sign-in poll loop and the scrape's error wording, which simply ask again); the account link always wins; no stable marker in time → `unconfirmed` (trusted with a warning by `auth`/`auth status`; `waitForSignIn()` keeps polling). The marker read swallows every Playwright error and never logs error text, element HTML or labels (Playwright call logs print markup). `waitForSignIn()` takes an injectable `probe` (defaults to `getSessionState` with `POLL_PROBE`: 5 s marker wait, 1.5 s stability; `tests/browser/session.test.ts` also runs it with the real probe), returns `"signed-in"` only when the probe says so, throws `UnrecoverableError` kind `"AUTH_POLL"` on timeout, and returns `SignInOutcome` (`"signed-in"` | `"browser-closed"`) – `waitForUserAuth()` treats a closed window as fatal for the scrape, while `revcli auth` reports it as a normal end. `waitForBrowserClose()` resolves once the window is gone, polling `pages()` as well as the `close` event because closing the last window on macOS leaves the process (and context) alive.
- **Default headed mode**: The browser shows by default so users can observe scraping. Use `--headless` to hide it. This is the opposite of most scrapers – it's intentional because auth requires a visible browser.
- **URL normalization**: `appendHlParam()` in `consent.ts` always forces `hl=en` and strips `g_ep`/`entry` tracking params that trigger Google's limited view. This runs before every navigation. After the page has landed (redirects, consent), `ensureEnglishLocale()` navigates again when the *parsed* query has `hl` other than exactly `en` (pure helper `englishLocaleTarget()`). Only for short-link input (`stripLimitedViewParams: parsed.isShortUrl`) it also navigates to strip `entry`/`g_ep`, because that is the one case where they could not be stripped before the load; on other links Google's own page script may add them back, and re-checking would cost a second page load on every scrape.
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
- **Playwright locator scoping for comma-lists**: Never flat-concatenate selector constants like `` `${SELECTORS.reviewCard} ${SELECTORS.expandButton}` `` – CSS parses the comma as a selector-list union, leaving the second alternative unscoped and matching page-wide. Use chained locators (`page.locator(SELECTORS.reviewCard).locator(SELECTORS.expandButton)`) or, in-page, `card.querySelectorAll(SELECTORS.expandButton)` – both scope every alternative to the parent's subtree. `expandAllReviews()` in `extractor.ts` now scopes in-page this way. `tests/extractor-selectors.test.ts` pins the regression shape.
- **Visible-filtered waits and counts**: every "first of several markers" wait uses `a.or(b).filter({ visible: true }).first().waitFor({ state: "visible", timeout })`, and every presence check uses `loc.filter({ visible: true }).count() > 0` – never `isVisible()` on a multi-match locator, and never an unfiltered `.first()`, because a hidden earlier match (a template, a duplicate link) stalls the wait or answers wrongly. Used by `setSortOrder()` and the session-marker read.
- **In-page closures**: code passed to `page.evaluate`, `waitForFunction` or `locator.evaluate` runs in the browser. It may reference only its parameters and browser globals (pass Node constants as arguments – `SCROLL_STEP` read from Node scope crashed every scrape on the second scroll, issue #31), and must not declare named inner functions or `const f = () => …`: tsx/esbuild keepNames wraps those in `__name(...)`, which does not exist in the page. Anonymous inline callbacks (`.map((x) => …)`) are fine. Init scripts are passed as strings (`addInitScript({ content })`) so no transform can touch them. The vitest transform does **not** enable keepNames, so the browser tests catch Node-reference bugs but **not** `__name` bugs – that guard is a live `npm run dev` run that scrolls (e.g. `-m 30`).
- **Expand step**: Google removes a review's "More" button once clicked, so `expandAllReviews(page, skipIds)` uses mark-and-confirm, never positional `nth(i)`: one in-page scan (`scanExpandButtons`) stamps each *pending* button (rendered, not `aria-expanded="true"`) in cards not in `skipIds` with a Node-generated `data-revcli-expand` token (alphabet `[a-z0-9-]`, old stamps cleared first); each token is clicked and confirmed by `waitForFunction` (gone, disconnected, hidden, or `aria-expanded="true"` – this also covers owner-response buttons whichever way they react); up to 2 passes. The scroller passes its collected ids as `skipIds`, so a stuck button costs at most 2 clicks once. `ExpandResult` is for debug logs only: the truncation warning (`formatTruncationWarning()`) comes from the per-card `expandPending` flag that `extractReviews()` reads at extraction time, counted by `collectOnce()` for newly collected reviews and logged once at the end of `scrollAndCollectReviews()`. Every collect path (including the spinner retry) goes through `expandAndCollect()`. Still-truncated reviews are collected anyway (deferring risks losing the whole card from the virtualized list). See docs/selector-maintenance.md §5.
- **Short links redirect in page script**: `maps.app.goo.gl` links no longer redirect with an HTTP 3xx, so `page.goto(..., domcontentloaded)` can resolve while the page is still on the short-link host. `waitForShortLinkRedirect()` in `navigator.ts` waits for the destination before `handleConsent()`/`ensureEnglishLocale()` run. Without it `hl=en` is added to the short link and lost in the redirect, and a signed-out or non-English profile gets a localized page that no English selector or banner text matches (the host constant `SHORT_LINK_HOST` and the pure helper `isShortLinkUrl()` live in `src/utils/url.ts`, which also derives the short-URL input regex from the same constant; pinned by `tests/browser/navigation.test.ts`, which also asserts the final URL has `hl=en` and no `entry`/`g_ep`).
- **Non-place detection**: a link that lands on a search results page fails once with `UnrecoverableError` kind `"NOT_A_PLACE"` and `NOT_A_PLACE_MESSAGE` (which does not echo the URL – batch prints it). Detection is by path (`isSearchResultsUrl()`: `/maps/search…`), never by text (Google may serve that page in another language), and only after the `h1` wait (or the tab wait) times out, because CID and some redirect links pass through `/maps/search/` on their way to `/maps/place/`. Any other timeout is rethrown unchanged so real network flakiness is still retried.
- **Fatal error reporting**: `index.ts` runs `program.parseAsync().catch(reportFatalError)`; `reportFatalError()` in `fatal.ts` prints `describeFatalError(err).message` once via `logger.error`, sets exit code 1, adds "Run again with --verbose for details." only for unexpected errors (not `isUnrecoverable` ones or `ENOENT`), and logs the stack at debug level only. Playwright's "Call log:" section is cut from the message and the stack (it can print the account link's label). `withRetry()` logs its "unrecoverable error" line at debug, so the message appears exactly once; command handlers do not catch `UnrecoverableError` themselves. Any error message from browser code that reaches output or logs goes through `safeErrorMessage()` (call log cut) – batch's per-location failure line, the `withRetry` debug line and the sign-in poll debug line. It is defined in `errors.ts` (no imports, so `retry.ts` can use it without a cycle) and re-exported from `fatal.ts`.
- **Browser tests**: `tests/browser/*.test.ts` run the real in-page code (scroll, expand, session markers, navigation) in a fresh non-persistent headless Chromium (`chromium.launch`) against local HTML from `tests/browser/fixtures/maps-page.ts`. They must **never** import `launchBrowser` or `PROFILE_DIR` (the `~/.revcli` credential store); `tests/browser-import-guard.test.ts` scans every test file for such imports. Timing-sensitive fixture behaviour is event-driven where possible (e.g. `bannerOnReviewsTabClick` shows the banner only after revcli's first check). The harness registers `context.route("**/*", abort)` first and fixture routes after it, so nothing reaches the network even with fake cookies. Fixture behaviour is a plain `<script>` inside the HTML string (never transformed) that mirrors Google: "More" buttons that remove themselves, wheel-driven list growth, the banner, the Sort sign-in dialog, the account/sign-in links. Playwright does not route the follow-up request of a fulfilled 3xx, so fixtures change their final URL with `rewriteUrlTo` (`history.replaceState`) instead of a redirect. Each browser file starts with `vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })`; the global timeout stays short for unit tests. CI installs the headless shell with `npm exec --no -- playwright install --with-deps --only-shell chromium` (never in `release.yml`'s publish job). When Google's behaviour changes, update the fixture along with the selectors.
- **Prefer `jsaction` over `:has-text()` for selector fallbacks**: Playwright's `:has-text("X")` is a case-insensitive substring match over descendant text content. Reviewer names containing "more" (e.g. "KHALID ALMORET" → "AL·MORE·T") made author buttons match the old `expandButton` fallback, causing Local Guide tab pollution and scroll-state drift at ~790 reviews. `SELECTORS.expandButton` now uses `button[jsaction*="review.expand"]` instead. Google's `jsaction` routes are semantic (e.g. `review.expandReview`, `review.expandOwnerResponse`, `review.reviewerLink`) and cannot collide with reviewer data.
- **Translated-review original text is captured by toggling**: A review Google translated renders a toggle button (`button[jsaction*="review.showReview"]`, `SELECTORS.viewOriginalButton`). The original-language text is NOT pre-rendered in the DOM – it only appears after clicking the toggle (which flips `aria-checked` and swaps `div.MyEned[lang]` / `span.wiI7pd` to the original). `extractReviews()` records `isTranslated` + a button-text language hint (parsed by `extractOriginalLanguageFromButtonText()`); `captureOriginalTexts()` (defined in `extractor.ts`, called from `scroller.ts`) then toggles each not-yet-collected review, reads the original, and restores. `parseReview()` uses the captured `originalText`/`originalLanguage` directly and does NOT mirror `text` (the old misleading behavior). See docs/selector-maintenance.md §5b.
- **Version auto-sync from package.json**: `src/index.ts` reads the CLI version via `import pkg from "../package.json" with { type: "json" }` and passes `pkg.version` to Commander. Requires `rootDir` to be absent from `tsconfig.json` (package.json sits outside `src/`). Bumping `package.json` alone propagates to `revcli --version` on the next build.

## Conventions

- ESM-only (`"type": "module"`, `.js` extensions in imports)
- Node 22+ required
- Strict TypeScript, zero `any` types
- Tests use vitest (419 tests across 25 files) – pure-function tests for parser, schema, URL, CSV, JSON, retry, rate-limiter, consent, unrecoverable, fatal, batch-utils, validate, scroller, storage-types, scrape-location, selectors, extractor-selectors, extractor, auth, auth-command; `browser-import-guard` fails if any test file imports `launchBrowser` or `PROFILE_DIR`; plus 4 browser files in `tests/browser/` (scroll, expand, session, navigation) that run the in-page code in headless Chromium against local fixtures (see "Browser tests"). Other browser-coupled code is not unit tested, except where a narrow structural type or injected function makes it fakes-only (`ClosableBrowser` for `waitForBrowserClose`, `probe` for `waitForSignIn`, `navigateWithAuthFallback`)
- `parseInputFile()`, `slugify()`, and `deduplicateFilename()` in batch.ts are exported for testability
- `parseReview()`, `parseReviewCount()`, and `detectLanguage()` in parser.ts are exported for testability
- `parseRatingText()` in business-extractor.ts is exported for testability (called Node-side after `page.evaluate()` returns the raw aria-label string)
- `assembleScrapeResult()` in scrape-location.ts is exported for testability – pure helper that enforces `business.totalReviews === reviews.length` and preserves the header value in `business.headerTotalReviews`
- `appendHlParam()` in consent.ts and `isUnrecoverable()` in retry.ts are exported for testability
- `extractPlaceIdFromUrl()`, `placeIdsMatch()`, and `canVerifyPlaceIdFormat()` in url.ts are exported for testability (direct tests cover priority, encoding, edge cases, null handling, case-insensitivity, and ChIJ vs 0x format discrimination)
- `VOLATILE_STORAGE_TYPES` in `src/scraper/storage-types.ts` is a pure constant kept separate from `browser.ts` so tests can pin the cookies-excluded invariant without pulling in Playwright
- `calculateStaleDelay()` and `shouldContinueScrolling()` in scroller.ts are exported for testability
- `waitForBrowserClose()` in auth.ts takes the narrow structural `ClosableBrowser` (not `BrowserContext`) so its poll/close-event behaviour is testable against a fake, and `waitForSignIn()` returns the `SignInOutcome` union instead of `void` so each caller's closed-window policy is explicit and pinned by tests; its injectable `probe` keeps those tests browser-free
- `decideSessionState()` and `authRequiredMessage()` in auth.ts, `formatTruncationWarning()` in extractor.ts, `isSearchResultsUrl()` in url.ts, `NOT_A_PLACE_MESSAGE` in navigator.ts, `navigateWithAuthFallback()` in scrape-location.ts (takes `navigate`/`waitForAuth`/`sessionProbe` functions, so it is tested with fakes), `hasUnrecoverableKind()` in errors.ts, `describeFatalError()`, `reportFatalError()` and `safeErrorMessage()` in fatal.ts, `englishLocaleTarget()` in consent.ts, `isShortLinkUrl()`/`SHORT_LINK_HOST` in url.ts, and `statusOutcome()`/`loginPlan()` in commands/auth.ts (the pure state → output/exit-code/next-step mapping of `auth status` and `auth`) are exported for testability
- `extractOriginalLanguageFromButtonText()` in extractor.ts is exported for testability – pure helper that parses the human-readable language name out of the translated-review toggle button text ("See original (Polish)" → "Polish", handles nested parens like "Chinese (Simplified)")
