# revcli → npm release plan (enhanced)

> **Historical — superseded.** This is the original plan and its v1 model. The design that
> shipped is [ci-gated-release-plan.md](ci-gated-release-plan.md); the procedure is
> [releasing.md](releasing.md). **Do not follow Phases B and C below** — they prescribe
> `registry-url`, `--tag latest`, and stamp-then-publish, all of which were replaced. Kept as
> the record of the original reasoning.

This plan publishes `revcli` to npmjs.org as a standard package, modeled on an
existing, proven scoped-package release process, and incorporates every actionable
finding from the multi-lens review (see [Findings addressed](#findings-addressed)).

Key decisions were resolved with common judgment (not left open):

- **D1 – Package name:** `@qodeca/revcli` (scoped). Keeps the scope tied to the org
  and reduces typosquatting risk for a ToS-sensitive tool.
  The `bin` stays `revcli`, so the CLI command is unchanged.
- **D2 – Playwright dependency:** keep `playwright` as a runtime dependency. Verified
  that `playwright@1.63.0` has **no** postinstall, so browsers are **not**
  auto-downloaded — users must run `npx playwright install chromium`.
- **D3 – Automation:** full GitHub Actions release workflow with trusted publishing
  (OIDC), no stored tokens, plus a manual first-publish bootstrap.
- **D4 – First published version:** `0.1.3` (stay pre-1.0; 287 tests pass).
- **D5 – Release branch:** merge `develop` → `main` first, then release from `main`.

> **Risk decision (must be a deliberate, documented choice):** revcli is a
> browser-impersonating scraper that masks `navigator.webdriver` and persists a live
> Google session cookie store at `~/.revcli/chrome-profile/`. Publishing it publicly
> distributes ToS-sensitive tooling and makes it a supply-chain/typosquatting target.
> Keep the Legal notice and Anti-automation note prominent in the shipped README;
> prefer the org-scoped name; do not market "no API key, no quotas" as benign.

---

## Phase 0 — Pre-flight (one-time)

1. Confirm the repo is `qodeca/revcli` and that `develop` is merged into `main` and
   green on `main` (the released revision must contain PR #6 and the latest work).
2. Confirm npm auth: `npm whoami` must return a user (currently 401). Create the
   `qodeca` org account if needed, with 2FA enabled.
3. Confirm Node/npm on the runner meet the trusted-publishing floor:
   **Node ≥ 22.14.0 and npm ≥ 11.5.1** (local: Node 24.20.0, npm 11.19.0 — OK).
4. Pre-create the `production` environment at
   `github.com/qodeca/revcli/settings/environments` **with a required reviewer**.
   A newly-created environment has no protection rules and is **non-blocking**; without
   a pre-configured reviewer the human gate is silently absent on the first release.

---

## Phase A — Code & package preparation

### A1. `package.json`

```jsonc
{
  "name": "@qodeca/revcli",
  "version": "0.1.3",
  "description": "CLI tool to scrape Google Maps location reviews using Playwright",
  "author": "Qodeca",
  "license": "MIT",
  "type": "module",
  "bin": { "revcli": "./dist/index.js" },
  "exports": {
    ".": "./dist/index.js",
    "./package.json": "./package.json"
  },
  "files": ["dist"],
  "engines": { "node": ">=22" },
  "publishConfig": { "access": "public" },
  "repository": { "type": "git", "url": "git+https://github.com/qodeca/revcli.git" },
  "homepage": "https://github.com/qodeca/revcli#readme",
  "bugs": { "url": "https://github.com/qodeca/revcli/issues" },
  "keywords": ["google-maps", "reviews", "scraper", "cli", "playwright"],
  "dependencies": {
    "commander": "^13.1.0",
    "consola": "^3.4.0",
    "playwright": "^1.63.0",
    "zod": "^3.24.0"
  }
  // scripts/devDependencies unchanged, except scripts below
}
```

- `publishConfig.access: "public"` is **required** for a scoped package (an unscoped
  package is always public, so this field is a no-op — it is correct here because D1
  chose scoped).
- `exports` adds `"./package.json"` so tooling/version lookups still work.
- Bump `playwright` floor to `^1.63.0` to match latest (caret range; low risk).
  Do **not** bump `zod` to v4 in this release — verify compatibility separately and
  note it as a follow-up.

### A2. `scripts` in `package.json`

```jsonc
"scripts": {
  "dev": "tsx src/index.ts",
  "build": "tsup",
  "test": "vitest run",
  "test:watch": "vitest",
  "typecheck": "tsc --noEmit",
  "prepack": "npm run build && node scripts/check-pack.mjs",
  "check:pack": "node scripts/check-pack.mjs",
  "release": "node scripts/release.mjs"
}
```

- Replace `prepublishOnly` with **`prepack`** so the build + tarball check run on both
  `npm pack` and `npm publish` (the manual path). In CI we publish with
  `--ignore-scripts`, so the workflow must run `build` + `check:pack` explicitly.

### A3. Fix the version-desync (the blocker)

`src/index.ts` imports `package.json` and `tsup` inlines it into `dist/index.js`
(`dist/index.js:9` contains `version: "0.1.2"`). If the version is bumped **after**
the build, the published CLI reports the wrong `--version`.

**Fix (recommended): reorder so the version is stamped before the build.** The release
script (`scripts/release.mjs`) stamps `package.json` to the new version, **then** runs
the build, **then** verifies, **then** publishes. This keeps the existing
`import pkg from "../package.json"` and makes `revcli --version` truthful.

Optional alternative (more robust, but a source change): read the version at runtime
instead of inlining, e.g.

```ts
import { readFileSync } from "node:fs";
const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
```

`new URL(...)` is computed at runtime so `tsup`/esbuild cannot inline it; package.json
is always shipped in the tarball. Use this only if you also want the version to be
immune to build ordering. (Do **not** use `createRequire("../package.json")` — esbuild
can statically resolve that and re-inline it.)

### A4. `scripts/check-pack.mjs`

A small script that runs `npm pack --dry-run` and asserts the tarball contract before
anything reaches the immutable registry:

- `dist/index.js` is present.
- `src/`, `test/`, `tests/` are **absent**.
- `package.json` `name` is `@qodeca/revcli`.
- The packed `package.json` `version` matches the manifest version.

Exit non-zero on any failure. This is the gate that would have caught a tarball that
ships `src/` or omits the bin.

### A5. Packaged-install smoke test (required, not optional)

Add a test/script that packs the real tarball, installs it into an isolated temp dir,
runs `revcli --version`, and asserts the output equals the manifest `version`. This is
the one gate that catches a version desync and a non-loadable bundle. Run it **after**
the version stamp, as a hard gate before publish.

### A6. `CHANGELOG.md` (Keep a Changelog)

```markdown
# Changelog

All notable changes to this project are documented in this file.

## [Unreleased]

## [0.1.3] - 2026-09-18

### Added
- First public release to npm.

[Unreleased]: https://github.com/qodeca/revcli/compare/v0.1.3...HEAD
[0.1.3]: https://github.com/qodeca/revcli/releases/tag/v0.1.3
```

ISO-8601 dated headers, the six standard categories, and an `Unreleased` section at top.

### A7. `README.md`

- **Installation (primary path):**
  ```bash
  npm install -g @qodeca/revcli
  npx playwright install chromium   # required once — browsers are NOT auto-downloaded
  ```
  Move the `git clone` / `npm link` / `npm run dev` content under a clearly labeled
  **"Development"** heading (it already partly lives in Contributing).
- **Prerequisites:** change "Chromium (downloaded automatically via Playwright)" to
  "Chromium (install with `npx playwright install chromium`)".
- **Dead links:** point `docs/selector-maintenance.md` and `AGENTS.md` references at
  absolute GitHub blob URLs (e.g.
  `https://github.com/qodeca/revcli/blob/main/docs/selector-maintenance.md`) so the npm
  page has no broken relative links. Do **not** ship `docs/` in the tarball just to fix
  links.
- **"Output schema changes":** reword to state the current contract plainly
  ("`business.totalReviews` equals `reviews.length`; `business.headerTotalReviews`
  preserves Google's header value") instead of "Previously… / As of this release…".
- **Test count:** drop the literal `(287)` (use `npm test # Run all tests`).
- **Badges:** use dynamic badges (e.g.
  `https://img.shields.io/github/v/release/qodeca/revcli`) instead of hardcoded
  "Playwright 1.52" / "TypeScript 5.8".

### A8. `tsup.config.ts`

Set `sourcemap: false` for the published build (or ship `src/`) so the tarball is
minimal and its maps resolve. The 151 KB `.map` is ~63% of the unpacked size and has no
source to resolve against.

---

## Phase B — First publish (bootstrap)

Trusted publishing **cannot** perform a package's first publish (npm has nowhere to
attach a publisher until the package exists). Bootstrap by hand:

1. Run the full local gate chain on the release candidate:
   `npm run typecheck && npm test && npm run build && npm run check:pack`
   and the packaged-install smoke test.
2. `npm login` (2FA-protected account).
3. `npm publish --tag latest` (no `--provenance` — it requires OIDC and will fail with a
   legacy token; the bootstrap release ships without an attestation, which is expected).
4. Verify: `npm view @qodeca/revcli version`, `npm view @qodeca/revcli dist-tags`,
   `npm install -g @qodeca/revcli@0.1.3`, `revcli --version`.

---

## Phase C — Automate

### C1. `scripts/release.mjs` (single-package)

A single-package release orchestrator that **fails loudly when it has no
credential** (it never degrades to a dry run). Order matters — this is the fix for the
version-desync blocker:

1. Parse the bump (`patch | minor | major | existing`).
2. Compute the new version from `package.json`.
3. **Stamp** `package.json` to the new version (for non-`existing` bumps).
4. **Build** (`npm run build`) so `dist/index.js` inlines the new version.
5. **Verify** (`npm run check:pack` + packaged-install smoke test, asserting
   `revcli --version` equals the manifest version).
6. **Publish** with `--tag latest --access public --ignore-scripts`
   (+ `--provenance` **only when OIDC is detected**; it is auto-generated under trusted
   publishing, so the explicit flag is redundant and could mask a non-OIDC fallback).
7. Emit `version` / `published` to `$GITHUB_OUTPUT`.

Authentication, in priority order: OIDC (`ACTIONS_ID_TOKEN_REQUEST_URL`) → `NODE_AUTH_TOKEN`
→ an `npm login` session (`npm whoami`). If none, exit non-zero with a clear message.

### C2. `.github/workflows/release.yml`

`workflow_dispatch`-only, never from a push. Publish via trusted publishing (OIDC).

```yaml
name: Release
on:
  workflow_dispatch:
    inputs:
      bump:
        description: 'Version bump (existing publishes the version already in package.json)'
        required: true
        default: patch
        type: choice
        options: [patch, minor, major, existing]

permissions:
  contents: read

concurrency:
  group: release-${{ github.ref }}
  cancel-in-progress: false

jobs:
  release:
    name: Release ${{ inputs.bump }} to npm (latest)
    runs-on: ubuntu-latest
    timeout-minutes: 30
    if: github.ref == 'refs/heads/main' || startsWith(github.ref, 'refs/heads/release/')
    environment: production
    permissions:
      contents: write
      id-token: write
      pull-requests: write
    steps:
      - uses: actions/checkout@<full-40-char-sha>   # pin to a full commit SHA, not a tag
        with: { fetch-depth: 0 }
      - uses: actions/setup-node@<full-40-char-sha>
        with:
          node-version: lts/*        # meets >=22.14.0
          registry-url: https://registry.npmjs.org
          cache: npm
          package-manager-cache: false   # trusted publishing requires a clean cache
      - run: npm ci
      - run: npm run typecheck
      - run: npm test
      - run: npm run check:pack
      - name: Publish release
        id: release
        run: node scripts/release.mjs "${{ inputs.bump }}"
      - name: Open version-bump PR (patch/minor/major only)
        if: steps.release.outputs.published == 'true' && inputs.bump != 'existing'
        # checkout -b release/v<VERSION>, commit package.json, push, gh pr create
      - name: Create GitHub Release
        if: steps.release.outputs.published == 'true'
        # create v<VERSION> tag + release at context.sha, body states the released version
```

Key hardening (from the review):

- **Pin every third-party action to a full 40-char commit SHA** (with a `# vX.Y.Z`
  comment), not a mutable tag.
- **`package-manager-cache: false`** on the publish job — the npm OIDC exchange needs a
  clean cache.
- **Narrow permissions:** top-level `contents: read`; grant `contents: write` /
  `id-token: write` / `pull-requests: write` only on the publish job.
- **Ref guard** `if: github.ref == 'refs/heads/main' || startsWith(...)` and a
  **concurrency group** so a tag dispatch or a second concurrent run cannot publish
  unexpectedly.
- The workflow does **not** store an npm token anywhere; `id-token: write` is what mints
  the OIDC identity.

### C3. Configure trusted publishing (one-time)

On <https://www.npmjs.com/package/@qodeca/revcli/access>, under **Trusted Publisher**:

| Field | Value |
|---|---|
| Organization or user | `qodeca` |
| Repository | `revcli` |
| Workflow filename | `release.yml` |
| Environment name | `production` |
| Allowed actions | tick **Allow `npm publish`** |

- **Tick "Allow npm publish".** It is off by default; without it the publish fails with a
  404 that names the package as if it didn't exist.
- Fields are **fixed once created** — a typo means deleting and re-adding the publisher,
  so check before saving. Renaming `release.yml` breaks publishing.
- After creating it, set the package to **"Require two-factor authentication and
  disallow tokens"** (Settings → Publishing access) so a leaked token cannot bypass the
  OIDC identity binding.
- **Prove it:** dispatch the workflow once and confirm it actually publishes before
  relying on it (a known failure mode is an empty publisher form silently
  accepted as "configured").

---

## Phase D — Post-release verification

```bash
npm view @qodeca/revcli version            # 0.1.3
npm view @qodeca/revcli dist-tags          # latest -> 0.1.3
npm view @qodeca/revcli repository.url     # https://github.com/qodeca/revcli
npm install -g @qodeca/revcli@0.1.3
which revcli
revcli --version                           # must print 0.1.3
revcli --help
```

- Confirm the `v0.1.3` tag points at the released commit and the GitHub Release body
  states the version.
- Merge the `release/v0.1.3` version-bump PR so `main` matches the registry (the Actions
  bot's PR CI sits at `action_required` until a maintainer approves the run).

---

## Recovery (partial failure)

Published versions are immutable — never republish the same version, never `npm unpublish`
to retry.

| State | Do this |
|---|---|
| Job failed before publish | Fix the cause, re-dispatch the same bump. |
| `npm error 404` at publish | npm rejected the identity — the trusted publisher is absent/mismatched or lacks "Allow npm publish". Check owner/repo/workflow/environment and `id-token: write`. |
| Published, no tag / no GitHub Release | Do **not** re-run; create the Release by hand at the released commit. |
| `latest` points wrong | `npm dist-tag add @qodeca/revcli@<good> latest`. |
| Published a broken build | Publish the fix as a new patch, move `latest` to it, optionally `npm deprecate`. |

Inspect the registry **before** re-dispatching: `npm view @qodeca/revcli versions --json`.

---

## Findings addressed

Lens findings folded into the plan:

| Finding (lens) | Resolution |
|---|---|
| Version inlined at build → wrong `--version` (blocker) | A3: stamp **before** build; A5: packaged-install asserts version; C1 reorders. |
| README install command contradicts manifest name (blocker) | D1 → `@qodeca/revcli`; A1 rename + A7 install path agree. |
| ToS / anti-automation public-distribution exposure | Risk decision (top of plan); scoped name; keep Legal/Anti-automation notice. |
| Publish job under-hardened (unpinned actions, npm cache) | C2: SHA-pinned actions, `package-manager-cache: false`, narrow permissions. |
| Bootstrap recorded not proven (0.10.2 trap) | C3: checklist + "Allow npm publish" tick + prove with one dispatch. |
| Packaged-install smoke test optional/weak | A5: required gate; asserts `dist/index.js` present, `src/` absent, version match. |
| Dead doc links (`docs/`, `AGENTS.md`) in tarball | A7: absolute GitHub blob URLs; don't ship `docs/` to fix links. |
| `production` reviewer silently non-blocking | Phase 0 step 4: pre-create env with required reviewer. |
| Manual bootstrap bypasses gates + no provenance | Phase B: full local gate chain; no `--provenance` on manual path. |
| Release from `main` while `develop` ahead | D5 / Phase 0 step 1: merge `develop`→`main`, confirm green. |
| README says Chromium auto-downloads | A7: correct Prerequisites + prominent `npx playwright install chromium`. |
| `publishConfig.access` no-op | Resolved by D1 (scoped → it is required). |
| Stale dep floors/badges | A1: `playwright ^1.63.0`; A7: dynamic badges; `zod` v4 left as follow-up. |
| Trusted-publishing preconditions unstated | Phase 0 step 3 / C2: Node ≥22.14.0, npm ≥11.5.1 pinned. |
| `--ignore-scripts` kills `prepublishOnly` | A2: switch to `prepack`; C1 publishes with `--ignore-scripts`. |
| No ref guard / concurrency | C2: `if` guard + `concurrency` group. |
| `exports` blocks tooling; sourcemaps w/o sources | A1: add `./package.json` export; A8: `sourcemap: false`. |
| CHANGELOG format unspecified | A6: Keep a Changelog. |
| README "output schema changes" reads as diff | A7: state current contract. |
| README leads with source-install | A7: `npm install -g` primary, source under "Development". |
| `--provenance` redundant | C1: gate on OIDC detection. |
| Hardcoded test count / static badges | A7: drop count, dynamic badges. |

---

## Open follow-ups (not blocking this release)

- Verify `zod` v4 compatibility and bump if safe.
- Consider `playwright-core` + a documented `npx playwright-core install chromium`
  step to shrink install (requires import changes; defer).
- Decide whether the anti-automation/ToS exposure warrants a scoped, lower-profile
  publication vs. fully public marketing.
