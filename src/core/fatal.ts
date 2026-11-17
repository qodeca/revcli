import { logger } from "../utils/logger.js";
import { isUnrecoverable } from "./retry.js";
import { safeErrorMessage } from "./errors.js";

export { safeErrorMessage };

/** How the top-level handler should report an error that ended the command. */
export interface FatalErrorReport {
  /** One-line-ish message for the user, without Playwright's call log. */
  message: string;
  /** Stack for debug-level output only (call log removed), or null. */
  stack: string | null;
  /** A known failure (typed, user mistake, missing file): no "--verbose" hint. */
  expected: boolean;
}

/** The call-log section inside a stack, up to the first stack frame. */
const CALL_LOG_IN_STACK = /\nCall log:[\s\S]*?(?=\n\s+at |$)/;

/**
 * Turn anything thrown out of a command into what the user sees. Lives in its
 * own module because `errors.ts` importing `retry.ts` would be an import cycle.
 */
export function describeFatalError(err: unknown): FatalErrorReport {
  if (!(err instanceof Error)) {
    return { message: String(err), stack: null, expected: false };
  }
  const expected =
    isUnrecoverable(err) || (err as NodeJS.ErrnoException).code === "ENOENT";
  return {
    message: safeErrorMessage(err),
    stack: err.stack ? err.stack.replace(CALL_LOG_IN_STACK, "") : null,
    expected,
  };
}

/**
 * The top-level handler for errors escaping a command (`index.ts`): print the
 * message once at error level, add the "--verbose" hint only for unexpected
 * errors, log the stack at debug level only, and set exit code 1.
 */
export function reportFatalError(err: unknown): void {
  const fatal = describeFatalError(err);
  logger.error(fatal.message);
  if (!fatal.expected) logger.info("Run again with --verbose for details.");
  if (fatal.stack) logger.debug(fatal.stack);
  process.exitCode = 1;
}
