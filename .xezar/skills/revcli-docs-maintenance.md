---
name: revcli-docs-maintenance
description: Keep revcli's documentation true to the code — README, AGENTS.md, docs/selector-maintenance.md, specs; commands, selectors and invariants verified against the repo.
---

# Documentation maintenance in revcli

Docs here are operative: agents and users run what they say. A wrong command in a document is a defect.

## What lives where

- `README.md` — user-facing: install, `revcli scrape|batch|validate|auth`, every flag, output formats and examples, the Chromium prerequisite (`npx playwright install chromium`), the headed-by-default behaviour and the Google sign-in flow.
- `AGENTS.md` — the agent contract: commands block, architecture tree, "Key data flow", "Patterns to know", conventions. It is the file every task reads first, so a change to structure, invariants or verification is incomplete until this file matches.
- `docs/selector-maintenance.md` — the selector tables and the update procedure; it must agree with `src/scraper/selectors.ts` field by field.
- `docs/specs/YYYY-MM-DD-<title>.md` — feature specs (see `revcli-planning-spec`).

## Rules

- **Every command in a document must exist in `package.json` scripts** (`dev`, `build`, `test`, `test:watch`, `typecheck`) or be a real `npx` invocation. Run `npm run <script> -- --help` on the touched command to confirm flags, defaults and spelling; never document a flag from memory.
- Wrap example URLs in **single quotes** — Google Maps URLs contain `!`, which zsh/bash expand as history.
- Test count and file list in `AGENTS.md` only change when you have counted: `ls tests/*.test.ts | wc -l` and the `npm test` summary.
- Version numbers come from `package.json`; the CLI reads it at runtime. Do not hand-copy a version into prose unless the task is a release.
- Preserve guidance that already exists and is still true. Extend or correct; do not rewrite the architecture or conventions wholesale, and never replace this repo's agent policy (open-source clients with local models only) with another agent's setup.
- Selector tables change together with `src/scraper/selectors.ts`, in the same change, and say which fallback caught what.
- Keep the honest boundary in prose: what the automated suite proves (pure functions, offline) versus what only a signed-in live scrape proves.

## Verify

Read your own diff and re-check every path, flag and command it mentions against the tree. Then `npm run typecheck` and `npm test` to prove nothing else moved. Markdown links: confirm each relative target resolves (`ls` the path). Report commands you verified and any statement you could not check.
