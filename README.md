# revcli

CLI tool to scrape Google Maps location reviews using Playwright browser automation.

## Installation

```bash
npm install -g revcli
npx playwright install chromium
```

Or run directly:

```bash
npx revcli scrape "https://maps.app.goo.gl/..." --max-reviews 50
```

## Usage

### Scrape a single location

```bash
# Scrape all reviews (sorted by newest)
revcli scrape "https://maps.app.goo.gl/MTVGWdpd8vVqTouv9"

# Limit to 50 reviews, save to file
revcli scrape "https://maps.app.goo.gl/MTVGWdpd8vVqTouv9" -m 50 -o reviews.json

# Sort by most relevant, output as CSV
revcli scrape "https://maps.app.goo.gl/MTVGWdpd8vVqTouv9" --sort relevant --format csv -o reviews.csv

# Show browser for debugging
revcli scrape "https://maps.app.goo.gl/MTVGWdpd8vVqTouv9" --headed --verbose
```

### Batch scrape multiple locations

Create a text file with one Google Maps URL per line:

```
# locations.txt
https://maps.app.goo.gl/MTVGWdpd8vVqTouv9
https://maps.app.goo.gl/n2kgnxXZnYPYb25CA
https://maps.app.goo.gl/TcNAnWhZZpjrDVtx7
```

```bash
# Scrape all locations, save to output directory
revcli batch locations.txt -d ./output

# Limit reviews, resume interrupted batch
revcli batch locations.txt -d ./output -m 100 --resume
```

### Validate output

```bash
revcli validate reviews.json
```

## Supported inputs

- Google Maps URLs: `https://www.google.com/maps/place/...`
- Short URLs: `https://maps.app.goo.gl/...`
- Place IDs: `ChIJ...`

## Output schema

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
      "rating": 5,
      "text": "Review text (translated)",
      "originalText": "Original language text",
      "originalLanguage": "arabic",
      "photos": 2,
      "ownerResponse": {
        "text": "Response text",
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

## Options

| Option | Default | Description |
|--------|---------|-------------|
| `-m, --max-reviews` | all | Maximum reviews to collect |
| `-s, --sort` | newest | Sort order: newest, relevant, highest, lowest |
| `-o, --output` | stdout | Output file path |
| `-f, --format` | json | Output format: json, csv |
| `--headed` | false | Show browser for debugging |
| `--delay` | 3000 | Delay between scroll actions (ms) |
| `--location-delay` | 10000 | Delay between locations in batch mode (ms) |
| `--resume` | false | Skip already-scraped locations in batch mode |
| `-v, --verbose` | false | Verbose logging |

## Development

```bash
npm install
npx playwright install chromium
npm run dev -- scrape "https://maps.app.goo.gl/..." -m 5
npm test
npm run build
```

## Disclaimer

This tool is for personal and research use. Users are responsible for compliance with Google's Terms of Service and applicable laws.

## License

MIT
