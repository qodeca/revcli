import { UnrecoverableError } from "./errors.js";

/**
 * How long a stopped task may take to finish (close its browser) after its
 * timeout. Past this, the browser may still hold the shared profile.
 */
export const SETTLE_GRACE_MS = 15_000;

export interface TimeoutOptions {
  timeoutMs: number;
  /** Also stop the task when this aborts (e.g. a shutdown). */
  signal?: AbortSignal;
  settleGraceMs?: number;
}

/** Wait `ms`; the timer is cleared when `cancel` is called. */
function delay(ms: number): { done: Promise<void>; cancel: () => void } {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const done = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, ms);
  });
  return { done, cancel: () => clearTimeout(timer) };
}

/**
 * Run `task` with a time limit that really stops it (issue #33).
 *
 * The task gets a signal that aborts when the limit is reached (or when
 * `options.signal` aborts); it must then stop and release what it holds.
 * On timeout this waits for the task to settle, so the caller never starts
 * the next task while the old one still runs, and then rejects with
 * `LOCATION_TIMEOUT` – even if the task resolved late, so a late result is
 * never used. If the task does not settle within `settleGraceMs`, it rejects
 * with `BROWSER_NOT_CLOSED` instead: the caller must not start another
 * browser on the same profile.
 */
export async function runWithTimeout<T>(
  task: (signal: AbortSignal) => Promise<T>,
  options: TimeoutOptions,
): Promise<T> {
  const controller = new AbortController();
  const signal = options.signal
    ? AbortSignal.any([controller.signal, options.signal])
    : controller.signal;

  const running = task(signal);
  const outcome = running.then(
    (value) => ({ ok: true as const, value }),
    (error: unknown) => ({ ok: false as const, error }),
  );

  const limit = delay(options.timeoutMs);
  const first = await Promise.race([outcome, limit.done.then(() => "timeout" as const)]);
  limit.cancel();

  if (first !== "timeout") {
    if (first.ok) return first.value;
    throw first.error;
  }

  const timeoutError = new UnrecoverableError(
    "LOCATION_TIMEOUT",
    `Location timeout after ${options.timeoutMs / 1000}s`,
  );
  controller.abort(timeoutError);

  const grace = delay(options.settleGraceMs ?? SETTLE_GRACE_MS);
  const settled = await Promise.race([
    outcome.then(() => true),
    grace.done.then(() => false),
  ]);
  grace.cancel();

  if (!settled) {
    throw new UnrecoverableError(
      "BROWSER_NOT_CLOSED",
      "The timed-out place did not close its browser in time",
    );
  }
  throw timeoutError;
}
