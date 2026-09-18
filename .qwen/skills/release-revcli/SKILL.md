---
name: release-revcli
description: Publish a new version of the revcli npm package (@qodeca/revcli) — cut a release, ship a version, run the release pipeline. Use only when the user wants a release of this package produced now; not for dependency bumps or merging feature branches.
hooks:
  PreToolUse:
    - matcher: run_shell_command
      hooks:
        - type: command
          command: '"$QWEN_SKILL_ROOT/scripts/gate.sh"'
---

# Releasing revcli

The repo's release runbook is **`../../../docs/releasing.md`** — at the repository root, not
inside this skill directory. It is authoritative: this skill gives you the shape and the
rules, the runbook has the exact commands, the verification, and the recovery table.

## First: is this a release, or a question?

**If the user is asking *about* releasing** — how the process works, what version is live, why
a release failed, what is configured — answer from `../../../docs/releasing.md` and **stop**. Do
not dispatch anything: a dispatch is a real action against a live pipeline.

Continue only when the user wants a release produced now.

## Ask before acting

A release changes shared state. Before step 1, tell the user the current version and the
target version you intend, and get an explicit go-ahead. Never merge a PR or dispatch a
workflow the user has not agreed to.

## The shape of a release

Two dispatches with a PR merge between them. **Step 1 publishes nothing** — it only opens a
PR. Each step in full is in `../../../docs/releasing.md` §"The release, step by step".

1. **Prepare** — dispatch `bump=patch|minor|major`. Opens a `release/vX.Y.Z` PR.
2. **Merge** that PR, after adding the CHANGELOG entry to it.
3. **Wait** for CI to go green on the new `main` HEAD — the gate requires it.
4. **Publish** — dispatch `bump=existing`.
5. **The environment gate.** The run stops until a human approves the `production`
   deployment. Give the user the run link and **wait**. Do not approve it yourself.
6. **Verify** — the runbook's verification block.

Always pass `-f bump=` explicitly. The input has a default, and omitting the flag does not do
what you want.

## Pre-flight

Run the checklist in `../../../docs/releasing.md` §Pre-flight checklist and stop on any failure.
Two of its items are hard stops, because they decide whether the human gate exists at all:

- **If `production` has no reviewer, stop and report.** Dispatching `existing` then publishes
  with no approval — the gate you are about to promise the user does not exist.
- **If the browser is not signed in as the package owner**, say so before step 5: the approval
  and any 2FA repair will need it.

Do not work around either one. Report and wait.

## Hard rules

- **Never clear the environment gate yourself.** Not in the UI, not via `pending_deployments`.
  Present the run link and wait. Approve only if the user explicitly asks you to, and say so
  in the transcript.
- **Never re-dispatch a version that is already published.** Versions are immutable.
- **Never `npm unpublish`.** Publish the fix as a new patch.
- **Never dispatch `bump=existing` to test the pipeline** — that mode publishes.
  `patch`/`minor`/`major` only open a PR.
- **Never publish from a laptop.** `scripts/release.mjs` refuses outside GitHub Actions
  unless `--bootstrap` is passed, and that is for the one-time first publish only.
- **Merge only the `release/vX.Y.Z` PR the prepare job opened**, and only when asked.

A `PreToolUse` hook enforces the first and third rules mechanically: a `run_shell_command`
that touches `pending_deployments` or `unpublish` is denied unless `REVCLI_GATE_APPROVED=1`
is set. (It registers only in a trusted folder — treat it as a backstop, not the rule.)

## When something goes wrong

Read `../../../docs/releasing.md`: the symptom → cause → fix table, and the `script -q /dev/null`
trick for npm operations that need 2FA.

Two rules resolve most incidents:

1. Key every decision on **whether the registry changed**, not on whether the job went red.
2. A published version with **no tag** means: do not re-run — create the Release by hand.
