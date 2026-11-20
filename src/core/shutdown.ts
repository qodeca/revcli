/**
 * SIGHUP/SIGINT/SIGTERM handling (issue #33).
 *
 * Playwright installs its own signal handlers while a browser runs; its
 * SIGTERM handler closes the browsers but never exits, and its presence turns
 * off Node's default "exit on SIGTERM" – so `kill <pid>` left revcli running.
 * revcli therefore launches with Playwright's handlers off (see
 * `browserLaunchOptions`) and owns shutdown here: abort `shutdownSignal` so
 * running work stops, close the browsers, and exit with 128 + signal number.
 */

import { UnrecoverableError } from "./errors.js";

/**
 * Exit code per signal: 128 + the signal number, the shell convention.
 * SIGHUP (terminal closed) is included because Playwright's own SIGHUP handler
 * would otherwise keep revcli alive the same way its SIGTERM handler did.
 */
export const SIGNAL_EXIT_CODES = { SIGHUP: 129, SIGINT: 130, SIGTERM: 143 } as const;
export type ShutdownSignalName = keyof typeof SIGNAL_EXIT_CODES;

/** Exit at the latest this long after a signal, even if cleanup hangs. */
export const FORCE_EXIT_MS = 5_000;

/** The part of `process` the handlers need (a fake in tests). */
export interface SignalSource {
  on(event: ShutdownSignalName, listener: () => void): unknown;
}

export interface ShutdownDeps {
  source: SignalSource;
  /** Close every open browser. Errors are ignored. */
  cleanup: () => Promise<void>;
  exit: (code: number) => void;
  forceExitMs?: number;
  /** Signals to handle. Default: all of SIGNAL_EXIT_CODES. */
  signals?: readonly ShutdownSignalName[];
}

const defaultController = new AbortController();

/**
 * Aborted once revcli receives SIGHUP, SIGINT or SIGTERM. Long-running work (the batch
 * loop, retries, browser launch) checks it so nothing new starts while the
 * browsers are being closed.
 */
export const shutdownSignal: AbortSignal = defaultController.signal;

/**
 * Register the SIGHUP, SIGINT and SIGTERM handlers. Call once per process.
 * The first signal aborts the shutdown signal, runs `cleanup`, and exits with
 * that signal's code when cleanup settles or after `forceExitMs`. Any later
 * signal exits at once (through `exit`, so Playwright's exit hook still kills
 * Chromium). `exit` is called at most once.
 */
export function installShutdownHandlers(
  deps: ShutdownDeps,
  controller: AbortController = defaultController,
): void {
  const forceExitMs = deps.forceExitMs ?? FORCE_EXIT_MS;
  let exitCode: number | undefined;
  let exited = false;

  const exitOnce = (code: number): void => {
    if (exited) return;
    exited = true;
    deps.exit(code);
  };

  const onSignal = (name: ShutdownSignalName): void => {
    if (exitCode !== undefined) {
      // Already closing: a second signal means "stop now".
      exitOnce(exitCode);
      return;
    }
    exitCode = SIGNAL_EXIT_CODES[name];
    const code = exitCode;
    controller.abort(new UnrecoverableError("SHUTDOWN", `Received ${name} – stopping`));

    setTimeout(() => exitOnce(code), forceExitMs);
    deps
      .cleanup()
      .catch(() => {
        // Browser may already be closed; never print browser error text here.
      })
      .finally(() => exitOnce(code));
  };

  const names = deps.signals ?? (Object.keys(SIGNAL_EXIT_CODES) as ShutdownSignalName[]);
  for (const name of names) {
    // `on`, not `once`: a repeated signal must reach exitOnce instead of
    // Node's default kill, which would skip Playwright's exit hook.
    deps.source.on(name, () => onSignal(name));
  }
}
