# Publishing revcli to npm

revcli is published to npm as the scoped package **`@qodeca/revcli`**, only from `main`, and
only through the `Release` GitHub Actions workflow.

The first publish is the one exception: trusted publishing cannot perform a package's first
publish, because npm has nowhere to attach a publisher until the package exists. That
bootstrap is a documented, one-time, manual step.

## Release procedure

A release is two dispatches, separated by a PR merge:

1. **Prepare** — dispatch the `Release` workflow with `bump = patch | minor | major`. It
   stamps the new version into `package.json` and `package-lock.json`, opens a
   `release/vX.Y.Z` PR, and **publishes nothing**.
2. **Merge** that PR into `main`.
3. **Publish** — dispatch the `Release` workflow with `bump = existing`. It builds, runs the
   tarball and packaged-install gates, publishes, tags `vX.Y.Z`, and creates the GitHub
   Release.

Splitting it this way is what keeps the version on npm equal to the version committed on
`main`: the `vX.Y.Z` tag, `main`'s manifest and the registry all agree, and `latest` cannot
move backwards.

### Preconditions the workflow enforces

Both are checked by the `gate` job, which runs **before** the human approval:

- the dispatch is from `main` — a dispatch from any other branch fails loudly;
- the **newest CI run for the dispatched commit on `main`** is a completed `success`. A run
  that is still going, a run on another branch, and a newer failing run all fail the gate.

## One-time bootstrap

Order matters — bind and verify the publisher **before** restricting tokens, so the token
path stays available until the OIDC path is proven.

1. The `qodeca` npm org must exist with 2FA enabled.
2. From a clean `main` checkout, run the bootstrap publish **under a pseudo-TTY**. It refuses
   to run unless `HEAD` matches `origin/main` and the tree is clean, and it never uses OIDC,
   so the version it ships carries **no provenance attestation** — expected for this one
   release.

   ```bash
   git checkout main && git pull
   script -q /dev/null node scripts/release.mjs existing --bootstrap
   ```

   **The `script` wrapper is not optional.** A 2FA-protected account makes `npm publish` fail
   with `EOTP`, and npm opens its browser web-auth flow **only when stdout is a TTY**. Without
   it npm errors immediately and prints an auth URL you cannot use. With it, npm prints:

   ```
   Authenticate your account at:
   https://www.npmjs.com/auth/cli/<uuid>
   ```

   and polls. Open that URL in a browser signed in as the package owner and approve the
   security-key prompt; npm publishes on its own. The URL is redacted in captured output and
   npm rotates its debug logs quickly — read it from the live terminal.

   The script refuses to publish a version the registry already holds, or one that is not
   greater than the published `latest`.

3. Bind the trusted publisher (see below) and **prove it** with a real dispatch before
   relying on it.
4. Set the package to **"Require two-factor authentication and disallow tokens"**
   (Settings → Publishing access).
5. Revoke the bootstrap credential locally — `npm logout` and delete any token created for
   it — so a token path no longer exists alongside OIDC.
6. Verify the next release is published by the workflow and that the registry shows a
   provenance attestation for it.

### First-publish notes

Two things behave differently from later releases:

- **The registry is briefly inconsistent.** For roughly two minutes after a first publish the
  **packument** (`GET /@qodeca%2Frevcli`) 404s while the **version endpoint**
  (`/@qodeca%2Frevcli/0.1.3`) and the **tarball** return 200. `npm install` and `npm view`
  read the packument, so both fail during that window even though the package exists. Check
  the version endpoint, the tarball, or the npmjs.com page before concluding a publish failed.
- **The post-publish check polls through the lag.** `release.mjs` verifies `latest` by
  retrying `dist-tags` for up to ~2 minutes, so it does not report a false failure on a
  publish that succeeded. If it does still fail, its message says the publish may have
  succeeded — check the registry by hand before re-dispatching.

The bootstrap also creates **no tag and no GitHub Release** — it is a local publish, not the
workflow. Create them by hand at the released commit.

## Trusted publishing

Configure at <https://www.npmjs.com/package/@qodeca/revcli/access> under **Trusted Publisher**,
or with the CLI (npm ≥ 11.15.0), which is auditable afterwards with `npm trust list`:

```bash
npm trust github @qodeca/revcli --file release.yml --env production --allow-publish
```

| Field | Value |
|---|---|
| Organization or user | `qodeca` |
| Repository | `revcli` |
| Workflow filename | `release.yml` |
| Environment name | `production` |
| Allowed actions | **Allow `npm publish`** |

- **Tick "Allow npm publish".** It is off by default; without it the publish fails with a 404
  that names the package as if it didn't exist.
- The publisher is bound to owner + repository + **workflow filename** + environment — a
  branch or ref is **not** part of the binding. Any future publish variant must therefore stay
  in `release.yml`; moving it into `ci.yml` or a reusable workflow changes the identity npm
  validates and breaks the publish.
- Fields are **fixed once created** — a typo means deleting and re-adding the publisher.
  Renaming `release.yml` breaks publishing. npm does not validate the form when you save it,
  so errors appear only at publish time.
- `repository.url` in `package.json` must exactly match `owner/repo` (case-sensitive) or npm
  rejects the publish.

### Preconditions

- The `production` GitHub environment must exist with a **required reviewer** and a
  `main`-only deployment branch policy. GitHub creates the environment on first use
  **without reviewers**, so the human gate is silently absent until this is set — and npm
  keeps accepting the OIDC identity after the reviewer is lost. See
  <https://github.com/qodeca/revcli/settings/environments>.
- The runner needs **Node ≥ 22.14.0 and npm ≥ 11.5.1**. The workflow uses `lts/*` and
  **checks** the npm version, because a Node-22.14 runner satisfies the Node floor while
  shipping npm 10.x.
- The publish job runs `npm ci --ignore-scripts`, so no dependency lifecycle script runs
  while the job holds `id-token: write`.

## Recovery

Published versions are immutable — never republish the same version, never `npm unpublish`
to retry. Key every decision on **whether the registry changed**, not on whether the job
went red:

```bash
npm view @qodeca/revcli versions --json
npm view @qodeca/revcli dist-tags --json
```

| State | Do this |
|---|---|
| Failed **before** the publish step | Fix the cause and re-dispatch. Nothing reached the registry. |
| `release.mjs` post-publish check failed, but the tarball is live | Registry lag — the publish **succeeded**. Do not re-dispatch; create the tag/Release by hand. |
| `npm view` 404s but the npmjs.com page shows the version | Packument cache lag. The version endpoint and tarball are authoritative; wait ~2 minutes. |
| Gate failed: "still running" | Wait for CI to finish, then re-dispatch. |
| Gate failed: "concluded failure" | Fix CI on `main` first; the gate will not pass for that commit. |
| Gate failed: "no CI run found" | The commit has no CI run on `main` (e.g. a `[skip ci]` merge). Push a new commit and release that. |
| **Published, but no tag / no GitHub Release** | Do **not** re-run. Create the Release by hand at the released commit. |
| **Published, and the version is wrong** | Publish the fix as a new patch (prepare → merge → publish); optionally `npm deprecate` the bad one. |
| `npm error 404` at publish | npm rejected the identity — the trusted publisher is absent, mismatched, or lacks "Allow npm publish". Check owner/repo/workflow-filename/environment and `id-token: write`. |
| `npm error ENEEDAUTH` at publish | The OIDC exchange was skipped — usually a stray `_authToken` in the npm userconfig. Confirm `setup-node` has no `registry-url`. |
| `latest` points wrong | `npm dist-tag add @qodeca/revcli@<good> latest`. |
| Version-bump PR exists but is unmerged | Merge it; a `patch` dispatch computes from `main`'s manifest and will refuse a version that is not ahead of `latest`. |
| A Release run is queued behind another | The concurrency group is a depth-1 queue, so a third run cancels the pending one. Cancel any running or queued Release run before re-dispatching. |
