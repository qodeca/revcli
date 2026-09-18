#!/usr/bin/env node
// Tarball-integrity gate. Runs `npm pack --dry-run` (with --ignore-scripts so it
// never re-enters the `prepack` lifecycle that calls this script) and asserts the
// contract of the package that is about to reach the immutable registry.
//
// Exit non-zero on any violation. This is the gate that would have caught a
// tarball that ships `src/` or omits the bin.

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));

const npmExecpath = process.env.npm_execpath;
const npmArgv = (args) =>
  npmExecpath ? [process.execPath, [npmExecpath, ...args]] : [process.platform === 'win32' ? 'npm.cmd' : 'npm', args];

const [file, args] = npmArgv(['pack', '--dry-run', '--json', '--ignore-scripts']);
const out = execFileSync(file, args, {
  cwd: repoRoot,
  encoding: 'utf8',
  stdio: ['ignore', 'pipe', 'ignore'],
  shell: !npmExecpath && process.platform === 'win32',
});

const [result] = JSON.parse(out);
const files = result.files.map((f) => f.path);

const errors = [];

if (!files.includes('dist/index.js')) {
  errors.push('dist/index.js is missing from the tarball — is the bin entry correct?');
}
if (files.some((f) => f.startsWith('src/'))) {
  errors.push('src/ must not be shipped in the tarball (only dist/ is published).');
}
if (files.some((f) => f.startsWith('test/') || f.startsWith('tests/') || f.startsWith('fixtures/'))) {
  errors.push('test/, tests/, and fixtures/ must not be shipped in the tarball.');
}
if (pkg.name !== '@qodeca/revcli') {
  errors.push(`expected package name "@qodeca/revcli", got "${pkg.name}".`);
}
if (result.name !== pkg.name || result.version !== pkg.version) {
  errors.push(
    `packed manifest mismatch: packed ${result.name}@${result.version} vs manifest ${pkg.name}@${pkg.version}.`,
  );
}

if (errors.length) {
  console.error('check:pack FAILED');
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}

console.log(`check:pack OK — ${pkg.name}@${pkg.version} ships ${files.length} files (${result.filename}).`);
