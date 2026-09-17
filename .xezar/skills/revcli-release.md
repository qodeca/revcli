---
name: revcli-release
description: Prepare a revcli release — verify version and docs consistency, audit the exact tarball npm would publish, run the full gate, and emit the manual publish checklist. Runs nothing that cannot be undone.
---

# Preparing a release in revcli

This role **prepares**; it never releases. `git tag`, `git push`, `npm publish` and any GitHub release write are the operator's manual steps — nothing in this task performs them, and the repository policy (no commit, push or publish unless the task itself authorized it) outranks any release habit. The package is not published on npm yet; whoever publishes first also decides whether the `revcli` name is the one to claim, and that is an owner decision, not a step to complete here.

## What a release consists of here

One commit on the release branch, in this order, each verified before the next:

1. **Version bump only when the task says release.** `package.json` `version` is the single source — the CLI reads it at runtime (`revcli --version` shows it), so no prose carries a version that needs hand-syncing. Semver reasoning goes in the commit message: which user-visible behaviour moved.
2. **Docs truth for the new version.** `README.md` flags and examples match `--help` of every command (`node dist/index.js <command> --help`); the test count in `README.md` and `AGENTS.md` matches a real `npm test` summary line, quoted; `AGENTS.md` invariants and the module map match the code; if `src/scraper/selectors.ts` changed since its `Last verified:` date, that date is either still honest (nothing was re-verified live — then say so) or gets bumped with the live verification that justifies it, per `revcli-selector-maintenance`.
3. **The full gate on the final revision**: `npm run typecheck`, `npm test`, `npm run build` — quoted output with exit codes, per `revcli-quality-gates`.
4. **Tarball audit** — `npm pack --dry-run` and read the file list: the published artifact is `dist/` plus `package.json` (the `files` field); confirm `dist/index.js` is present and executable-looking, nothing under `src/`, `tests/`, `.xezar/`, `.local/` or `.env*` is in it, and `bin.revcli` points at `./dist/index.js`. `prepublishOnly` runs the build, but do not rely on it — audit what is on disk after an explicit `npm run build`.
5. **The publish checklist for the operator**, as the deliverable: exact commands in order (`npm login` / `npm publish` — first publish claims the name; note that explicitly), the tag name and message, and what to put in the GitHub release notes drawn from `git log <last-tag>..HEAD`. If the npm name is still unclaimed (`npm view revcli` → 404), the checklist says plainly that publishing is irreversible for the name and the version, and that a dry run (`npm publish --dry-run`) comes first.

## Rules

- No publish, tag, push, or GitHub write — not even "harmless" draft releases. Findings and the checklist are the deliverable.
- A failing gate stops the preparation: report it; do not "fix" it by relaxing a test or schema (that is a bug-fix task, not release prep).
- Never put the owner's npm credentials or token anywhere, including into files under `.local/`.
- If the task did not name a version, do not propose one silently: report what changed since the last tag and present two or three candidate bumps with reasoning.

## Report

Revision prepared (full SHA), proposed version and semver rationale, gate table with exit codes and quoted summary lines, the `npm pack --dry-run` file list with the privacy verdict, doc-consistency verdicts (README/AGENTS.md counts and flags — checked against what you ran), and the ordered manual checklist the operator executes. Say explicitly: nothing was published, tagged or pushed.
