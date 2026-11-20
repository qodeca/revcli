import { logger } from "../utils/logger.js";
import { UnrecoverableError, safeErrorMessage } from "./errors.js";

export interface RetryOptions {
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
  /** Once aborted: no further attempt starts and the back-off sleep ends early. */
  signal?: AbortSignal;
}

const DEFAULT_OPTIONS: Omit<RetryOptions, "signal"> = {
  maxRetries: 3,
  baseDelayMs: 2000,
  maxDelayMs: 30000,
};

/**
 * Retry a function with exponential backoff and jitter.
 * Backs off: 2s, 8s, 32s (capped at maxDelayMs).
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  label: string,
  options: Partial<RetryOptions> = {},
): Promise<T> {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const { signal } = opts;
  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= opts.maxRetries; attempt++) {
    signal?.throwIfAborted();
    try {
      return await fn();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      // Stopped from outside (timeout, shutdown): the attempt's own error is
      // a consequence, so report the reason and do not retry or warn.
      signal?.throwIfAborted();

      if (attempt === opts.maxRetries) break;

      // Don't retry on known unrecoverable errors. Debug level only: the caller
      // (top-level handler, or batch's per-location failure line) prints the
      // message once.
      if (isUnrecoverable(lastError)) {
        logger.debug(`${label}: unrecoverable error – ${safeErrorMessage(lastError)}`);
        throw lastError;
      }

      const delay = Math.min(
        opts.baseDelayMs * Math.pow(4, attempt) + Math.random() * 1000,
        opts.maxDelayMs,
      );
      logger.warn(
        `${label}: attempt ${attempt + 1}/${opts.maxRetries + 1} failed – retrying in ${Math.round(delay / 1000)}s`,
      );
      await sleep(delay, signal);
    }
  }

  throw lastError!;
}

/** Sleep for `ms`, ending early (rejecting with the reason) when `signal` aborts. */
function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(signal?.reason);
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

export function isUnrecoverable(error: Error): boolean {
  // Typed unrecoverable errors we throw ourselves are detected structurally
  // (no string matching required). Retained below: substring fallback for
  // errors originating from Playwright or other libraries we cannot modify.
  if (error instanceof UnrecoverableError) return true;

  const message = error.message.toLowerCase();
  return (
    message.includes("invalid input") ||
    message.includes("invalid url") ||
    message.includes("captcha") ||
    message.includes("access denied") ||
    message.includes("executable doesn't exist") ||
    message.includes("browser has been closed") ||
    message.includes("browsertype.launch") ||
    message.includes("navigation verification failed")
  );
}
