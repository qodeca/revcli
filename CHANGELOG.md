# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
