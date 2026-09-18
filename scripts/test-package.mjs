#!/usr/bin/env node
// Packaged-install smoke test. Packs the real tarball, installs it into an
// isolated temp consumer, runs `revcli --version` out of that install, and asserts
// the output equals the manifest version.
//
// This is the gate that catches a version desync (dist inlines a stale version)
// and a non-loadable bundle, and it validates that the published bin is wired and
// that the runtime dependencies actually resolve. Run it as a hard gate before
// publish.

import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));

const npmExecpath = process.env.npm_execpath;
const npmArgv = (args) =>
  npmExecpath ? [process.execPath, [npmExecpath, ...args]] : [process.platform === 'win32' ? 'npm.cmd' : 'npm', args];

const runNpm = (args, cwd) => {
  const [file, full] = npmArgv(args);
  return execFileSync(file, full, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit'],
    shell: !npmExecpath && process.platform === 'win32',
  });
};

// The smoke test packs the already-built dist, so make sure it exists first.
if (!existsSync(path.join(repoRoot, 'dist', 'index.js'))) {
  console.log('test:package: dist/ missing — running npm run build first.');
  runNpm(['run', 'build'], repoRoot);
}

const tmp = mkdtempSync(path.join(os.tmpdir(), 'revcli-pkg-'));
let failures = 0;

try {
  const packOut = runNpm(['pack', '--json', '--ignore-scripts', '--pack-destination', tmp], repoRoot);
  const [packed] = JSON.parse(packOut);
  const tarball = path.join(tmp, packed.filename);

  // A minimal consumer so `npm install <tarball>` has a package to install into.
  const consumer = path.join(tmp, 'consumer');
  mkdirSync(consumer, { recursive: true });
  writeFileSync(
    path.join(consumer, 'package.json'),
    JSON.stringify({ name: 'revcli-smoke-consumer', version: '1.0.0', private: true }, null, 2) + '\n',
  );
  console.log(`test:package: installing ${packed.filename} into isolated consumer…`);
  runNpm(['install', tarball], consumer);

  const binDir = path.join(consumer, 'node_modules', '.bin', 'revcli');
  const bin =
    process.platform === 'win32' && existsSync(`${binDir}.cmd`) ? `${binDir}.cmd` : binDir;
  if (!existsSync(bin)) {
    console.error('test:package FAILED — the installed `revcli` bin does not exist.');
    process.exit(1);
  }

  const installedPkgPath = path.join(consumer, 'node_modules', '@qodeca', 'revcli', 'package.json');
  const installedPkg = JSON.parse(readFileSync(installedPkgPath, 'utf8'));
  if (installedPkg.name !== '@qodeca/revcli') {
    console.error(`test:package FAILED — installed package name is "${installedPkg.name}", expected "@qodeca/revcli".`);
    failures++;
  }

  const versionOut = execFileSync(bin, ['--version'], {
    cwd: consumer,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit'],
  }).trim();
  console.log(`test:package: revcli --version -> ${versionOut}`);

  if (versionOut !== pkg.version) {
    console.error(
      `test:package FAILED — installed CLI reports "${versionOut}", manifest is "${pkg.version}". A version desync would ship a wrong --version.`,
    );
    failures++;
  }
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

if (failures > 0) {
  process.exit(1);
}
console.log(`test:package OK — ${pkg.name}@${pkg.version} installs and reports a truthful version.`);
