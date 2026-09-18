---
name: revcli-planning-spec
description: Write a right-sized spec for a revcli change before building it — problem, criteria with IDs, design against the real module map, risks, tests.
---

# Specifying work in revcli

Write the spec before substantial work, sized to the change. Specs go in `docs/specs/` as `YYYY-MM-DD-<kebab-case-title>.md`, the path `.xezar/pipeline/config.json` points at (`paths.specs`) — the directory is created by the first spec written. A one-line flag tweak needs no spec; say so and stop rather than manufacturing one.

## What goes in it

1. **Problem and outcome** — who is affected and what is different afterwards. Name the command and flags involved (`scrape`, `batch`, `validate`, `auth`).
2. **Acceptance criteria with stable IDs** (`AC-1`, `AC-2`, …) — each one checkable by a named command or an inspection. A criterion that no command and no reader can check is not a criterion.
3. **Design against the real map** — which module in `AGENTS.md`'s tree changes and why, e.g.:
   - new CLI flag → `src/index.ts` → command wrapper in `src/commands/*` → `scrapeLocation()` options → `src/core/schema.ts` type;
   - new output field → Zod schema first, then `assembleScrapeResult()`, then `src/output/json.ts` **and** `src/output/csv.ts` (both formats, or the split is stated), plus the validation command's schema;
   - extraction change → `src/scraper/selectors.ts` + the extractor, with the pure parse pulled out Node-side;
   - resilience → `src/core/retry.ts` / `errors.ts` and the `kind` discriminators.
4. **Alternatives considered**, briefly, with the reason each was dropped.
5. **Risks and non-goals.** In this repo say out loud whether the change touches: the output contract (breaking for consumers), anti-bot behaviour or the persistent profile, auth and the EEA limited view, rate limiting, or anything that could leak reviewer PII into logs.
6. **Test plan** — which `tests/*.test.ts` files gain cases, which pure helper gets extracted to make the logic testable, and what can only be proven by a live signed-in scrape (declared as owner-verified, never as covered).
7. **Rollout** — docs to update (`README.md`, `AGENTS.md`, `docs/selector-maintenance.md`), and whether a version bump is part of the work (only when a release is asked for).

## Rules

- Do not write code while specifying; do not open a branch's PR from here. The spec is the deliverable.
- Prefer extracting a pure, testable helper as the design's centre of gravity — it is this repo's established shape.
- Do not invent commands, files or dependencies: cite paths that exist, and mark what does not yet exist as new.
- Verification of the spec itself is documentary: `npm run typecheck` and `npm test` prove the untouched repo is still green; the spec's real check is a reader confirming every criterion is decidable.
