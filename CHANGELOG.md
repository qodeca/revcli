# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed
- Scrapes no longer crash after the first batch of reviews (`ReferenceError: SCROLL_STEP is not defined`).
- Long reviews are fully expanded again. Google now removes the "More" button once clicked, which made every second review stay cut off at ~240 characters. If a review still cannot be expanded, the scrape warns how many reviews are affected.
- `revcli auth status` reports an expired Google session as not signed in (exit code 1) instead of signed in, also when Google Maps is shown in another language.
- `revcli auth` with an expired session now waits for you to sign in and closes on its own once it detects the sign-in.
- `revcli scrape --headless` on a limited view fails once, without retries or a stack trace, and tells you to run `revcli auth` – for every sort order. Headed mode asks you to sign in and continues.
- A link that opens a Google Maps search results page instead of a place fails once with a clear message. The broken batch example link in the README was replaced.
- Short links (`maps.app.goo.gl/...`) are now always loaded in English. Google redirects them inside the page, so the English setting was lost and a signed-out profile got a localized page the scraper could not read. The tracking parameters that trigger Google's limited view (`entry`, `g_ep`) are also removed from the page the link lands on.
- Errors from any command are printed as a single message without a stack trace (use `--verbose` for details). Batch failure lines no longer include Playwright's internal call log.
- `revcli batch` finishes long lists again. A place that runs past `--location-timeout` is now really stopped and its browser closed before the next place starts, so the places after it no longer fail on the shared profile. A late result from a stopped place is never saved. If a stopped browser does not close within 15 seconds, the batch stops with exit code 1 and tells you to run again with `--resume`. In headed mode, time spent signing in counts against the timeout.
- `kill <pid>` (SIGTERM) and closing the terminal (SIGHUP) now close the browser and end revcli within a few seconds, with exit code 143 / 129 (Ctrl+C: 130). Before, revcli kept running and only `kill -9` stopped it.
- Places with thousands of reviews no longer slow down as the list grows. Each cycle used to read every review card on the page again; now it reads only the cards not collected yet. Nothing that was collected before is skipped.
- Output files are written to a temporary file and renamed, so a stopped run never leaves a half-written file.

### Added
- `revcli scrape --time-limit <minutes>` stops collecting after the given time and saves the reviews collected so far, with a warning that the result is partial.

### Changed
- The test suite now runs the in-page scroll, expand, session and navigation code in headless Chromium against local fixtures. CI installs Chromium for it; locally `npm test` needs `npx playwright install chromium` once.

## [0.1.5] - 2026-09-18

### Fixed
- `revcli auth` no longer shuts the browser down as soon as Google Maps renders. It used to exit
  immediately whenever the profile already held a signed-in session, which made it impossible to
  sign in or switch accounts. The window now stays open – for credential entry, or for account
  switching when a session already exists – and closes when sign-in is detected or when you close
  it. The 5-minute timeout also reports a message instead of an unhandled-rejection stack trace.

## [0.1.4] - 2026-09-18

### Changed
- Releases are now published by the `Release` GitHub Actions workflow through npm trusted
  publishing (OIDC), and carry a SLSA provenance attestation.
- A release is gated on a green CI run for the exact commit on `main`, and on a human
  approval of the `production` environment.
- Version bumps land on `main` as a PR before the publish, so the `vX.Y.Z` tag, `main`'s
  manifest and the registry always agree.

## [0.1.3] - 2026-09-18

### Added
- First public release to npm as `@qodeca/revcli`.

[Unreleased]: https://github.com/qodeca/revcli/compare/v0.1.5...HEAD
[0.1.5]: https://github.com/qodeca/revcli/releases/tag/v0.1.5
[0.1.4]: https://github.com/qodeca/revcli/releases/tag/v0.1.4
[0.1.3]: https://github.com/qodeca/revcli/releases/tag/v0.1.3
