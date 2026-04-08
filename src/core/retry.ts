import { logger } from "../utils/logger.js";

export interface RetryOptions {
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
}

const DEFAULT_OPTIONS: RetryOptions = {
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
  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= opts.maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      if (attempt === opts.maxRetries) break;

      // Don't retry on known unrecoverable errors
      if (isUnrecoverable(lastError)) {
        logger.error(`${label}: unrecoverable error – ${lastError.message}`);
        throw lastError;
      }

      const delay = Math.min(
        opts.baseDelayMs * Math.pow(4, attempt) + Math.random() * 1000,
        opts.maxDelayMs,
      );
      logger.warn(
        `${label}: attempt ${attempt + 1}/${opts.maxRetries + 1} failed – retrying in ${Math.round(delay / 1000)}s`,
      );
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  throw lastError!;
}

function isUnrecoverable(error: Error): boolean {
  const message = error.message.toLowerCase();
  return (
    message.includes("invalid input") ||
    message.includes("invalid url") ||
    message.includes("captcha") ||
    message.includes("access denied")
  );
}
