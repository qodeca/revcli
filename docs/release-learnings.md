# Release learnings: publishing `@qodeca/revcli`

Everything learned while taking `revcli` from "not on npm" to a published, gated release
pipeline. Written for whoever touches the release path next — human or agent.

Related: [docs/publishing.md](publishing.md) (the operational runbook),
[docs/ci-gated-release-plan.md](ci-gated-release-plan.md) (the approved design),
[docs/npm-release-plan.md](npm-release-plan.md) (the original release plan).

---

## 1. What the release pipeline ended up being

### Two workflows, one publisher

| File | Trigger | Purpose |
|---|---|---|
| `.github/workflows/ci.yml` | push to `main`/`develop`, PRs, manual | The gate. `npm ci` → typecheck → test → build → check:pack → test:package. Read-only, no credentials. |
| `.github/workflows/release.yml` | `workflow_dispatch` only | The only thing that publishes. Three jobs: `gate` → `prepare` / `publish`. |

### The two-step version model (bump-first)

A release is **two dispatches separated by a PR merge**:

1. `bump = patch | minor | major` → computes the next version, stamps `package.json` **and
   `package-lock.json`**, opens a `release/vX.Y.Z` PR. Publishes nothing.
2. Merge that PR.
3. `bump = existing` → builds, verifies, publishes the version already committed on `main`,
   tags `vX.Y.Z`, creates the GitHub Release.

Why not the simpler "stamp → publish → open a bump PR" (which is what `@qodeca/xezar` does)?
Because the stamp lives only in the workspace, so `main`'s manifest lags the registry. That
produces two real defects:

- the `vX.Y.Z` tag points at a commit whose `package.json` reads the *previous* version;
- a later `patch` dispatch computes its version from the stale manifest, and can publish a
  version **lower** than the current `latest`.

With bump-first, the version on npm is always the version committed on `main`: the tag, the
manifest and the registry agree, and `latest` can only move forward.

### The gate

`gate` runs with no `environment:` so it evaluates **before** the human approval:

- refuses any dispatch that is not `refs/heads/main` — with a failing step, not a job-level
  `if:` (a skipped job reports as a green run);
- requires the **newest** CI run for the dispatched commit **on `main`** to be a completed
  `success`.

---

## 2. The five-lens review, and what happened to each finding

A lens review (GitHub Actions correctness, security & supply chain, release integrity,
failure handling, npm trusted publishing) produced 27 findings. Dispositions:

| # | Finding | Severity | Disposition |
|---|---|---|---|
| 1 | `${{ inputs.bump }}` interpolated into `run:` in a publish-capable job | must-fix | **fixed** — `env:` indirection + shell allow-list |
| 2 | `--tag latest` defeats npm's "higher version already published" guard | must-fix | **fixed** — flag dropped, registry pre-check, post-check |
| 3 | Gate not branch-scoped (`head_sha` alone matches any branch) | should-fix | **fixed** — `branch: 'main'` + `head_branch` assertion |
| 4 | Gate unsatisfiable: `event: 'push'` only | should-fix | **fixed** — accepts `push` or `workflow_dispatch` |
| 5 | Gate accepts a stale green run when a newer run failed | should-fix | **fixed** — newest-run-wins |
| 6 | Gate misreports a still-running run as "CI never passed" | should-fix | **fixed** — distinct message + run URL |
| 7 | Environment approval requested before the gate runs | should-fix | **fixed** — separate `gate` job, `needs:` |
| 8 | Non-`main` dispatch silently no-ops (green run) | should-fix | **fixed** — loud refusal step |
| 9 | Gate inert until the workflow file is on the default branch | should-fix | **handled** — post-merge verification in the delivery steps |
| 10 | OIDC token held while untrusted dependency scripts run | should-fix | **partial** — `npm ci --ignore-scripts`, `persist-credentials: false`, no re-verify in the publish job; a full 3-job split is deferred |
| 11 | Human gate (environment reviewers) documented as optional | should-fix | **documented** as a hard precondition |
| 12 | Publish succeeds, bump-PR step fails → tag silently skipped | should-fix | **fixed** — bump-first removes the step; tag guarded with `!cancelled()` |
| 13 | Re-dispatch re-runs the publish step | should-fix | **fixed** — pre-publish registry existence check |
| 14 | `setup-node` `registry-url` short-circuits the OIDC exchange | should-fix | **fixed** — dropped |
| 15 | Tag/Release commit version ≠ published version | should-fix | **fixed** — bump-first |
| 16 | Gate guards only the OIDC path; local token publish unguarded | should-fix | **fixed** — `release.mjs` refuses unless OIDC or `--bootstrap` |
| 17 | `actions: read` unnecessary / easy to misplace | nice-to-fix | **not needed** — `contents: read` suffices |
| 18 | Concurrency `queue: single` cancels a pending release | nice-to-fix | **documented** in the recovery table |
| 19 | Summary overclaims; nothing verifies the registry | nice-to-fix | **fixed** — summary from step outcomes + post-publish check |
| 20 | `existing` bump is non-idempotent | nice-to-fix | **fixed** — pre-check + documented as one-shot |
| 21 | npm/Node floors printed but never enforced | nice-to-fix | **fixed** — npm version asserted in the job |
| 22 | No Dependabot config for SHA-pinned actions | nice-to-fix | **fixed** — `.github/dependabot.yml` |
| 23 | Bootstrap exception lacks ordered token revocation | nice-to-fix | **documented** as an ordered checklist |
| 24 | Docs/comment drift | nice-to-fix | **fixed** |
| 25 | Trusted-publishing setup gaps | nice-to-fix | **documented** |
| 26 | `workflow_id` octokit method mapping unverified | cosmetic | **defended** — the gate also filters on `run.path` / `run.name`, so a repo-scoped resolution cannot widen it |
| 27 | `ref_name` interpolated into `run:` in the bump-PR step | cosmetic | **fixed** — `env:` indirection |

---

## 3. The first release: what actually happened

The bootstrap publish is a local, manual step. The sequence was not the one the runbook
predicted, and every deviation is worth knowing.

1. **Pre-flight passed**: on `main`, clean tree, `HEAD == origin/main`, `npm whoami` →
   `marcin.obel`, npm 11.19.0, and `@qodeca/revcli` free (404).
2. `node scripts/release.mjs existing --bootstrap` ran the build and both packaging gates,
   then `npm publish` **failed with `EOTP`** — the account requires 2FA. npm printed an
   auth URL, but **redacted** in captured output, and exited immediately.
3. Re-running with `npm_config_auth_type=web` **did not help** — npm still errored at once.
   With no TTY, npm does not hold the web-auth flow open.
4. Running under a **pseudo-TTY** did work:
   ```bash
   script -q /dev/null node scripts/release.mjs existing --bootstrap
   ```
   npm then printed `Authenticate your account at: https://www.npmjs.com/auth/cli/<uuid>` and
   **polled**, waiting for approval.
5. Opening that URL in the logged-in browser redirected to `/escalate/webauthn` — a
   **security key / passkey** prompt, i.e. a physical human action. The page offers a
   "do not challenge … for the next 5 minutes" checkbox that avoids repeated prompts.
6. After the approval, npm published and printed `+ @qodeca/revcli@0.1.3`.
7. **`release.mjs` then reported failure anyway**: its post-publish check queried
   `dist-tags` immediately, got `null`, and exited 1. A false failure on a successful
   publish — see §4.3.
8. The registry **404'd the packument** (`/@qodeca%2Frevcli`) for roughly **two minutes**,
   while the **version endpoint** (`/@qodeca%2Frevcli/0.1.3`) and the **tarball** returned
   `200` immediately. During that window `npm install` failed even though the package
   existed — see §4.2.

---

## 4. Gotchas

### 4.1 npm 2FA and the CLI publish

- A 2FA-protected account makes `npm publish` fail with `EOTP` unless an OTP is supplied.
- **npm only runs its browser web-auth flow when stdout is a TTY.** In a non-interactive
  shell it errors instantly and prints a URL you cannot use. Wrap the command in a
  pseudo-TTY: `script -q /dev/null <command>` (macOS `script`; `-q` silences the banner,
  `/dev/null` discards the typescript file).
- The alternative is an OTP passed to npm. `npm_config_otp=<code>` works as an environment
  variable (verified with `npm config get otp`), but a time-based code must survive the
  build + gates (~20 s) before the publish step.
- The auth URL is **redacted** in captured tool output, and npm rotates its debug logs
  aggressively — do not count on recovering the URL from `~/.npm/_logs` afterwards.
- The web-auth page requires a **security key / passkey**, so this step cannot be
  automated end to end; a human must approve it.

### 4.2 Registry propagation after a first publish

For a brand-new scoped package, the registry is **not** immediately consistent:

| Endpoint | Right after publish | ~2 minutes later |
|---|---|---|
| `GET /@scope%2Fname` (packument) | **404** | 200 |
| `GET /@scope%2Fname/<version>` | 200 | 200 |
| `GET /@scope%2Fname/-/name-<version>.tgz` | 200 | 200 |

`npm install` and `npm view` read the **packument**, so both fail during the gap. Do not
conclude a publish failed because `npm view` 404s — check the version endpoint or the
tarball, or the npmjs.com package page.

### 4.3 The post-publish check races the registry — a real defect

`scripts/release.mjs` verifies `latest` immediately after publishing. Because of §4.2 that
check can read `null` and exit 1 **on a publish that succeeded**. This is precisely the
failure mode the review warned about (findings 12 and 19): a red job on a shipped release,
which in the workflow means the tag/Release step is skipped and `main`'s manifest falls
behind the registry.

**Fix needed:** make the post-publish check retry with backoff (poll `dist-tags` for up to
~2 minutes) before declaring failure, and treat a matching `latest` as success. Until then,
a green `Publish release` step is the only trustworthy signal that the publish completed.

### 4.4 GitHub Actions

- **`head_sha` is not branch-scoped.** `listWorkflowRuns({ head_sha })` returns runs from
  every branch; pass `branch:` too and assert `run.head_branch`.
- **A skipped job reports as a successful run.** Never gate a release with a job-level
  `if:` — fail a step instead.
- **`environment:` protection is evaluated before any step runs**, so a gate implemented as
  a step inside an environment-protected job is evaluated *after* the human approved.
  Put the gate in its own job.
- **Events triggered by the repo's own `GITHUB_TOKEN` create no workflow runs at all**, and
  a manually dispatched run has `event: workflow_dispatch`. A gate that accepts only
  `event: 'push'` can be permanently unsatisfiable for such a commit.
- **`${{ }}` in a `run:` block is shell injection** — GitHub substitutes before the shell
  parses, so quotes do not contain anything. Pass values through `env:` and quote the
  variable.
- **`npm ci --ignore-scripts` still builds.** esbuild resolves its platform binary from
  optional dependencies, so tsup works without dependency lifecycle scripts. Verified.
- **Dependabot raises no alerts for SHA-pinned actions.** Pinning to a full SHA is correct,
  but you must add `.github/dependabot.yml` to be told about updates.

### 4.5 npm trusted publishing

- Requires **npm ≥ 11.5.1 and Node ≥ 22.14.0**. These floors differ: a Node 22.14 runner
  satisfies the Node minimum while shipping npm 10.x, so assert the npm version explicitly.
- **`actions/setup-node`'s `registry-url` writes an `_authToken`** into the npm userconfig.
  npm then believes auth is configured and **skips the OIDC exchange**, failing with
  `ENEEDAUTH` or a 404 that reads like a missing package. Do not set `registry-url` when
  publishing via OIDC.
- The publisher binds **owner + repository + workflow filename + environment**. A branch or
  ref is **not** part of the binding — so a publish variant must stay in `release.yml`;
  moving it elsewhere (or into a reusable workflow) changes the identity npm validates.
- The first publish **cannot** use trusted publishing: npm needs the package to exist before
  a publisher can be attached. That is the documented bootstrap exception.
- `npm trust github <pkg> --file <workflow> --env <environment> --allow-publish` (npm
  ≥ 11.15.0) configures it from the CLI and is auditable with `npm trust list`.

### 4.6 Repository conventions discovered

- **`develop` → `main` is a merge commit** (`Merge pull request #N from qodeca/develop`).
  Feature PRs into `develop` are **squash**-merged. Match the direction: squash for
  features, merge for the trunk sync.
- **`main` is not branch-protected**, despite the `release.yml` comment assuming it is
  PR-only. Direct pushes are possible; the convention is what holds, not the setting.
- **The license diverged once.** `main` carried `fbee450 chore: relicense from MIT to
  GPL-3.0-only` while `develop` still said MIT, and `develop` had branched *before* it — so
  a plain `develop`→`main` merge would have kept GPL. The relicense was reverted (PR #8) and
  the project is **MIT**. Check `git show origin/main:package.json | grep license` before
  any release; the npm tarball ships `LICENSE` + `README.md` + `package.json`, so a
  mismatch ships the wrong license to every installer.

### 4.7 Environment quirks on this machine

- The user's npm config gates install scripts (`allowScripts`), which is why playwright's
  postinstall does not download Chromium on a plain `npm install` here. Do not read "the
  install was fast" as "no browser download would happen on CI".
- `scripts/test-package.mjs` installs the tarball with `--ignore-scripts` so CI never pulls
  a Chromium download into the smoke test (`revcli --version` never launches a browser).

---

## 5. Outstanding work

| Item | Why it matters |
|---|---|
| Retry the post-publish check (§4.3) | Otherwise the first automated release will report failure on a successful publish and skip the tag. |
| Tag + GitHub Release for `v0.1.3` | The bootstrap was a local publish, so no tag/Release was created. Create them by hand at the released commit. |
| Trusted publisher on npmjs.com | Required before the first *automated* release. |
| `production` environment + required reviewer | Without it the human gate is silently absent. |
| Prove the OIDC path with one real dispatch | The bootstrap shipped without an attestation; only a workflow publish proves the publisher is configured. |
| Consider the full 3-job split (finding 10) | The reduced form is in place; a separate verify/publish/record split would narrow the OIDC window further. |
