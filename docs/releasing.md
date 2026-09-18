# Releasing revcli — runbook

Everything needed to cut a release of `@qodeca/revcli`. Copy-pasteable, with the traps that
cost time the first time round.

- One-time npm/GitHub setup (org, trusted publisher, environment): [publishing.md](publishing.md)
- Why it is built this way, and the incident record: [release-learnings.md](release-learnings.md)

---

## TL;DR

A release is **two dispatches separated by a PR merge**. Swap `patch` for `minor` / `major`
as needed.

```bash
# 0. Pre-flight — CI green on main, working tree clean
git checkout main && git pull --ff-only
gh run list --workflow ci.yml --branch main --limit 1

# 1. Prepare the bump — opens release/vX.Y.Z, publishes NOTHING
gh workflow run release.yml --ref main -f bump=patch

# 2. Wait for it to finish, then merge the bump PR it opened
gh run list --workflow release.yml --limit 1
gh pr list --state open
gh pr merge <N> --squash

# 3. Wait for CI on the new main HEAD — the gate requires it green
gh run list --workflow ci.yml --branch main --limit 1

# 4. Publish the version now committed on main
gh workflow run release.yml --ref main -f bump=existing

# 5. Approve the `production` gate — see "Approving the gate" below
# 6. Verify — see "Verifying a release" below
# 7. Back-merge main into develop — see "Back-merging" below
```

---

## What is configured where

| Thing | Where | Value |
|---|---|---|
| npm package | registry.npmjs.org | `@qodeca/revcli`, public |
| npm org | npmjs.com | `qodeca` — `marcin.obel` is an owner |
| Trusted publisher | npmjs.com → package → **Settings** | repo `qodeca/revcli`, workflow `release.yml`, environment `production`, `npm publish` allowed |
| GitHub environment | repo → Settings → Environments | `production` — required reviewer `marcinobel`, branch policy `main` only |
| CI | `.github/workflows/ci.yml` | push to `main`/`develop`, PRs, manual |
| Release | `.github/workflows/release.yml` | `workflow_dispatch` only |
| Orchestrator | `scripts/release.mjs` | `patch\|minor\|major` = prepare · `existing` = publish |

---

## Pre-flight checklist

Run before every release.

- [ ] `git checkout main && git pull --ff-only` — you are on `main`, up to date, tree clean.
- [ ] CI is green on `main`'s HEAD: `gh run list --workflow ci.yml --branch main --limit 1`
- [ ] License is still MIT: `git show origin/main:package.json | grep license`
      (the tarball ships `LICENSE`, `README.md` and `package.json` — a mismatch ships the
      wrong terms to every installer).
- [ ] No unmerged version-bump PR is lingering: `gh pr list --state open`
- [ ] The `production` environment still has its reviewer:
      `gh api /repos/qodeca/revcli/environments/production --jq '[.protection_rules[]?.reviewers[]?.reviewer.login]'`
- [ ] Your browser is signed in to npmjs.com **as the package owner** (needed if the release
      asks for 2FA).

---

## The release, step by step

### 1. Prepare the bump

```bash
gh workflow run release.yml --ref main -f bump=patch
```

What happens: the `gate` job checks the ref is `main` and that the newest CI run for that
commit on `main` is a completed success; the `prepare` job stamps `package.json` **and
`package-lock.json`** and opens a `release/vX.Y.Z` PR. **Nothing is published.**

Expected job outcomes: `Gate — main, and green CI for this commit` ✓,
`Prepare version bump (patch)` ✓, `Publish the version on main` skipped (rendered `-`).

> The bump PR shows **no CI checks** (`gh pr checks <n>` → "no checks reported"). That is
> expected — the workflow opens it with `GITHUB_TOKEN` and GitHub does not trigger workflows
> for token-created events. The gate verifies CI on the *merge commit* instead.

> The `release/vX.Y.Z` branch is deleted by the **publish** run once the version it carried is
> live — the publish job removes it. A bump PR that is closed unmerged, or one whose publish
> never runs, leaves its branch behind; delete that by hand with
> `git push origin --delete release/vX.Y.Z`.
>
> The repository deliberately does **not** use GitHub's "automatically delete head branches"
> setting: the trunk sync is a `develop` → `main` PR, and that setting would delete `develop`
> on every sync.

### 2. Merge the bump PR

> **Add the CHANGELOG entry to the bump PR before merging.** `release.mjs` stamps only
> `package.json` and `package-lock.json` — the changelog is not written automatically. Push a
> commit to the `release/vX.Y.Z` branch with a `## [X.Y.Z] - <date>` section and update the
> comparison links, then merge.

```bash
gh pr list --state open          # find the chore(release): vX.Y.Z PR
gh pr merge <N> --squash
```

Confirm `main` now carries the version:

```bash
git fetch origin && git show origin/main:package.json | grep '"version"'
```

### 3. Wait for CI on the merge commit

```bash
gh run list --workflow ci.yml --branch main --limit 1
```

**Do not skip this.** The gate requires the *newest* CI run for the dispatched commit on
`main` to have concluded `success`. Dispatching too early fails with "CI for … is still
in_progress".

### 4. Publish

```bash
gh workflow run release.yml --ref main -f bump=existing
```

Expected: `Gate — main, and green CI for this commit` ✓ → `Publish the version on main`
**waiting** (the environment gate).

Get the run id and its link:

```bash
gh run list --workflow release.yml --limit 1 --json databaseId,url
```

### 5. Approving the gate

> **This approval is a human decision.** An agent must not clear this gate on its own
> initiative — present the run link and wait. The API call below exists for a human who has
> asked for it, not as a step to run unattended.

The run sits at the `production` environment until a reviewer approves. A human either:

**opens the run and clicks Review deployments → Approve:**

```
https://github.com/qodeca/revcli/actions/runs/<RUN_ID>
```

**or, having explicitly asked an agent to approve it on their behalf, uses the API** (what the
UI does underneath):

```bash
RUN=<RUN_ID>
ENV_IDS=$(gh api /repos/qodeca/revcli/actions/runs/$RUN/pending_deployments --jq '[.[].environment.id]')
printf '{"environment_ids":%s,"state":"approved","comment":"release"}' "$ENV_IDS" \
  | gh api -X POST /repos/qodeca/revcli/actions/runs/$RUN/pending_deployments --input -
```

Then watch it through:

```bash
gh run watch $RUN
```

> **If the reviewer is unavailable**, the run waits indefinitely. The fix is a **second
> required reviewer** on the `production` environment — arrange that in advance. Changing the
> environment's protection rules (see [publishing.md](publishing.md) §3) is a human-only
> configuration change: never use it to unblock an agent's own release.

### 6. Verifying a release

```bash
V=0.1.4   # the version you released

# authoritative and immediately consistent — use this if `npm view` lags
curl -s "https://registry.npmjs.org/@qodeca%2Frevcli/$V" | node -e "
  let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const d=JSON.parse(s);
  console.log('version:',d.version,'| license:',d.license,'| files:',d.dist.fileCount);
  console.log('provenance:',Boolean(d.dist.attestations&&d.dist.attestations.provenance));})"

# dist-tags (may lag a minute or two after a publish)
npm view @qodeca/revcli version dist-tags

# the GitHub Release the workflow created
gh release view v$V --json tagName,targetCommitish,url

# a real install
TMP=$(mktemp -d) && cd "$TMP" && echo '{"name":"c","version":"1.0.0","private":true}' > package.json
npm install --ignore-scripts @qodeca/revcli@$V && ./node_modules/.bin/revcli --version
cd - && rm -rf "$TMP"
```

A workflow-published release **must** show `provenance: true`. The one exception is the
one-time bootstrap (see below), which has no attestation.

### 7. Back-merging `main` into `develop`

The version-bump PR targets `main`, so `develop` never receives the version and drifts one
step behind on every release. Close the gap straight after the release:

```bash
git checkout develop && git pull --ff-only
git merge origin/main            # fast-forwards when nothing new has landed on develop
git push
```

Nothing breaks while it is out of sync — the release workflow reads `main`'s manifest, and
the next bump computes from `main` — but the drift accumulates, and a feature branched from a
stale `develop` builds the wrong version locally.

If `develop` has moved on, this is an ordinary merge: resolve it, never force it.

---

## Working with npm 2FA from the CLI

Any npm operation that publishes or changes the account needs 2FA. Without it you get:

```
npm error code EOTP
npm error This operation requires a one-time password.
npm error Open this URL in your browser to authenticate:
npm error   https://www.npmjs.com/auth/cli/***
```

Two things to know:

**npm only runs its browser web-auth flow when stdout is a TTY.** In a non-interactive shell
it errors instantly and the URL is useless. Wrap the command:

```bash
script -q /dev/null npm trust github @qodeca/revcli --file release.yml --repo qodeca/revcli --env production --allow-publish -y
```

Under the pseudo-TTY npm prints the real URL and **polls**:

```
Authenticate your account at:
https://www.npmjs.com/auth/cli/<uuid>
```

Open that URL in a browser signed in as the package owner and approve the **security-key**
prompt. npm completes on its own. The URL is **redacted** in captured tool output and npm
rotates its debug logs quickly — read it from the live terminal, or capture to a file:

```bash
tr '\r' '\n' < /tmp/publish.log | grep -a "auth/cli"
```

The npm page offers *"do not challenge npm publish, npm trust operations … for the next 5
minutes"* — tick it when you have several operations to do in a row.

**Alternative, for non-publish operations only:** `npm_config_otp` works as an environment
variable (verify with `npm_config_otp=123456 npm config get otp`). Use it for operations that
do **not** publish — `npm trust`, `npm dist-tag`, `npm deprecate`, `npm logout`. Read the code
with `read -s` so it does not land in shell history:

```bash
read -rs OTP && npm_config_otp="$OTP" npm dist-tag add @qodeca/revcli@<good> latest
```

> **Never use it to publish.** A publish that asks for an OTP means the pipeline is being
> bypassed: no CI gate, no `production` approval, no provenance, no tag. If you reach for
> this mid-release, stop and fix the pipeline instead. The only exception is the documented
> bootstrap below, which is a local publish by design.

### If the 2FA credential is lost

OIDC publishes keep working — the workflow never needs your security key. Everything that
*repairs* the package stops working, because npm gates account and dist-tag changes behind
2FA: `npm trust`, `npm dist-tag add`, `npm deprecate`, `npm logout`.

Set the recovery path up **before** you need it:

- a **second owner** on the `qodeca` npm org, and
- a **backup security key or passkey** registered on the account (npm also issues recovery
  codes when you enrol 2FA).

"Disallow bypass 2fa tokens" removes the last non-2FA route to the registry, so the backup key
is the only way back in.

---

## The one-time bootstrap (first publish of a brand-new package)

Trusted publishing **cannot** create a package — npm has nowhere to attach a publisher until
the package exists. So the very first publish is manual, from a clean `main`:

```bash
git checkout main && git pull --ff-only
script -q /dev/null node scripts/release.mjs existing --bootstrap
```

`--bootstrap` is the only way to publish without OIDC; it asserts `HEAD == origin/main` and a
clean tree, and the version it ships carries **no provenance attestation**. Afterwards:

1. Bind the trusted publisher (see [publishing.md](publishing.md)) and prove it with a real
   dispatch.
2. Create the tag and GitHub Release by hand — the bootstrap is a local publish, so neither
   exists. The sha is the commit you published from (`git rev-parse HEAD` on the clean `main`
   you ran the bootstrap on):

   ```bash
   SHA=$(git rev-parse HEAD)
   gh release create vX.Y.Z --target "$SHA" --title "vX.Y.Z" --notes-file <notes>
   git show "vX.Y.Z:package.json" | grep '"version"'   # must equal the published version
   ```

3. Set the package to **"Require two-factor authentication and disallow bypass 2fa tokens"**.
4. Revoke the bootstrap credential: `npm logout` (drops the `_authToken` from `~/.npmrc`).

---

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `EOTP` on publish / trust / logout | 2FA required | Re-run under `script -q /dev/null`, or pass `npm_config_otp` |
| Web-auth URL is `https://www.npmjs.com/auth/cli/***` | Output redacted, or no TTY | Run under a pseudo-TTY; read the URL from the live terminal |
| `release.mjs` "post-publish check failed … may have succeeded" | Registry lag (see below) | Do **not** re-dispatch — check the registry by hand, create the tag if missing |
| `npm view` 404s but the npmjs.com page shows the version | Packument cache lag (~2 min) | Query the version endpoint instead: `/@qodeca%2Frevcli/<version>` |
| Gate: "CI for … is still in_progress" | Dispatched too early | Wait for CI to finish, re-dispatch |
| Gate: "concluded 'failure'" | CI red on that commit | Fix CI on `main`; the gate will never pass for that commit |
| Gate: "No CI run found for … on main" | Commit landed with `[skip ci]`, or via `GITHUB_TOKEN` | Push a new commit and release that one |
| Publish job never starts, run shows `waiting` | `production` environment approval pending | Approve it — see "Approving the gate" |
| `npm error 404` at publish | Trusted publisher mismatched or missing "Allow npm publish" | Check owner/repo/**workflow filename**/environment on npmjs.com |
| `npm error ENEEDAUTH` at publish | No credential for the registry — the OIDC exchange produced no token (`id-token: write` missing, or the exchange failed) | Check the job has `id-token: write`; then confirm `setup-node` has no `registry-url`. A stray or literal-`${NODE_AUTH_TOKEN}` token surfaces as a 401/404 instead |
| `cannot publish over the previously published versions` | Version already on the registry | Versions are immutable. Prepare the next patch; never re-dispatch |
| Release published but no tag/Release | A step failed after the publish | Do **not** re-run. Take the sha from the publish run (`gh run view <RUN_ID> --json headSha`) and `gh release create vX.Y.Z --target <sha>`; verify `git show vX.Y.Z:package.json \| grep version` equals the published version |
| `latest` points at the wrong version | — | `npm dist-tag add @qodeca/revcli@<good> latest` |
| A release run is queued behind another | Concurrency is a depth-1 queue; a third run cancels the pending one | Cancel only **pending/queued** runs, then re-dispatch. Before cancelling a **running** run, check whether it already published (`gh run view <RUN_ID> --json headSha`, or the registry) — the tag step is `!cancelled()`-guarded, so cancelling after the publish strands an untagged version |

### The registry is eventually consistent

For roughly two minutes after a publish, the **packument** (`GET /@qodeca%2Frevcli`) can 404
while the **version endpoint** (`/@qodeca%2Frevcli/<version>`) and the **tarball** already
return 200. `npm install` and `npm view` read the packument, so both fail during the window.
`release.mjs` polls through it (12 checks, 10 s apart — about 110 s) before reporting failure. If you are checking by
hand, the version endpoint and the tarball are authoritative.

---

## Do not

- **Do not re-dispatch a version that is already published.** Versions are immutable.
- **Do not `npm unpublish` to retry.** Publish the fix as a new patch.
- **Do not dispatch `bump=existing` to test the pipeline — that mode publishes.**
  `patch`/`minor`/`major` are safe: they only open a PR. To inspect what is deployed, read
  `origin/main:.github/workflows/release.yml` and its CI run instead.
- **Do not add `registry-url` to `setup-node`** in the publish job — it writes an
  `_authToken` and npm then skips the OIDC exchange.
- **Do not pass `--tag latest`** to `npm publish` — npm's "higher version already published"
  guard only applies when the tag is *default*.
- **Do not put `${{ }}` in a `run:` block** — pass values through `env:` and quote them.
- **Do not publish from a laptop.** `release.mjs` refuses unless it is running in GitHub
  Actions or `--bootstrap` is passed. The guard is coarse — inside Actions it proceeds and
  only fails at the publish step — so it stops a laptop publish, not a misconfigured job.
- **Do not edit the trusted publisher's workflow filename** without updating npmjs.com — the
  publisher is bound to `release.yml` by name.

---

## Useful one-off commands

```bash
# What is live?
npm view @qodeca/revcli versions --json
npm view @qodeca/revcli dist-tags --json

# Inspect the last release run
gh run list --workflow release.yml --limit 5
gh run view <RUN_ID> --log | grep -a "release:"

# Did the trusted publisher land?
npm trust list @qodeca/revcli          # needs 2FA → use script -q /dev/null

# Rehearse the prepare path without writing anything
node scripts/release.mjs patch --dry-run

# Rehearse a publish (only meaningful for a version not yet on the registry)
node scripts/release.mjs existing --dry-run
```
