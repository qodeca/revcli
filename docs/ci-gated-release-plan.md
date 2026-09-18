# Plan: CI-gated npm release from `main` (v2 – enhanced after lens review)

Supersedes the v1 plan. v1 proposed only two changes (a `main`-only ref guard and a
CI-green preflight step). A five-lens review found 27 issues; this version folds the
actionable ones in.

## Goal

- **R1** – CI runs automatically on every commit to `develop`.
- **R2** – CI runs automatically on every commit to `main`.
- **R3** – npm publish happens only from `main`.
- **R4** – a release is allowed only after CI has run all its checks, and passed, for that
  exact commit.

## What changed from v1

| Area | v1 | v2 |
|---|---|---|
| Ref guard | `if: github.ref == 'refs/heads/main'` on the job | an explicit **refusal job** that fails loudly on a non-`main` dispatch (a guard that *skips* reports as a green run) |
| Gate placement | a step inside the environment-protected publish job | a **separate `gate` job** (`needs:`-ed by the publish job), so human approval happens only after the gate is green |
| Gate query | `head_sha` + `event: push` + `some(conclusion === 'success')` | branch-scoped, newest-run-wins, distinguishes "no run" from "still running" from "failed" |
| Version model | stamp in the workspace, publish, then open a bump PR | **bump first** (PR), then publish `existing` – the published version is always the one committed on `main` |
| Publish auth | `registry-url` + `--tag latest` | `registry-url` dropped (it can short-circuit OIDC), `--tag latest` dropped (it disables npm's downgrade guard) |
| Injection | `node scripts/release.mjs "${{ inputs.bump }}"` | `env:` indirection + a shell allow-list |
| Post-publish | summary asserted from an output | summary from step outcomes + a registry verification step |

## Design

### 1. CI on `develop` and `main` (R1, R2) – no change

`ci.yml` already triggers on `push: [main, develop]`, `pull_request: [main, develop]`, and
`workflow_dispatch`; it runs `npm ci → typecheck → test → build → check:pack → test:package`.
Nothing to change. It simply has to exist on `main` (it arrives with this work).

### 2. Release trigger and ref (R3) – refuse loudly, never skip silently

Keep `workflow_dispatch` with the `bump` input. Replace the job-level `if:` guard with a
guard **inside** a job, so a wrong ref is a red run with a message, not a green no-op:

```yaml
- name: Refuse non-main dispatch
  if: github.ref != 'refs/heads/main'
  run: |
    echo "::error::Releases may only be dispatched from main (got ${{ github.ref }})."
    exit 1
```

Update the header comment block and `docs/publishing.md` to drop the `release/*` claims –
that path is removed, and a `release/*` dispatch now fails rather than releasing.

### 3. The gate job (R4) – prove CI passed **on main** for this commit

A dedicated job, with no `environment:` (so the human approval in §4 is requested only
after the gate passes):

```yaml
gate:
  name: Require green CI on main for this commit
  runs-on: ubuntu-latest
  permissions:
    contents: read        # add `actions: read` only if the API actually requires it
  steps:
    - name: Refuse non-main dispatch
      if: github.ref != 'refs/heads/main'
      run: |
        echo "::error::Releases may only be dispatched from main (got ${{ github.ref }})."
        exit 1

    - name: Require the newest CI run for this commit on main to be green
      uses: actions/github-script@3a2844b7e9c422d3c10d287c895573f7108da1b3 # v9.0.0
      with:
        script: |
          const { owner, repo } = context.repo;
          const sha = context.sha;

          const { data } = await github.rest.actions.listWorkflowRuns({
            owner, repo,
            workflow_id: 'ci.yml',   // confirm this is the workflow-scoped endpoint
            branch: 'main',          // ← scoping the v1 query omitted
            head_sha: sha,
            per_page: 50,
          });

          // Guard against the call resolving repo-scoped (which ignores workflow_id).
          const runs = data.workflow_runs
            .filter(r => r.path === '.github/workflows/ci.yml' || r.name === 'CI')
            .filter(r => r.event === 'push' || r.event === 'workflow_dispatch')
            .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

          const url = r => `https://github.com/${owner}/${repo}/actions/runs/${r.id}`;

          if (runs.length === 0) {
            core.setFailed(`No CI run found for ${sha} on main. CI must run on main before a release.`);
            return;
          }
          const newest = runs[0];
          if (newest.head_branch !== 'main') {
            core.setFailed(`Newest CI run for ${sha} is on '${newest.head_branch}', not main.`);
          } else if (newest.status !== 'completed') {
            core.setFailed(`CI for ${sha} is still ${newest.status}. Re-dispatch once it completes: ${url(newest)}`);
          } else if (newest.conclusion !== 'success') {
            core.setFailed(`CI for ${sha} concluded '${newest.conclusion}': ${url(newest)}`);
          } else {
            core.notice(`CI green for ${sha} on main: ${url(newest)}`);
          }
```

Why each part: `branch: 'main'` + the `head_branch` assertion scope the gate to `main`
(v1 proved only "passed somewhere"); the `event` filter accepts a manually dispatched CI
run, so a commit that never got a `push` run can still be released; newest-run-wins
rejects a stale green run; the explicit "still running" branch stops a normal
dispatch-a-minute-after-a-merge from being misreported as "CI never passed".

### 4. Version model – bump first, publish `existing`

The v1 model stamped the version in the workspace and published, then opened a bump PR.
That leaves `main`'s manifest behind the registry, which lets the tag point at a commit
whose `package.json` is not the published version, and lets a later `patch` compute a
version lower than `latest` (npm's guard does not stop it once `--tag latest` is passed).

v2 splits the two concerns:

- `bump: patch | minor | major` → compute the next version, open a **version-bump PR**, and
  stop. Nothing is published.
- `bump: existing` → publish the version currently committed on `main`.

Consequences: the published version is always the one on `main`; the `vX` tag points at a
commit whose manifest reads `X`; `latest` cannot move backwards because `main`'s version
only increases. The post-publish "open a bump PR" step disappears.

Guard rails stay in `release.mjs` regardless of mode:

- before publishing, query the registry and **abort** if the version already exists or is
  not strictly greater than the published `latest`;
- publish **without** `--tag latest`, so npm's own default-tag guard still applies;
- after publishing, assert `latest` now equals the version just published.

### 5. Publish job hardening

```yaml
release:
  needs: gate
  environment: production          # approval is now requested only after the gate is green
  permissions:
    contents: write
    id-token: write
    pull-requests: write
```

- Drop the redundant `npm run typecheck` / `npm test` step. CI already proved the commit
  (§3); re-running untrusted test code inside the job that holds `id-token: write` only
  widens the window in which a dependency `postinstall` could publish as the trusted
  publisher.
- Install with `npm ci --ignore-scripts` (verify the tsup/esbuild build still succeeds) and
  set `persist-credentials: false` on checkout, so neither dependency lifecycle scripts nor
  the persisted repo token are live while the OIDC token is available.
- **Injection fix:** never interpolate `${{ }}` into `run:`.

  ```yaml
  - name: Publish release
    id: release
    env:
      BUMP: ${{ inputs.bump }}
    run: |
      case "$BUMP" in
        patch|minor|major|existing) ;;
        *) echo "::error::invalid bump '$BUMP'"; exit 1 ;;
      esac
      node scripts/release.mjs "$BUMP"
  ```

  Apply the same pattern to the `github.ref_name` used by the bump-PR step.

### 6. Publish authentication

- **Drop `registry-url`** from `setup-node`. It writes an `_authToken` into the npm
  userconfig; npm then believes auth is configured and skips the OIDC exchange, failing with
  `ENEEDAUTH` or a 404 that reads like a missing package. The default registry already
  applies and `publishConfig.access: public` is in `package.json`.
- **Assert the toolchain floor** – npm ≥ 11.5.1 and Node ≥ 22.14.0 are both required for the
  OIDC exchange; print *and check* the npm version (a Node-22.14 runner satisfies the Node
  floor while shipping npm 10.x).
- **Close the local-publish path** – `release.mjs` refuses to publish unless
  `GITHUB_ACTIONS === 'true'` (OIDC) or an explicit `--bootstrap` flag is passed. Otherwise
  `node scripts/release.mjs patch` on a laptop still publishes with no CI, branch, or
  approval.

### 7. Recovery and observability

- Order the post-publish steps publish → tag/Release, and guard the latter with
  `if: ${{ !cancelled() && steps.release.outputs.published == 'true' }}`. `Create GitHub
  Release` currently has no status function, so GitHub ANDs an implicit `success()` and a
  failure in between silently skips the tag.
- Add the pre-publish registry existence check (§4) so a re-dispatch fails fast with
  "already published – do not re-dispatch" instead of a raw registry conflict.
- Build the run summary from **step outcomes**, not from a single output, and add a
  post-publish `npm view @qodeca/revcli dist-tags --json` check so "did it publish?" is
  answered by the registry.
- Add a `concurrency` recovery note ("cancel any running/queued Release run before
  re-dispatching"); the default depth-1 queue cancels a *pending* run when a third arrives.

### 8. Docs and governance

- `docs/publishing.md`:
  - releases are `main`-only; `release/*` and tag dispatches are refused;
  - the R4 precondition (a green `push` CI run for the exact SHA on `main`);
  - the bootstrap as an **ordered** checklist – bind the trusted publisher → verify it →
    restrict tokens → revoke the bootstrap credential – and note the bootstrap version
    carries no attestation;
  - the trusted publisher is bound to owner + repo + **workflow filename** + environment, so
    any auto-publish variant must stay in `release.yml`;
  - `npm trust github @qodeca/revcli --file release.yml --env production --allow-publish`
    as the auditable CLI path;
  - `repository.url` must exactly match owner/repo (a documented publish blocker);
  - the `production` environment must have a required reviewer and a `main`-only deployment
    branch policy, or the human gate is silently absent.
- Add `.github/dependabot.yml` (`package-ecosystem: github-actions`) – Dependabot raises no
  alerts for SHA-pinned actions, so a future advisory would otherwise be invisible.

## Findings → disposition

| # | Finding | Disposition |
|---|---|---|
| 1 | `inputs.bump` shell injection | adopted – §5 `env:` indirection + allow-list |
| 2 | `--tag latest` defeats npm's guard | adopted – §4 (drop flag, registry pre-check) |
| 3 | gate not branch-scoped | adopted – §3 |
| 4 | gate unsatisfiable (`event: push` only) | adopted – §3 |
| 5 | gate accepts a stale green run | adopted – §3 newest-run-wins |
| 6 | gate misreports an in-progress run | adopted – §3 |
| 7 | approval precedes the gate | adopted – §3/§5 split jobs |
| 8 | non-main dispatch is a silent green no-op | adopted – §2 |
| 9 | gate inert until on the default branch | adopted – §Delivery |
| 10 | OIDC held while untrusted dep code runs | partly adopted – §5 (drop re-verify, `--ignore-scripts`, `persist-credentials: false`); a full 3-job split is deferred |
| 11 | human gate silently optional | adopted – §8 |
| 12 | publish ok, bump PR fails → tag skipped | adopted – §4 removes the step; §7 guards the tag |
| 13 | re-dispatch re-runs publish | adopted – §4/§7 pre-publish check |
| 14 | `registry-url` short-circuits OIDC | adopted – §6 |
| 15 | tag commit version ≠ published version | adopted – §4 bump-first |
| 16 | gate covers only the OIDC path | adopted – §6 local-publish guard |
| 17 | `actions: read` justification/placement | adopted – §3 (try `contents: read` first) |
| 18 | concurrency `queue: single` | adopted – §7 note |
| 19 | summary overclaims; no registry check | adopted – §7 |
| 20 | `existing` non-idempotent | adopted – §4/§7 |
| 21 | npm/Node minimums not enforced | adopted – §6 |
| 22 | no Dependabot for pinned actions | adopted – §8 |
| 23 | bootstrap token revocation not ordered | adopted – §8 |
| 24 | docs/comment drift | adopted – §2/§8 |
| 25 | trusted-publishing setup gaps | adopted – §6/§8 |
| 26 | `workflow_id` method mapping unverified | verify at implementation – §3 |
| 27 | `ref_name` interpolation in bump step | adopted – §5 |

## Delivery and verification

1. Implement on `develop`; PR #9 (`develop`→`main`) carries it to `main`.
2. After PR #9 merges, **before** the first gated release: confirm `main`'s copy contains the
   new guard (`git show origin/main:.github/workflows/release.yml`) and that main's merge
   commit has a green `CI` push run. Do **not** verify by dispatching – a dispatch publishes.
3. Then the bootstrap publish (a documented one-time manual exception), then the trusted
   publisher + `production` environment.

## Open questions

- **Bump-first (§4)** is the one behavioural change: a release becomes two dispatches
  (prepare the bump PR → merge → publish `existing`). It is what removes the tag/manifest
  and `latest`-regression classes. If a single-dispatch release is preferred, keep the v1
  model and accept the tag/manifest divergence as documented.
- **§5 `npm ci --ignore-scripts`** – confirm the build still works without dependency
  lifecycle scripts before adopting.
- **§10 full job split** – deferred; the reduced form in §5 is the pragmatic middle.
