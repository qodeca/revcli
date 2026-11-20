import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

/**
 * Issue #33: `kill <pid>` (SIGTERM) must close every browser and end revcli
 * with a non-zero code within 10 seconds. Runs a real child process with a
 * real Chromium on a temporary profile (never ~/.revcli).
 */

const CHILD = fileURLToPath(new URL("./fixtures/signal-child.ts", import.meta.url));
const EXIT_WITHIN_MS = 10_000;

/**
 * The child gets a temporary HOME, so tell Playwright where the installed
 * browsers are (its default location is derived from the real HOME).
 */
const BROWSERS_PATH =
  process.env.PLAYWRIGHT_BROWSERS_PATH ??
  (process.platform === "darwin"
    ? join(homedir(), "Library", "Caches", "ms-playwright")
    : join(homedir(), ".cache", "ms-playwright"));

/**
 * Whether a Chromium for `profileDir` is running: matched on its
 * `--user-data-dir=` flag, so the child node process (which has the bare path
 * in its argv) does not count. No shell involved.
 */
function processRunning(profileDir: string): boolean {
  const res = spawnSync("pgrep", ["-f", `user-data-dir=${profileDir}`], { encoding: "utf8" });
  if (res.status === 0) return true;
  if (res.status === 1) return false;
  throw new Error(`pgrep failed (status ${res.status}): ${res.error?.message ?? res.stderr}`);
}

async function waitUntil(check: () => boolean, timeoutMs: number): Promise<boolean> {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    if (check()) return true;
    await new Promise((r) => setTimeout(r, 100));
  }
  return check();
}

let child: ChildProcess | undefined;
let tmp: string | undefined;
let profile: string | undefined;

afterEach(() => {
  if (child && child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
  if (profile) spawnSync("pkill", ["-9", "-f", profile]);
  if (tmp) rmSync(tmp, { recursive: true, force: true });
  child = tmp = profile = undefined;
});

/** Start the child and resolve once it printed "ready". */
async function startChild(): Promise<ChildProcess> {
  tmp = mkdtempSync(join(tmpdir(), "revcli-signal-"));
  const home = join(tmp, "home");
  mkdirSync(home);
  profile = join(tmp, "profile");
  const proc = spawn(process.execPath, ["--import", "tsx", CHILD, profile], {
    env: { ...process.env, HOME: home, PLAYWRIGHT_BROWSERS_PATH: BROWSERS_PATH },
    stdio: ["ignore", "pipe", "pipe"],
    shell: false,
  });
  child = proc;
  let stderr = "";
  proc.stderr?.on("data", (d) => (stderr += String(d)));
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`child not ready: ${stderr}`)), 45_000);
    proc.stdout?.on("data", (d) => {
      if (String(d).includes("ready")) {
        clearTimeout(timer);
        resolve();
      }
    });
    proc.once("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`child exited early (${code}): ${stderr}`));
    });
  });
  return proc;
}

/** Resolve with the exit code (null when killed by a signal) or "timeout". */
function waitForExit(proc: ChildProcess, timeoutMs: number): Promise<number | null | "timeout"> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve("timeout"), timeoutMs);
    proc.once("exit", (code) => {
      clearTimeout(timer);
      resolve(code);
    });
  });
}

describe.skipIf(process.platform === "win32")("signal shutdown with a real browser (issue #33)", () => {
  it.each([
    ["SIGTERM", 143],
    ["SIGINT", 130],
  ] as const)("%s closes the browser and exits %i within 10 s", async (signal, code) => {
    const proc = await startChild();
    expect(processRunning(profile!)).toBe(true);

    const start = Date.now();
    proc.kill(signal);
    const exitCode = await waitForExit(proc, EXIT_WITHIN_MS + 2_000);
    const elapsed = Date.now() - start;

    expect(exitCode).toBe(code);
    expect(elapsed).toBeLessThan(EXIT_WITHIN_MS);
    // Chromium's helper processes may need a moment to go after the exit.
    expect(await waitUntil(() => !processRunning(profile!), 3_000)).toBe(true);
  });
});
