# Publishing setup — the one-time work

Everything that must be true **once** before releases work. For cutting an actual release,
use the runbook: **[releasing.md](releasing.md)**.

This is the record of what was configured for `@qodeca/revcli` and how to rebuild it if the
setup is ever lost.

---

## 1. npm org

`@qodeca/revcli` is a scoped **public** package under the **`qodeca`** npm org, with 2FA
enabled on the owning account (`marcin.obel` is an owner).

## 2. Trusted publisher

Configure at <https://www.npmjs.com/package/@qodeca/revcli/access> under **Trusted
Publisher**, or from the CLI (npm ≥ 11.15.0), which is auditable afterwards with
`npm trust list @qodeca/revcli`:

```bash
script -q /dev/null npm trust github @qodeca/revcli \
  --file release.yml --repo qodeca/revcli --env production --allow-publish -y
```

The `script -q /dev/null` wrapper is **required** — npm's 2FA web-auth flow only engages on a
TTY. See "Working with npm 2FA from the CLI" in [releasing.md](releasing.md).

| Field | Value |
|---|---|
| Organization or user | `qodeca` |
| Repository | `revcli` |
| Workflow filename | `release.yml` |
| Environment name | `production` |
| Allowed actions | **Allow `npm publish`** |

- **Tick "Allow npm publish".** It is off by default; without it the publish fails with a 404
  that names the package as if it did not exist.
- The publisher binds **owner + repository + workflow filename + environment**. A branch or
  ref is **not** part of the binding, so any future publish variant must stay in
  `release.yml` — moving it into `ci.yml` or a reusable workflow changes the identity npm
  validates and breaks the publish.
- Fields are **fixed once created** — a typo means deleting and re-adding the publisher.
  Renaming `release.yml` breaks publishing. npm does not validate the form when you save it,
  so mistakes surface only at publish time.
- `repository.url` in `package.json` must exactly match `owner/repo` (case-sensitive) or npm
  rejects the publish.
- Once the OIDC path is proven, set **Publishing access** to *"Require two-factor
  authentication and disallow bypass 2fa tokens"* so a leaked token cannot bypass the OIDC
  identity binding.

## 3. GitHub environment

`production` must exist with a **required reviewer** and a `main`-only deployment branch
policy, or the human gate is silently absent — and npm keeps accepting the OIDC identity even
after the reviewer is lost.

```bash
# required reviewer + custom branch policy
gh api -X PUT /repos/qodeca/revcli/environments/production --input - <<'JSON'
{"wait_timer":0,"reviewers":[{"type":"User","id":7283716}],"deployment_branch_policy":{"protected_branches":false,"custom_branch_policies":true}}
JSON

# allow only main
gh api -X POST /repos/qodeca/revcli/environments/production/deployment-branch-policies \
  --input - <<'JSON'
{"name":"main"}
JSON

# verify
gh api /repos/qodeca/revcli/environments/production \
  --jq '{reviewers:[.protection_rules[]?.reviewers[]?.reviewer.login],branch_policy:.deployment_branch_policy}'
```

(`7283716` is `marcinobel`'s user id; fetch it with `gh api /users/<login> --jq .id`.)

## 4. Bootstrap — the first publish of a brand-new package

Trusted publishing **cannot** create a package: npm has nowhere to attach a publisher until
the package exists. So the first publish is manual, from a clean `main`, and carries **no
provenance attestation**:

```bash
git checkout main && git pull --ff-only
script -q /dev/null node scripts/release.mjs existing --bootstrap
```

Then, in order (bind and verify **before** restricting tokens, so the token path stays
available until OIDC is proven):

1. Bind the trusted publisher (§2) and prove it with a real dispatch.
2. Create the tag and GitHub Release by hand — the bootstrap is a local publish, so neither
   exists:
   ```bash
   gh release create vX.Y.Z --target <released-commit-sha> --title "vX.Y.Z" --notes-file <notes>
   ```
3. Set Publishing access to disallow bypass-2fa tokens (§2).
4. Revoke the bootstrap credential: `npm logout` (drops the `_authToken` from `~/.npmrc`).

---

## What the release workflow assumes

- **Node ≥ 22.14.0 and npm ≥ 11.5.1.** The floors differ: a Node-22.14 runner satisfies the
  Node minimum while shipping npm 10.x, so the workflow asserts the npm version explicitly.
- The publish job runs `npm ci --ignore-scripts`, so no dependency lifecycle script runs
  while the job holds `id-token: write`.
- No `registry-url` on `setup-node` — it writes an `_authToken` and npm then skips the OIDC
  exchange.
- No npm token anywhere in the repository.

For the release procedure, recovery table, and troubleshooting, see
[releasing.md](releasing.md). For why it is built this way, see
[release-learnings.md](release-learnings.md).
