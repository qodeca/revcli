#!/usr/bin/env node
// Release orchestrator (`node scripts/release.mjs <patch|minor|major|existing>`).
//
// Two modes, chosen by the bump argument:
//
//   patch | minor | major  → PREPARE. Compute the next version and stamp it into
//                            package.json and package-lock.json. NOTHING is published;
//                            the workflow commits the stamp and opens a version-bump PR.
//
//   existing               → PUBLISH. Build, verify the tarball and the packaged
//                            install, then publish the version already committed on main.
//
// Publishing happens ONLY in `existing` mode, so the version on npm is always the
// version committed on main: the `vX` tag, main's manifest and the registry agree, and
// `latest` cannot move backwards. tsup inlines the package version into dist/index.js
// at build time, so the build always runs after the version is fixed.
//
// Authentication is npm TRUSTED PUBLISHING (OIDC) only. There is no token or login
// fallback: this script refuses to publish unless the job holds an OIDC token, or
// `--bootstrap` is passed for the documented one-time first publish.
//
// Usage: node scripts/release.mjs <patch|minor|major|existing> [--dry-run] [--bootstrap]

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

// Returns stdout, or null when the command exits non-zero (e.g. a 404 from `npm view`).
const captureNpm = (args) => {
  const [file, full] = npmArgv(args);
  try {
    return execFileSync(file, full, {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      shell: !npmExecpath && process.platform === 'win32',
    }).trim();
  } catch {
    return null;
  }
};

const git = (args) => {
  try {
    return execFileSync('git', args, { cwd: repoRoot, encoding: 'utf8' }).trim();
  } catch {
    return null;
  }
};

const emitOutput = (result) => {
  console.log(`release result: ${JSON.stringify(result)}`);
  if (process.env.GITHUB_OUTPUT) {
    const lines = Object.entries(result).map(([k, v]) => `${k}=${v}`);
    appendFileSync(process.env.GITHUB_OUTPUT, `${lines.join('\n')}\n`, 'utf8');
  }
};

const fail = (message) => {
  console.error(`release: ${message}`);
  process.exit(1);
};

const bump = (process.argv[2] ?? '').trim();
if (!['patch', 'minor', 'major', 'existing'].includes(bump)) {
  fail(`unknown bump "${bump}" — expected patch, minor, major, or existing.`);
}

const dryRun = process.argv.includes('--dry-run');
const bootstrap = process.argv.includes('--bootstrap');
const pkg = readManifest();

const computeNextVersion = (version, b) => {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (!m) {
    fail(`cannot ${b}-bump version "${version}" — a stable release must start from a plain x.y.z.`);
  }
  const [, major, minor, patch] = m.map(Number);
  if (b === 'major') return `${major + 1}.0.0`;
  if (b === 'minor') return `${major}.${minor + 1}.0`;
  return `${major}.${minor}.${patch + 1}`;
};

const compareVersions = (a, b) => {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i += 1) if (pa[i] !== pb[i]) return pa[i] - pb[i];
  return 0;
};

const publishedVersions = () => {
  const out = captureNpm(['view', pkg.name, 'versions', '--json']);
  if (out === null) return []; // the package does not exist yet — a first publish is allowed
  const parsed = JSON.parse(out);
  return Array.isArray(parsed) ? parsed : [parsed];
};

const publishedLatest = () => {
  const out = captureNpm(['view', pkg.name, 'dist-tags', '--json']);
  if (out === null) return null;
  const parsed = JSON.parse(out);
  return typeof parsed.latest === 'string' ? parsed.latest : null;
};

// ─────────────────────────── PREPARE (patch | minor | major) ───────────────────────────
if (bump !== 'existing') {
  const version = computeNextVersion(pkg.version, bump);
  if (dryRun) {
    console.log(`release: [dry-run] would prepare ${pkg.name} ${pkg.version} → ${version}.`);
    emitOutput({ mode: 'prepare', bump, version, published: false, dryRun: true });
    process.exit(0);
  }
  writeFileSync(pkgPath, `${JSON.stringify({ ...pkg, version }, null, 2)}\n`, 'utf8');
  console.log(`release: stamped ${pkg.name} ${pkg.version} → ${version}.`);
  // Keep the lockfile's root version in step with the manifest so `npm ci` stays happy.
  runNpm(['install', '--package-lock-only', '--ignore-scripts']);
  emitOutput({ mode: 'prepare', bump, version, published: false });
  console.log(`release: prepared ${pkg.name}@${version} — merge the bump PR, then dispatch with bump=existing.`);
  process.exit(0);
}

// ─────────────────────────── PUBLISH (existing) ───────────────────────────
const version = pkg.version;

// Authorisation: an OIDC token from the job, or an explicit bootstrap publish. There is
// deliberately no token / `npm login` fallback — a laptop publish would bypass CI, the
// branch check, the environment approval and provenance all at once.
const oidc = Boolean(process.env.ACTIONS_ID_TOKEN_REQUEST_URL) || process.env.GITHUB_ACTIONS === 'true';
if (!dryRun && !oidc && !bootstrap) {
  fail(
    'no OIDC token — refusing to publish outside GitHub Actions. ' +
      'Pass --bootstrap only for the documented one-time first publish.',
  );
}

if (bootstrap && !dryRun) {
  const head = git(['rev-parse', 'HEAD']);
  const originMain = git(['rev-parse', 'origin/main']);
  const dirty = git(['status', '--porcelain', '--untracked-files=no']);
  if (head && originMain && head !== originMain) {
    fail(
      `bootstrap: HEAD (${head.slice(0, 8)}) does not match origin/main (${originMain.slice(0, 8)}). ` +
        'Check out main and pull before the bootstrap publish.',
    );
  }
  if (dirty) fail('bootstrap: the working tree has uncommitted tracked changes — commit or stash first.');
  console.log(`bootstrap: publishing from main @ ${(head ?? '?').slice(0, 8)} (no OIDC, no attestation).`);
}

// Refuse to publish a version the registry already holds, or one that would move
// `latest` backwards. `--tag latest` is deliberately NOT passed below, so npm's own
// default-tag guard stays armed; this check fails earlier and with a clearer message.
if (!dryRun) {
  const versions = publishedVersions();
  if (versions.includes(version)) {
    fail(
      `${pkg.name}@${version} is already published — versions are immutable and a published ` +
        'release must never be re-dispatched. Publish a new patch instead.',
    );
  }
  const latest = publishedLatest();
  if (latest && compareVersions(version, latest) <= 0) {
    fail(
      `refusing to publish ${version}: the registry's latest is ${latest}. ` +
        'Merge the version-bump PR on main first, then dispatch bump=existing.',
    );
  }
}

console.log(`release: building ${pkg.name}@${version}…`);
runNpm(['run', 'build']);
console.log('release: verifying the tarball contract…');
runNpm(['run', 'check:pack']);
console.log('release: running the packaged-install smoke test…');
runNpm(['run', 'test:package']);

// Provenance is generated automatically by a trusted-publisher publish; the explicit
// flag is only added when an OIDC token is actually present, so it stays honest.
const provenance = !dryRun && oidc ? ['--provenance'] : [];
const args = [
  'publish',
  '--access', 'public',
  '--ignore-scripts',
  ...provenance,
  ...(dryRun ? ['--dry-run'] : []),
];
console.log(`release: npm ${args.join(' ')}`);
runNpm(args);

if (!dryRun) {
  const latest = publishedLatest();
  if (latest !== version) {
    fail(`post-publish check failed: the registry's latest is ${latest}, expected ${version}.`);
  }
  console.log(`release: verified — ${pkg.name} latest is now ${version}.`);
}

emitOutput({ mode: 'publish', bump, version, published: !dryRun });
console.log(`release: done — published ${pkg.name}@${version}.`);
