---
name: revcli-quality-gates
description: revcli's canonical verification — which commands prove the repo healthy, what is out of scope for a gate, and what must never be reported as passing.
---

# Canonical verification for revcli

revcli has no CI workflow and no lint script. The evidence that this repository is healthy is three npm scripts, in this order:

1. `npm run typecheck` — `tsc --noEmit`, strict TypeScript, zero `any` allowed.
2. `npm test` — `vitest run`, the pure-function suite (15 files: parser, schema, url, csv, json, retry, rate-limiter, consent, unrecoverable, batch-utils, validate, scroller, storage-types, scrape-location, extractor-selectors).
3. `npm run build` — `tsup`, ESM bundle with shebang into `dist/`; it is what an installed `revcli` actually runs.

Focused runs while working: `npx vitest run tests/parser.test.ts` (or any single file), `npm run test:watch` for iteration. Run the focused file for the code you touched; run all three gates before you call work done.

The whole gate is browser-free. Playwright is imported by the scraper modules, which are deliberately not unit tested, so nothing above needs Chromium or a Google session.

## Never a gate, never a pass

- **Live scraping is not a gate.** `npm run dev -- scrape '<url>'` needs the persistent profile in `~/.revcli/chrome-profile/`, network access to google.com and — for the EEA limited view — a signed-in Google account (`npm run dev -- auth`, headed). It can fail or be throttled for reasons that are not a defect in this task's change. Report it as *unavailable* or *not run*, with the reason; never as passed, and never as proof of a bug.
- `npx playwright install chromium` is a one-time environment prerequisite, not a project check.
- A step that did not run a command did not verify anything. Missing, skipped and unavailable are three honest words.

## Rules that keep the gate meaningful

- Do not weaken a check to get green: no `.skip`/`.only`, no deleted or relaxed assertions, no lowered thresholds, no `as any`/`@ts-ignore`, no `try/catch` that swallows a failure, no narrowing a schema to fit new output.
- **Prove a regression test fails without the fix**: `git stash push -- <source files>`, run the new test, confirm it is red, `git stash pop`. A test that passes both ways pins nothing.
- Distinguish an environmental failure (missing dependency, absent browser, no network) from a product failure, and say which one you observed.
- Prefer `UnrecoverableError` with a `kind` over a magic-substring `Error`; a test that pins an unrecoverable classification is how a cross-contamination guard stays alive.
- Gate-repair budget: at most two repair attempts for the *same* failure. After that, stop and report the failure with its command, output and your hypothesis. Genuinely new scope is a new task, not a relabelled one.
- Own only this task's worktree and branch. Never read-modify a peer task's checkout or the primary checkout to make a check pass.
- **Never kill a process by command-line pattern.** `pkill -f`, `killall` and `kill $(pgrep -f …)` match every process this user owns, and Xezar passes each agent its whole skill text as one argument — so a pattern taken from this file matches every peer agent running this skill. Kill your own children with `pkill -P $$`, or save the PID and kill that.

## Report shape

For every gate say: command, revision (commit) it ran on, outcome, and for a failure the first lines of the real output. Then name what remains unverified — usually a live scrape path. An agent ending "done" does not certify the result; these commands do, or the gap stays visible.
