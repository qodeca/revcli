/**
 * Typed error for failures that must NOT be retried by withRetry.
 *
 * Before this class existed, unrecoverable failures were signalled by throwing
 * plain Error with a magic substring that isUnrecoverable() matched against.
 * That approach was fragile: a typo in either place silently turned an
 * unrecoverable error into a retryable one. Prefer this class for any new
 * unrecoverable throws inside this codebase; keep the substring fallback in
 * isUnrecoverable() for errors originating from Playwright or other libraries
 * that we cannot reach.
 */
export class UnrecoverableError extends Error {
  readonly kind: string;

  constructor(kind: string, message: string) {
    super(message);
    this.name = "UnrecoverableError";
    this.kind = kind;
  }
}
