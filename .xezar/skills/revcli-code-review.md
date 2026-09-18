---
name: revcli-code-review
description: Read-only review of a revcli diff or pull request against this repo's architecture and conventions. Changes nothing.
---

# Reviewing code in revcli

You are a reviewer. **Read-only**: change no file, commit nothing, push nothing, post nothing unless this task explicitly authorizes it — findings go in your report, and posting them to GitHub is the owner's call. Inspect a pull request head with `gh pr view/diff <n>` or `git diff <base>...<head>`; if you check a head out, that is a detached HEAD in your own worktree and you leave it as you found it.

## What to check, in this repo

1. **Contract integrity.** New shapes come from Zod in `src/core/schema.ts` with `z.infer<>`; no hand-written duplicate interface; `SortOrder`/`OutputFormat` extended through the constants, not by a new string literal.
2. **Boundaries.** `page.evaluate()` returns raw DOM strings and small payloads; parsing, validation and language detection happen on the Node side. Logic that decides something lives in an exported pure helper, not inline in browser code.
3. **Selectors.** Only in `src/scraper/selectors.ts`, with the fallbacks scoped by chained locators. A concatenated selector list (`` `${reviewCard} ${expandButton}` ``) is a blocker: the comma escapes the parent scope. `:has-text()` matched against reviewer-visible text is a blocker — reviewer names collide with UI words (the `ALMORET` incident); use the `jsaction` route.
4. **Failure semantics.** Anything that must not be retried throws `UnrecoverableError` with a `kind`; a magic-substring `Error` where a typed one belongs is a finding. Look for `catch` blocks that hide an unrecoverable error from `isUnrecoverable()`.
5. **Invariants.** `business.totalReviews === reviews.length` after `assembleScrapeResult()`; `headerTotalReviews` preserved; `--max-reviews` capping correctly; per-review `rating: 0` sentinel vs business-level `null`; cookies preserved by state eviction, and `VOLATILE_STORAGE_TYPES` not widened to include them.
6. **Data safety.** CSV formula-injection protection intact; PII-scrubbed debug logs stay scrubbed; no reviewer names or review text in logs; no secret or `.env` content anywhere.
7. **Shell and output.** Example URLs single-quoted in docs; every output format handled through `writeOutput()`; `--output` to stdout vs file unchanged unless the diff says otherwise.
8. **Tests.** The change is covered by a test that would fail without it; no weakened assertion, `.skip`, `.only`, or an assertion that can pass by matching nothing. Live scraping never entered the suite.
9. **Scope and hygiene.** The diff matches the task — no incidental `package.json` version bump, no reformatting of untouched files, no new dependency without a reason, ESM `.js` import extensions kept, no `any`.

## Report

Per finding: severity (blocker / major / minor), file:line, what breaks and why, and the smallest correction. Separate *observed in the diff* from *assumed*. State explicitly which commands you ran (`npm run typecheck`, `npm test`) on which revision, and what you did not run — a review that executed nothing has verified nothing. Finish with one verdict: approve, approve with follow-ups, or changes requested.
