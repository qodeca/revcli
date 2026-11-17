/**
 * Every reason revcli stops without retrying. A union (not a free string) so a
 * typo at a throw site or a `hasUnrecoverableKind` check fails to compile.
 *
 * - NAV_VERIFY: the loaded page is a different place than requested
 * - SORT_VERIFY: the requested sort order could not be applied or confirmed
 * - AUTH_POLL: interactive sign-in timed out or the window was closed
 * - AUTH_REQUIRED: Google Maps shows a limited view; `revcli auth` is needed
 * - NOT_A_PLACE: the link opened a search results page, not a single place
 */
export type UnrecoverableKind =
  | "NAV_VERIFY"
  | "SORT_VERIFY"
  | "AUTH_POLL"
  | "AUTH_REQUIRED"
  | "NOT_A_PLACE";

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
  readonly kind: UnrecoverableKind;

  constructor(kind: UnrecoverableKind, message: string) {
    super(message);
    this.name = "UnrecoverableError";
    this.kind = kind;
  }
}

/**
 * Playwright appends a "Call log:" section to error messages that can print
 * element markup – including the account link's aria-label with the user's
 * name and email.
 */
const CALL_LOG_MARKER = "\nCall log:";

/** Cut Playwright's call log from an error message. */
export function stripCallLog(message: string): string {
  const cut = message.indexOf(CALL_LOG_MARKER);
  return cut === -1 ? message : message.slice(0, cut);
}

/**
 * An error's message, safe to print or log: Playwright's call log removed.
 * Use this wherever an error message from browser code reaches output.
 * Lives here (no imports) so retry.ts can use it without an import cycle;
 * re-exported from fatal.ts.
 */
export function safeErrorMessage(err: unknown): string {
  return err instanceof Error ? stripCallLog(err.message) : String(err);
}

/** True when `err` is an `UnrecoverableError` of the given kind. */
export function hasUnrecoverableKind(
  err: unknown,
  kind: UnrecoverableKind,
): err is UnrecoverableError {
  return err instanceof UnrecoverableError && err.kind === kind;
}
