import { afterEach, describe, it, expect, vi } from "vitest";
import { describeFatalError, reportFatalError, safeErrorMessage } from "../src/core/fatal.js";
import { logger } from "../src/utils/logger.js";
import { UnrecoverableError } from "../src/core/errors.js";

describe("describeFatalError", () => {
  it("treats a typed UnrecoverableError as expected", () => {
    const f = describeFatalError(new UnrecoverableError("AUTH_REQUIRED", "Run `revcli auth`."));
    expect(f).toMatchObject({ message: "Run `revcli auth`.", expected: true });
  });

  it("treats an invalid-input error as expected", () => {
    const f = describeFatalError(new Error('Invalid input: "foo". Provide a Google Maps URL or Place ID.'));
    expect(f.expected).toBe(true);
    expect(f.message).toBe('Invalid input: "foo". Provide a Google Maps URL or Place ID.');
  });

  it("treats a missing file (ENOENT) as expected", () => {
    const err = Object.assign(new Error("ENOENT: no such file or directory, open 'urls.txt'"), {
      code: "ENOENT",
    });
    expect(describeFatalError(err).expected).toBe(true);
  });

  it("treats a plain error as unexpected and keeps its stack for debug output", () => {
    const f = describeFatalError(new Error("Something went wrong"));
    expect(f.expected).toBe(false);
    expect(f.message).toBe("Something went wrong");
    expect(f.stack).toContain("Something went wrong");
  });

  it("stringifies a non-Error throwable", () => {
    expect(describeFatalError("plain string")).toEqual({
      message: "plain string",
      stack: null,
      expected: false,
    });
  });

  it("cuts Playwright's call log, which can contain the account name and email", () => {
    const err = new Error(
      'locator.click: Timeout 1000ms exceeded.\nCall log:\n  - locator resolved to <a aria-label="Google Account: X (x@example.com)">',
    );
    const f = describeFatalError(err);
    expect(f.message).toBe("locator.click: Timeout 1000ms exceeded.");
    expect(f.message).not.toContain("Call log");
    expect(f.message).not.toContain("example.com");
    expect(f.stack).not.toContain("example.com");
  });
});

const CALL_LOG_ERROR = () =>
  new Error(
    'locator.click: Timeout 1000ms exceeded.\nCall log:\n  - locator resolved to <a aria-label="Google Account: X (x@example.com)">',
  );

describe("safeErrorMessage", () => {
  it("cuts Playwright's call log", () => {
    expect(safeErrorMessage(CALL_LOG_ERROR())).toBe("locator.click: Timeout 1000ms exceeded.");
  });

  it("keeps a message without a call log unchanged", () => {
    expect(safeErrorMessage(new Error("boom\nsecond line"))).toBe("boom\nsecond line");
  });

  it("stringifies a non-Error throwable", () => {
    expect(safeErrorMessage("plain")).toBe("plain");
    expect(safeErrorMessage(42)).toBe("42");
  });
});

describe("reportFatalError", () => {
  const originalExitCode = process.exitCode;

  afterEach(() => {
    process.exitCode = originalExitCode;
    vi.restoreAllMocks();
  });

  function spies() {
    return {
      error: vi.spyOn(logger, "error").mockImplementation(() => {}),
      info: vi.spyOn(logger, "info").mockImplementation(() => {}),
      debug: vi.spyOn(logger, "debug").mockImplementation(() => {}),
    };
  }

  it("prints an expected error once, with no --verbose hint, stack at debug only", () => {
    const s = spies();

    reportFatalError(new UnrecoverableError("AUTH_REQUIRED", "Run `revcli auth`."));

    expect(s.error).toHaveBeenCalledTimes(1);
    expect(s.error).toHaveBeenCalledWith("Run `revcli auth`.");
    expect(s.info).not.toHaveBeenCalled();
    expect(s.debug).toHaveBeenCalledTimes(1);
    expect(String(s.debug.mock.calls[0][0])).toContain("UnrecoverableError");
    expect(process.exitCode).toBe(1);
  });

  it("adds the --verbose hint for an unexpected error and never prints the stack at error level", () => {
    const s = spies();

    reportFatalError(CALL_LOG_ERROR());

    expect(s.error).toHaveBeenCalledTimes(1);
    expect(s.error).toHaveBeenCalledWith("locator.click: Timeout 1000ms exceeded.");
    expect(s.info).toHaveBeenCalledWith("Run again with --verbose for details.");
    expect(String(s.error.mock.calls[0][0])).not.toContain("    at ");
    expect(String(s.debug.mock.calls[0][0])).not.toContain("example.com");
    expect(process.exitCode).toBe(1);
  });

  it("reports a non-Error throwable without a stack", () => {
    const s = spies();

    reportFatalError("plain string");

    expect(s.error).toHaveBeenCalledWith("plain string");
    expect(s.debug).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
  });
});
