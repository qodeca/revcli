---
name: release-revcli
description: Cut and publish a release of the revcli npm package (@qodeca/revcli). Use when asked to release, publish, ship, or bump revcli — "cut a release", "publish to npm", "release a new version", "bump the version", "ship 0.2.0".
---

# Releasing revcli

Cut a release of `@qodeca/revcli`.

The authoritative procedure, recovery table and troubleshooting live in the repo's runbook
at **`docs/releasing.md`**. Follow the happy path below; if anything deviates, read the
runbook before improvising.

## Before you start

Confirm all four, and stop and report if any fails:

1. On `main`, clean tree, up to date:
   `git checkout main && git pull --ff-only`
2. CI green on `main`'s HEAD: `gh run list --workflow ci.yml --branch main --limit 1`
3. License still MIT: `git show origin/main:package.json | grep license`
4. No version-bump PR already open: `gh pr list --state open`

## The release is two dispatches and a merge

Never try to publish straight from a bump. Step 1 publishes nothing.

### 1. Prepare the bump

```bash
gh workflow run release.yml --ref main -f bump=patch    # or minor | major
```

Then watch it: `gh run list --workflow release.yml --limit 1`.
Expect `Gate` ✅, `Prepare version bump` ✅, `Publish` ⏭ skipped. It opens a
`release/vX.Y.Z` PR.

> That PR shows **no CI checks**. That is expected — the workflow opens it with
> `GITHUB_TOKEN`, and GitHub does not trigger workflows for token-created events.

### 2. Merge the bump PR

```bash
gh pr list --state open
gh pr merge <N> --squash
```

### 3. Wait for CI on the merge commit

```bash
gh run list --workflow ci.yml --branch main --limit 1
```

The gate requires the **newest CI run for the dispatched commit on `main`** to have
concluded `success`. Dispatching before that fails with "still in_progress".

### 4. Publish

```bash
gh workflow run release.yml --ref main -f bump=existing
```

### 5. Get past the environment gate

The run stops at the `production` environment until a reviewer approves.

**This is a human gate — tell the user and let them approve.** Do not clear it on their
behalf unless they explicitly ask. Give them the run link:

```
https://github.com/qodeca/revcli/actions/runs/<RUN_ID>
```

Only if they ask you to approve it:

```bash
RUN=<RUN_ID>
IDS=$(gh api /repos/qodeca/revcli/actions/runs/$RUN/pending_deployments --jq '[.[].environment.id]')
printf '{"environment_ids":%s,"state":"approved","comment":"release"}' "$IDS" \
  | gh api -X POST /repos/qodeca/revcli/actions/runs/$RUN/pending_deployments --input -
```

### 6. Verify

```bash
V=<version>

# authoritative immediately after a publish — the packument can lag ~2 minutes
curl -s "https://registry.npmjs.org/@qodeca%2Frevcli/$V" -o /tmp/v.json
node -e "const d=require('/tmp/v.json');console.log(d.version,d.license,d.dist.fileCount,!!d.dist.attestations?.provenance)"

npm view @qodeca/revcli dist-tags
gh release view v$V --json tagName,targetCommitish,url
```

A workflow-published release **must** report provenance `true`.

## Never

- Never re-dispatch a version that is already published — versions are immutable.
- Never `npm unpublish` to retry. Publish the fix as a new patch.
- Never verify the pipeline by dispatching — a dispatch publishes.
- Never publish from a laptop; `scripts/release.mjs` refuses without OIDC unless
  `--bootstrap` is passed (the one-time first publish only).
- Never add `registry-url` to `setup-node`, and never pass `--tag latest`.
- Never approve the environment gate without the user's say-so.

## When something goes wrong

Read **`docs/releasing.md`** — it has the symptom → cause → fix table (2FA `EOTP`, registry
lag, gate failures, a published release with no tag, `latest` pointing wrong) and the
`script -q /dev/null` trick for npm operations that need 2FA.

Two rules that resolve most incidents:

1. **Key every decision on whether the registry changed, not on whether the job went red.**
2. **A published version with no tag means: do not re-run — create the Release by hand.**
