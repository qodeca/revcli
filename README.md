# revcli

![Node](https://img.shields.io/badge/node-%3E%3D22-brightgreen) ![TypeScript](https://img.shields.io/badge/TypeScript-5.8-blue) ![Playwright](https://img.shields.io/badge/Playwright-1.52-green) ![License](https://img.shields.io/badge/license-MIT-blue)

A command-line tool that scrapes Google Maps location reviews using browser automation. No API key required.

## Why revcli?

- **No Google API key, no API quotas** – reads the same public pages a regular browser sees via Playwright automation
- **EEA auth wall handled** – persistent Chrome profile + one-shot `revcli auth` command sign you in once, then reuse the session across runs
- **Rich review data** – bilingual text (translated + original), owner responses, photo counts, author URLs
- **Schema-validated output** – every review round-trips through a Zod schema before landing in JSON/CSV, so data quality is enforced at the boundary
- **Resumable batches** – interrupted large runs pick up where they left off via an atomic state file

## Table of contents

- [Features](#features)
- [Prerequisites](#prerequisites)
- [Installation](#installation)
- [Quick start](#quick-start)
- [CLI reference](#cli-reference)
- [Output schema](#output-schema)
- [How it works](#how-it-works)
- [Troubleshooting](#troubleshooting)
- [Limitations](#limitations)
- [Maintenance](#maintenance)
- [Contributing](#contributing)
- [Reporting a bug](#reporting-a-bug)
- [Legal notice](#legal-notice)
- [License](#license)

## Features

- **Single or batch scraping** – scrape one location or hundreds from a file
- **Full review data** – author, rating, text, photos count, owner responses
- **Bilingual support** – captures both translated and original language text
- **Sort control** – newest, most relevant, highest, or lowest rated
- **Sort verification** – verifies the selected sort order is active before scraping begins
- **Persistent authentication** – sign in to Google once, session reused across runs
- **JSON and CSV output** – structured data ready for analysis
- **Resumable batches** – interrupted batch runs pick up where they left off
- **Schema validation** – verify output files against the expected schema

## Prerequisites

- **Node.js 22+**
- **Chromium** (downloaded automatically via Playwright)

## Installation

> **Not yet published on npm.** Install from source:

```bash
git clone https://github.com/qodeca/revcli.git
cd revcli
npm install
npm run build
npx playwright install chromium
npm link              # optional: exposes `revcli` as a global command
```

After `npm link`, the `revcli` binary is available system-wide. Without linking, use `npm run dev -- scrape '<url>'` from the project directory.

> **Note:** The first install requires `npx playwright install chromium` to download the browser binary (~165 MB).

## Quick start

```bash
# Authenticate with Google (required once – opens browser)
revcli auth

# Scrape 50 reviews and save to file
revcli scrape 'https://maps.app.goo.gl/MTVGWdpd8vVqTouv9' -m 50 -o reviews.json

# Batch scrape multiple locations
revcli batch locations.txt -d ./output

# Validate output
revcli validate reviews.json
```

## CLI reference

### Global options

| Option | Description |
|--------|-------------|
| `-V, --version` | Print version number |
| `-h, --help` | Display help for any command |

### `revcli scrape <url>`

Scrape reviews from a single Google Maps location.

**Arguments:**

| Argument | Description |
|----------|-------------|
| `<url>` | Google Maps URL, short URL (`maps.app.goo.gl/...`), CID URL (`maps?cid=...`), ftid URL (`maps?ftid=0x...:0x...`), or Place ID (`ChIJ...`) |

**Options:**

| Option | Default | Description |
|--------|---------|-------------|
| `-m, --max-reviews <n>` | all | Maximum number of reviews to collect. Must be a positive integer. When capped, `business.totalReviews` equals the capped count and `business.headerTotalReviews` preserves Google's full count |
| `-s, --sort <order>` | `newest` | Review sort order. Choices: `newest`, `relevant`, `highest`, `lowest` |
| `-o, --output <path>` | stdout | Write output to file instead of stdout |
| `-f, --format <type>` | `json` | Output format. Choices: `json`, `csv` |
| `--headless` | `false` | Hide the browser window. Browser shows by default so you can observe scraping and handle auth prompts |
| `--delay <ms>` | `3000` | Delay in milliseconds between scroll actions. Increase if getting rate-limited |
| `-v, --verbose` | `false` | Enable debug-level logging |

**Examples:**

> **Important:** Always use **single quotes** (`'...'`) around Google Maps URLs. Double quotes cause zsh/bash to interpret `!` characters in the URL's `data=` parameter as history expansion, mangling the URL.

```bash
revcli scrape 'https://maps.app.goo.gl/MTVGWdpd8vVqTouv9'
revcli scrape 'https://maps.app.goo.gl/MTVGWdpd8vVqTouv9' -m 50 -o reviews.json
revcli scrape 'https://maps.app.goo.gl/MTVGWdpd8vVqTouv9' --sort relevant --format csv -o reviews.csv
revcli scrape 'ChIJN1t_tDeuEmsRUsoyG83frY4' -m 20 -o place.json
revcli scrape 'https://www.google.com/maps?ftid=0x3e2ee3641f7016d7:0x8e3a8bcf52dad296'
revcli scrape 'https://maps.app.goo.gl/MTVGWdpd8vVqTouv9' --headless --verbose --delay 5000
```

### `revcli batch <file>`

Scrape reviews from multiple locations listed in a file. Produces one output file per location.

**Arguments:**

| Argument | Description |
|----------|-------------|
| `<file>` | Path to a file containing Google Maps URLs – one per line (lines starting with `#` are comments) or a JSON array of URL strings |

**Options:**

| Option | Default | Description |
|--------|---------|-------------|
| `-d, --output-dir <path>` | `./output` | Directory for output files. Created automatically if it doesn't exist |
| `-m, --max-reviews <n>` | all | Maximum number of reviews per location. Must be a positive integer. When capped, `business.totalReviews` equals the capped count and `business.headerTotalReviews` preserves Google's full count |
| `-s, --sort <order>` | `newest` | Review sort order. Choices: `newest`, `relevant`, `highest`, `lowest` |
| `-f, --format <type>` | `json` | Output format. Choices: `json`, `csv` |
| `--headless` | `false` | Hide the browser window |
| `--delay <ms>` | `3000` | Delay in milliseconds between scroll actions within a location |
| `--location-delay <ms>` | `10000` | Delay in milliseconds between locations. Increase to reduce rate-limiting risk |
| `--location-timeout <ms>` | `300000` | Timeout per location in milliseconds (default: 5 minutes). Prevents indefinite hangs |
| `--resume` | `false` | Skip locations already scraped in a previous run. State tracked via `.revcli-state.json` in the output directory |
| `-v, --verbose` | `false` | Enable debug-level logging |

**Examples:**

```bash
revcli batch locations.txt -d ./output
revcli batch locations.txt -d ./output -m 100 --resume
revcli batch locations.txt -d ./output --format csv --location-delay 15000
revcli batch urls.json -d ./reviews --sort relevant --verbose
```

**Input file formats:**

```
# Newline-delimited (comments and blank lines ignored)
# locations.txt
https://maps.app.goo.gl/MTVGWdpd8vVqTouv9
https://maps.app.goo.gl/n2kgnxXZnYPYb25CA
```

```json
// JSON array
["https://maps.app.goo.gl/MTVGWdpd8vVqTouv9", "https://maps.app.goo.gl/n2kgnxXZnYPYb25CA"]
```

### `revcli validate <file>`

Validate a JSON output file against the expected schema. Exits with code 1 on failure.

**Arguments:**

| Argument | Description |
|----------|-------------|
| `<file>` | Path to a JSON file to validate |

**Examples:**

```bash
revcli validate reviews.json
revcli validate output/bfit-yasmeen-mens.json
```

### `revcli auth`

Manage Google account authentication. Required for EEA users where Google shows a "limited view" without sign-in.

| Subcommand | Description |
|------------|-------------|
| *(none)* | Open browser and sign in to Google interactively |
| `status` | Check if currently signed in (headless, exit code 1 if not) |
| `logout` | Clear saved browser session |

**Examples:**

```bash
revcli auth                # Sign in (opens browser)
revcli auth status         # Check auth state
revcli auth logout         # Clear session
```

**How it works:** revcli uses a persistent Chrome profile at `~/.revcli/chrome-profile/`. Sign in once with `revcli auth`, and all subsequent scrapes reuse that session. Google auth cookies persist between CLI runs.

## Output schema

<details>
<summary>JSON output structure</summary>

```json
{
  "business": {
    "name": "Business Name",
    "placeId": "0x...:0x...",
    "url": "https://...",
    "address": "Full address",
    "rating": 4.5,
    "totalReviews": 312,
    "headerTotalReviews": 568,
    "scrapeDate": "2026-04-08T15:00:00.000Z"
  },
  "reviews": [
    {
      "id": "google-review-id",
      "author": "Reviewer Name",
      "authorUrl": "https://www.google.com/maps/contrib/...",
      "publishTime": "2 weeks ago",
      "rating": 5,  // 0–5 (0 = could not parse stars)
      "text": "Review text (translated if applicable)",
      "originalText": "Original language text",
      "originalLanguage": "arabic",
      "photos": 2,
      "ownerResponse": {
        "text": "Owner response text",
        "originalText": "Original response",
        "originalLanguage": "english",
        "publishTime": "a month ago"
      }
    }
  ],
  "metadata": {
    "provider": "playwright",
    "scrapeDurationMs": 8243,
    "reviewsCollected": 5,
    "sortOrder": "newest"
  }
}
```

**Business field notes:**

- `business.totalReviews` – Number of reviews collected in this file (equals `reviews.length`). Internally consistent with the `reviews` array.
- `business.headerTotalReviews` – Google Maps header-reported review count, or `null` if the header could not be parsed. May differ from `totalReviews` when Google under-reports, when `--max-reviews` caps collection, or when the header parser cannot read the value.

</details>

### Output schema changes

**`business.totalReviews` now reflects the collected review count, not Google's header value.**

Previously, `business.totalReviews` was populated from the Google Maps business listing header at the start of the scrape (e.g., `"568 reviews"`). As of this release it equals `reviews.length` in the same file, so the metadata is internally consistent with the payload.

The original Google-reported header value is preserved in a new field, `business.headerTotalReviews`. It is nullable (`null` when parsing failed). Old JSON files written by previous revcli versions still load via `revcli validate` – the missing field defaults to `null`.

Note: when you pass `--max-reviews N`, `totalReviews === N` (the capped collected count), and `headerTotalReviews` holds Google's larger number.

## How it works

revcli uses [Playwright](https://playwright.dev/) to automate a Chromium browser with a persistent profile:

1. Launches browser using a saved Chrome profile (`~/.revcli/chrome-profile/`)
2. Navigates to the Google Maps place URL (strips tracking params, forces English locale)
3. Handles cookie consent and checks for Google's "limited view" (EEA auth wall)
4. Opens the Reviews tab and sets the sort order
5. Scrolls the review panel using mouse wheel events to trigger lazy loading
6. Extracts review data from the DOM in bulk via `page.evaluate()`
7. Validates each review through [Zod](https://zod.dev/) schemas
8. Deduplicates by review ID and repeats until all reviews are collected or no more are available

No Google API key is needed – the tool reads the same public page a regular browser would see. The browser shows by default (use `--headless` to hide it).

## Troubleshooting

| Symptom | Diagnosis | Fix |
|---|---|---|
| "Limited view" appears instead of the Reviews tab | Google's EEA auth wall for unauthenticated users | Run `revcli auth` once to sign in; the persistent profile remembers you |
| URL in command gets mangled, `!` characters rewritten | zsh/bash history expansion on `!` | Always wrap URLs in **single quotes** (`'...'`), never double quotes |
| Scraper returns 0 reviews with no errors | Selectors may be stale – Google rotates obfuscated classes | Run with `--verbose` and see [docs/selector-maintenance.md](docs/selector-maintenance.md) to update selectors |
| Warning: "N reviews have rating=0 – stars selector may be stale" | The stars selector went stale; reviews still collected, just without star ratings | Update `SELECTORS.stars` in `src/scraper/selectors.ts` |
| Scraper hangs or times out mid-scroll | Rate limiting or anti-bot throttling | Increase `--delay` (default 3000 ms); for batches, increase `--location-delay` (default 10000 ms) |
| `business.headerTotalReviews` is `null` in the output | Header parser couldn't read the count; `business.totalReviews` still equals `reviews.length` | Cosmetic – the scrape itself succeeded |
| Scrape plateaus before reaching the place's full review count | Google Maps filters the `newest` sort by recency/verification; the header number is not ground truth | Expected. Use `--sort relevant` if you need more coverage |
| "captcha detected" / "UnrecoverableError" | Google challenged the browser; running scrapes from that IP may be throttled | Wait 15–30 minutes; increase delays; consider a different network |

Run any command with `-v, --verbose` for debug-level logs including selector parse decisions, scroll state, and navigation verification.

## Limitations

- **Selector fragility** – Google Maps uses obfuscated CSS class names that change periodically. When this happens, the scraper returns zero reviews. All selectors are centralized in `src/scraper/selectors.ts` for easy updating.
- **Relative timestamps** – Google Maps shows review times as "2 weeks ago" rather than exact dates. These are captured as-is.
- **No translation toggle** – The tool captures whatever text Google displays (usually auto-translated). The original language text requires clicking "See original" which is not currently automated.
- **Language detection** – The `originalLanguage` field uses a simple Arabic/Latin script heuristic, not full language identification.
- **`newest` sort filtering** – Google Maps applies hidden recency/verification filters when sorting by newest. The collected review count can plateau below the header-reported total (this is Google-side behaviour, not a scraper bug).

## Maintenance

Google rotates the obfuscated CSS class names every few weeks to months. When that happens, the scraper silently returns zero reviews. All selectors live in **`src/scraper/selectors.ts`** – update them in one place. The full update procedure, diagnosis steps, and list of stable vs fragile patterns is in [**docs/selector-maintenance.md**](docs/selector-maintenance.md). Read the "Expand button lesson" section there before touching `SELECTORS.expandButton` – it documents a three-revision debugging story that's easy to accidentally undo.

## Contributing

```bash
git clone https://github.com/qodeca/revcli.git
cd revcli
npm install
npx playwright install chromium
```

### Development workflow

```bash
npm run dev -- scrape 'https://maps.app.goo.gl/...' -m 5    # Run from source
npm test                                                      # Run all tests (238)
npx vitest run tests/parser.test.ts                           # Run single test file
npm run typecheck                                             # Type check
npm run build                                                 # Build to dist/
```

Architecture, data-flow patterns, and coding conventions are documented in [CLAUDE.md](CLAUDE.md). Read it before making structural changes – it captures hard-won lessons (Playwright locator scoping, typed unrecoverable errors, `hl=en` invariant, etc.) that aren't obvious from the source.

### Project structure

```
src/
├── commands/       # CLI command handlers (scrape, batch, validate, auth)
├── scraper/        # Playwright automation
│   ├── browser.ts              # Persistent Chrome profile, anti-detection
│   ├── auth.ts                 # Google sign-in detection, limited view handling
│   ├── navigator.ts            # Orchestrates page navigation flow
│   ├── consent.ts              # Google consent + locale + URL normalization
│   ├── business-extractor.ts   # Business info extraction from DOM
│   ├── scroller.ts, extractor.ts, parser.ts  # Review collection pipeline
│   └── selectors.ts            # All Google Maps CSS selectors (update here when they break)
├── core/           # Schema definitions (Zod), types (SortOrder, OutputFormat), retry, UnrecoverableError, rate limiter
├── output/         # writeOutput() dispatcher, JSON and CSV writers
└── utils/          # URL parser, logger, batch progress
```

See [CLAUDE.md](CLAUDE.md) for architecture details and coding conventions.

## Reporting a bug

Before opening an issue, please include the following so maintainers can reproduce:

1. **`revcli --version`** output
2. **Command you ran**, with the URL **in single quotes**
3. **`--verbose` log** from the failing run (trim or redact reviewer names / review text if you're worried about PII – the tool's built-in PII scrubbing only covers header-parser debug logs, not full extraction)
4. **OS and Node version** (`uname -a`, `node --version`)
5. **A Google Maps place URL that reproduces the issue**, if possible – selectors sometimes behave differently on different place types (restaurants, hotels, gyms, etc.)

Known classes of issues and where to look:
- **Zero reviews returned** or `rating=0` warnings → Google rotated a selector. See [docs/selector-maintenance.md](docs/selector-maintenance.md).
- **`UnrecoverableError` with `NAV_VERIFY`** → cross-contamination guard tripped; the scraper intentionally bails rather than return stale data. Open an issue with the verbose log.
- **`captcha detected`** → you're being throttled. Not a bug, but an issue helps track frequency.

## Legal notice

This tool automates a web browser to access publicly available information on Google Maps. It is provided for personal, educational, and research purposes.

- Users are solely responsible for ensuring their use complies with [Google's Terms of Service](https://policies.google.com/terms) and all applicable laws
- The authors do not encourage or condone use of this tool in violation of any terms of service
- Use reasonable delays between requests to avoid excessive load on Google's servers
- This tool is not affiliated with, endorsed by, or connected to Google in any way

## License

[MIT](LICENSE)
