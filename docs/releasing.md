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

Expected: a run where `Gate` ✅, `Prepare version bump` ✅, `Publish` ⏭ skipped.

> The bump PR shows **no CI checks** (`gh pr checks <n>` → "no checks reported"). That is
> expected — the workflow opens it with `GITHUB_TOKEN` and GitHub does not trigger workflows
> for token-created events. The gate verifies CI on the *merge commit* instead.

### 2. Merge the bump PR

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

Expected: `Gate` ✅ → `Publish the version on main` **⏳ waiting** (the environment gate).

### 5. Approving the gate

The run sits at the `production` environment until a reviewer approves. Either:

**In the UI** — open the run, click **Review deployments** → **Approve**:

```
https://github.com/qodeca/revcli/actions/runs/<RUN_ID>
```

**Or via the API** (what the UI does underneath):

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

### 6. Verifying a release

```bash
V=0.1.4   # the version you released

# authoritative and immediately consistent — use this if `npm view` lags
curl -s "https://registry.npmjs.org/@qodeca%2Frevcli/$V" | node -e "
  let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const d=JSON.parse(s);
  console.log('version:',d.version,'| license:',d.license,'| files:',d.dist.fileCount);
  console.log('provenance:',!!(d.dist.attestations&&d.dist.attestations.provenance));})"

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

**Alternative:** pass the code directly. `npm_config_otp` works as an environment variable
(verify with `npm_config_otp=123456 npm config get otp`), but the code must survive the build
and packaging gates (~20 s) before the publish step:

```bash
npm_config_otp=<6-digit> node scripts/release.mjs existing --bootstrap
```

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
   exists:

   ```bash
   gh release create vX.Y.Z --target <released-commit-sha> --title "vX.Y.Z" --notes-file <notes>
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
| `npm error ENEEDAUTH` at publish | A stray `_authToken` made npm skip the OIDC exchange | Confirm `setup-node` has no `registry-url` |
| `cannot publish over the previously published versions` | Version already on the registry | Versions are immutable. Prepare the next patch; never re-dispatch |
| Release published but no tag/Release | A step failed after the publish | Do **not** re-run; `gh release create` by hand at the released commit |
| `latest` points at the wrong version | — | `npm dist-tag add @qodeca/revcli@<good> latest` |
| A release run is queued behind another | Concurrency is a depth-1 queue; a third run cancels the pending one | Cancel any running/queued Release run, then re-dispatch |

### The registry is eventually consistent

For roughly two minutes after a publish, the **packument** (`GET /@qodeca%2Frevcli`) can 404
while the **version endpoint** (`/@qodeca%2Frevcli/<version>`) and the **tarball** already
return 200. `npm install` and `npm view` read the packument, so both fail during the window.
`release.mjs` polls through it (12 × 10 s) before reporting failure. If you are checking by
hand, the version endpoint and the tarball are authoritative.

---

## Do not

- **Do not re-dispatch a version that is already published.** Versions are immutable.
- **Do not `npm unpublish` to retry.** Publish the fix as a new patch.
- **Do not verify the pipeline by dispatching.** A dispatch publishes. Read
  `origin/main:.github/workflows/release.yml` and check the CI run instead.
- **Do not add `registry-url` to `setup-node`** in the publish job — it writes an
  `_authToken` and npm then skips the OIDC exchange.
- **Do not pass `--tag latest`** to `npm publish` — npm's "higher version already published"
  guard only applies when the tag is *default*.
- **Do not put `${{ }}` in a `run:` block** — pass values through `env:` and quote them.
- **Do not publish from a laptop.** `release.mjs` refuses without OIDC unless `--bootstrap`
  is passed, deliberately.
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
