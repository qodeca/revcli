# revcli

A command-line tool that scrapes Google Maps location reviews using browser automation. No API key required.

## Features

- **Single or batch scraping** – scrape one location or hundreds from a file
- **Full review data** – author, rating, text, photos count, owner responses
- **Bilingual support** – captures both translated and original language text
- **Sort control** – newest, most relevant, highest, or lowest rated
- **JSON and CSV output** – structured data ready for analysis
- **Resumable batches** – interrupted batch runs pick up where they left off
- **Schema validation** – verify output files against the expected schema

## Prerequisites

- **Node.js 22+**
- **Chromium** (downloaded automatically via Playwright)

## Installation

```bash
npm install -g revcli
npx playwright install chromium
```

Or run without installing:

```bash
npx revcli scrape "https://maps.app.goo.gl/..." --max-reviews 50
```

> **Note:** The first run requires `npx playwright install chromium` to download the browser binary (~165 MB).

## Quick start

```bash
# Authenticate with Google (required once – opens browser)
revcli auth

# Scrape 50 reviews and save to file
revcli scrape "https://maps.app.goo.gl/MTVGWdpd8vVqTouv9" -m 50 -o reviews.json

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
| `<url>` | Google Maps URL, short URL (`maps.app.goo.gl/...`), or Place ID (`ChIJ...`) |

**Options:**

| Option | Default | Description |
|--------|---------|-------------|
| `-m, --max-reviews <n>` | all | Maximum number of reviews to collect. Must be a positive integer |
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
revcli scrape "https://maps.app.goo.gl/MTVGWdpd8vVqTouv9" --headless --verbose --delay 5000
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
| `-m, --max-reviews <n>` | all | Maximum number of reviews per location. Must be a positive integer |
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

</details>

## How it works

revcli uses [Playwright](https://playwright.dev/) to automate a Chromium browser with a persistent profile:

1. Launches browser using a saved Chrome profile (`~/.revcli/chrome-profile/`)
2. Navigates to the Google Maps place URL (strips tracking params, forces English locale)
3. Handles cookie consent and checks for Google's "limited view" (EEA auth wall)
4. Opens the Reviews tab and sets the sort order
5. Scrolls the review panel using mouse wheel events to trigger lazy loading
6. Extracts review data from the DOM in bulk via `page.evaluate()`
7. Validates each review through [Zod](https://zod.dev/) schemas
8. Deduplicates by review ID and repeats until all reviews are collected

No Google API key is needed – the tool reads the same public page a regular browser would see. The browser shows by default (use `--headless` to hide it).

## Limitations

- **Selector fragility** – Google Maps uses obfuscated CSS class names that change periodically. When this happens, the scraper returns zero reviews. All selectors are centralized in `src/scraper/selectors.ts` for easy updating. See [docs/selector-maintenance.md](docs/selector-maintenance.md).
- **Rate limiting** – Google may throttle or block requests from automated browsers. Use `--delay` and `--location-delay` to control request pacing.
- **Relative timestamps** – Google Maps shows review times as "2 weeks ago" rather than exact dates. These are captured as-is.
- **No translation toggle** – The tool captures whatever text Google displays (usually auto-translated). The original language text requires clicking "See original" which is not currently automated.
- **Language detection** – The `originalLanguage` field uses a simple Arabic/Latin script heuristic, not full language identification.
- **Shell quoting** – Google Maps URLs contain `!` characters that zsh/bash interpret as history expansion. Always wrap URLs in single quotes (`'...'`), not double quotes.

## Contributing

```bash
git clone https://github.com/user/revcli.git
cd revcli
npm install
npx playwright install chromium
```

### Development workflow

```bash
npm run dev -- scrape "https://maps.app.goo.gl/..." -m 5    # Run from source
npm test                                                      # Run all tests (108)
npx vitest run tests/parser.test.ts                           # Run single test file
npm run typecheck                                             # Type check
npm run build                                                 # Build to dist/
```

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
├── core/           # Schema definitions (Zod), types (SortOrder, OutputFormat), retry, rate limiter
├── output/         # writeOutput() dispatcher, JSON and CSV writers
└── utils/          # URL parser, logger, batch progress
```

See [CLAUDE.md](CLAUDE.md) for architecture details and coding conventions.

## Legal notice

This tool automates a web browser to access publicly available information on Google Maps. It is provided for personal, educational, and research purposes.

- Users are solely responsible for ensuring their use complies with [Google's Terms of Service](https://policies.google.com/terms) and all applicable laws
- The authors do not encourage or condone use of this tool in violation of any terms of service
- Use reasonable delays between requests to avoid excessive load on Google's servers
- This tool is not affiliated with, endorsed by, or connected to Google in any way

## License

[MIT](LICENSE)
