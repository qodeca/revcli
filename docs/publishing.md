# Publishing revcli to npm

revcli is published to npm as the scoped package **`@qodeca/revcli`**. Publishing is done
two ways:

1. **Bootstrap (first release, by hand)** — trusted publishing cannot perform a package's
   first publish because npm has nowhere to attach a publisher until the package exists.
2. **Automated (after the first release)** — the `Release` GitHub Actions workflow publishes
   via npm trusted publishing (OIDC). No npm token is stored anywhere.

## One-time bootstrap

1. Create the `qodeca` npm org account (if it doesn't exist) with 2FA enabled.
2. Run the full local gate chain on the release candidate:

   ```bash
   npm run typecheck && npm test && npm run build && npm run check:pack
   npm run test:package
   ```

3. Sign in:

   ```bash
   npm login
   ```

4. Publish (no `--provenance` — it requires OIDC and will fail with a legacy token; the
   bootstrap release ships without an attestation, which is expected):

   ```bash
   npm publish --tag latest
   ```

   `prepack` runs `build` + `check:pack` automatically on the manual path.

5. Verify:

   ```bash
   npm view @qodeca/revcli version
   npm view @qodeca/revcli dist-tags
   npm install -g @qodeca/revcli@0.1.3
   revcli --version
   ```

## Trusted publishing (automated releases)

On <https://www.npmjs.com/package/@qodeca/revcli/access>, under **Trusted Publisher**:

| Field | Value |
|---|---|
| Organization or user | `qodeca` |
| Repository | `revcli` |
| Workflow filename | `release.yml` |
| Environment name | `production` |
| Allowed actions | tick **Allow `npm publish`** |

- **Tick "Allow npm publish".** It is off by default; without it the publish fails with a 404
  that names the package as if it didn't exist.
- Fields are **fixed once created** — a typo means deleting and re-adding the publisher, so
  check before saving. Renaming `release.yml` breaks publishing.
- After creating it, set the package to **"Require two-factor authentication and disallow
  tokens"** (Settings → Publishing access) so a leaked token cannot bypass the OIDC identity
  binding.

### Preconditions

- The `production` GitHub environment must exist with a **required reviewer**, otherwise the
  human gate is silently absent. See
  <https://github.com/qodeca/revcli/settings/environments>.
- The runner needs **Node ≥ 22.14.0 and npm ≥ 11.5.1** for the OIDC exchange. The workflow
  uses `lts/*` and checks `npm --version`.
- **Prove it:** dispatch the workflow once and confirm it actually publishes before relying on
  it. The xezar 0.10.2 failure mode was an empty publisher form silently accepted as
  "configured".

## Recovery

Published versions are immutable — never republish the same version, never `npm unpublish`
to retry.

| State | Do this |
|---|---|
| Job failed before publish | Fix the cause, re-dispatch the same bump. |
| `npm error 404` at publish | npm rejected the identity — the trusted publisher is absent/mismatched or lacks "Allow npm publish". Check owner/repo/workflow/environment and `id-token: write`. |
| Published, no tag / no GitHub Release | Do **not** re-run; create the Release by hand at the released commit. |
| `latest` points wrong | `npm dist-tag add @qodeca/revcli@<good> latest`. |
| Published a broken build | Publish the fix as a new patch, move `latest` to it, optionally `npm deprecate`. |

Inspect the registry **before** re-dispatching:

```bash
npm view @qodeca/revcli versions --json
```
