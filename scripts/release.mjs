#!/usr/bin/env node
// Release orchestrator (`node scripts/release.mjs <patch|minor|major|existing>`).
// The ONLY thing in this repository that publishes to npm, and it never runs from
// a push — a human dispatches the `Release` workflow and picks the bump.
//
// Order matters: it STAMPS the new version into package.json, THEN builds, THEN
// verifies, THEN publishes. tsup inlines the package version into dist/index.js at
// build time, so bumping after the build would ship a CLI that reports the wrong
// --version. Stamping before the build is what keeps `revcli --version` truthful.
//
// Publishes with --ignore-scripts: the build and the tarball-integrity gate
// (check:pack) and the packaged-install smoke test (test:package) have already run
// in this script, so the publish lifecycle must not re-run prepack.
//
// Authentication is npm TRUSTED PUBLISHING (OIDC) — this repository stores no npm
// token. GitHub Actions mints a short-lived identity token for a job granted
// `id-token: write`, and npm checks it against the trusted publisher configured on
// the package (owner + repo + workflow filename). A token-based `NODE_AUTH_TOKEN`
// and an `npm login` session are accepted as fallbacks for the manual bootstrap.
//
// FAILS when no credential is available rather than degrading to a dry run: a
// release either publishes or it fails. `--dry-run` is an EXPLICIT flag for local
// rehearsal only.
//
// Usage: node scripts/release.mjs <patch|minor|major|existing> [--dry-run]

import { execFileSync } from 'node:child_process';
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkgPath = path.join(repoRoot, 'package.json');
const readManifest = () => JSON.parse(readFileSync(pkgPath, 'utf8'));

const npmExecpath = process.env.npm_execpath;
const npmArgv = (args) =>
  npmExecpath ? [process.execPath, [npmExecpath, ...args]] : [process.platform === 'win32' ? 'npm.cmd' : 'npm', args];

const runNpm = (args) => {
  const [file, full] = npmArgv(args);
  execFileSync(file, full, {
    cwd: repoRoot,
    stdio: 'inherit',
    shell: !npmExecpath && process.platform === 'win32',
  });
};

const emitOutput = (result) => {
  console.log(`release result: ${JSON.stringify(result)}`);
  if (process.env.GITHUB_OUTPUT) {
    const lines = Object.entries(result).map(([k, v]) => `${k}=${v}`);
    appendFileSync(process.env.GITHUB_OUTPUT, `${lines.join('\n')}\n`, 'utf8');
  }
};

const bump = (process.argv[2] ?? '').trim();
if (!['patch', 'minor', 'major', 'existing'].includes(bump)) {
  console.error(`release: unknown bump "${bump}" — expected patch, minor, major, or existing.`);
  process.exit(1);
}

const pkg = readManifest();

// Compute the next version. A stable release must start from a plain x.y.z; the
// `existing` bump publishes the version already committed to package.json.
const computeNextVersion = (version, b) => {
  if (b === 'existing') return version;
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (!m) {
    console.error(
      `release: cannot ${b}-bump version "${version}" — a stable release must start from a plain x.y.z.`,
    );
    process.exit(1);
  }
  const [, major, minor, patch] = m.map(Number);
  if (b === 'major') return `${major + 1}.0.0`;
  if (b === 'minor') return `${major}.${minor + 1}.0`;
  return `${major}.${minor}.${patch + 1}`;
};

const version = computeNextVersion(pkg.version, bump);
const dryRun = process.argv.includes('--dry-run');

// Is this process authorised to publish? OIDC (CI), a token, or an npm login
// session. The whoami probe is skipped when an env signal is already present so a
// release never adds a network round-trip it does not need.
const oidc = Boolean(process.env.ACTIONS_ID_TOKEN_REQUEST_URL);
const token = process.env.NODE_AUTH_TOKEN ?? '';
const loggedIn = () => {
  const [file, args] = npmArgv(['whoami']);
  try {
    const who = execFileSync(file, args, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      shell: !npmExecpath && process.platform === 'win32',
    }).trim();
    if (who) console.log(`release: authenticated as npm user ${who}.`);
    return Boolean(who);
  } catch {
    return false;
  }
};

if (!dryRun && !oidc && !token && !loggedIn()) {
  console.error('release: no npm credential — refusing to run.');
  console.error('release: a release must publish or fail; it must never report a dry run as one.');
  console.error(
    process.env.GITHUB_ACTIONS === 'true'
      ? 'release: this job has no `id-token: write`, so npm cannot mint an OIDC token. Check the job\'s `permissions:` block and that the package\'s trusted publisher on npmjs.com names THIS workflow file.'
      : 'release: run `npm login` first, or pass --dry-run to rehearse without publishing.',
  );
  process.exit(1);
}

// 1. Stamp the version BEFORE the build so dist/index.js inlines the new version.
if (bump !== 'existing') {
  const next = { ...pkg, version };
  writeFileSync(pkgPath, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
  console.log(`release: stamped ${next.name} to ${version} (bump ${bump}).`);
} else {
  console.log(`release: publishing existing version ${pkg.version} (no stamp).`);
}

// 2. Build so the bundle picks up the stamped version.
console.log('release: running npm run build…');
runNpm(['run', 'build']);

// 3. Verify the tarball contract and the packaged-install smoke test.
console.log('release: running npm run check:pack…');
runNpm(['run', 'check:pack']);
console.log('release: running npm run test:package…');
runNpm(['run', 'test:package']);

// 4. Publish. Provenance needs the job's OIDC token; a trusted-publisher publish
//    attests provenance anyway, so the explicit flag is only added when OIDC is
//    actually present, to keep it honest if this ever runs on another CI.
const provenance = !dryRun && oidc ? ['--provenance'] : [];
const args = [
  'publish',
  '--tag', 'latest',
  '--access', 'public',
  '--ignore-scripts',
  ...provenance,
  ...(dryRun ? ['--dry-run'] : []),
];
console.log(`release: npm ${args.join(' ')}`);
runNpm(args);

emitOutput({ published: !dryRun, dryRun, bump, version });
console.log(`release: done — published ${pkg.name}@${version} to latest.`);
