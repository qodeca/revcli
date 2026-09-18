---
name: revcli-dependency-maintenance
description: Update revcli's dependencies in focused batches — playwright, zod, commander, consola, typescript, tsup, tsx, vitest — verified by the full gate, with the lockfile kept honest.
---

# Dependency maintenance in revcli

Nine dependencies, one lockfile, no lockfile-drift tolerance: every update is a batch with a reason and a full gate run.

## Batches

1. **Runtime**: `playwright`, `zod`, `commander`, `consola`. Playwright goes alone — it can change browser builds, launch behaviour and anti-detection surface.
2. **Toolchain**: `typescript`, `tsup`, `tsx`, `vitest`, `@types/node`. TypeScript minor bumps go alone; strict-mode changes surface as new typecheck errors.

Survey first with `npm outdated` and `npm audit`; classify each line as patch/minor/major by semver, and list majors separately with what they could break here (Playwright browser downloads and `launchPersistentContext` options for Playwright; Zod v4-style schema/API changes for `src/core/schema.ts`; Commander option parsing for `src/index.ts`).

## Rules

- Update with `npm install <pkg>@<range>` so `package.json` **and** `package-lock.json` move together, and commit both together. Never edit the lockfile by hand and never leave it inconsistent with the manifest.
- One batch per commit, with the exact package and version in the message, so a regression is revertible in one step.
- Verify after each batch: `npm run typecheck`, `npm test`, `npm run build`, then `node dist/index.js --version` and the `--help` of the command the package touches. `npm run dev -- <command> --help` is the equivalent when you did not build.
- After a Playwright bump, say out loud that `npx playwright install chromium` must be re-run, and that a live scrape (which this task does not perform) is the only real proof the browser still launches and scrapes. Never mark a scrape path verified from unit tests.
- No new dependency to solve a problem this repo can solve in a few exported pure functions; no removal that the code still imports. If a bump requires a code change, keep the change minimal and in the module that owns the API — do not relax a Zod schema or a type to silence an upgrade.
- Never run `npm audit fix --force`, and never auto-update a package that publishes this repo (nothing here is published by CI; `prepublishOnly` builds on a manual publish only).

## Report

Per batch: package, old → new, why, gate results with exit codes, and the residual risk you could not cover offline. A green unit suite over a major Playwright bump is *necessary, not verified*: say so.
