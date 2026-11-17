import { describe, it, expect } from "vitest";
import { loginPlan, statusOutcome } from "../src/commands/auth.js";

const UNCONFIRMED =
  "Google did not confirm the saved session within 15 seconds – trusting the saved cookies.";
const ALREADY =
  "Already signed in. The browser stays open so you can switch accounts – close the window when you're done.";
const WAITING =
  "Waiting for sign-in... The browser closes automatically once sign-in is detected (timeout: 5 minutes).";

describe("statusOutcome (revcli auth status)", () => {
  it.each([
    ["signed-in", [{ level: "success", text: "Signed in to Google. Ready to scrape." }], 0],
    [
      "unconfirmed",
      [
        { level: "success", text: "Signed in to Google. Ready to scrape." },
        { level: "warn", text: UNCONFIRMED },
      ],
      0,
    ],
    [
      "expired",
      [{ level: "warn", text: "Not signed in: the saved Google session has expired. Run: revcli auth" }],
      1,
    ],
    ["signed-out", [{ level: "warn", text: "Not signed in to Google. Run: revcli auth" }], 1],
  ] as const)("%s → lines and exit code %#", (state, lines, exitCode) => {
    expect(statusOutcome(state)).toEqual({ lines, exitCode });
  });
});

describe("loginPlan (revcli auth)", () => {
  it.each([
    ["signed-in", "wait-for-close", [{ level: "info", text: ALREADY }]],
    [
      "unconfirmed",
      "wait-for-close",
      [
        { level: "warn", text: UNCONFIRMED },
        { level: "info", text: ALREADY },
      ],
    ],
    [
      "expired",
      "wait-for-sign-in",
      [
        { level: "info", text: "The saved Google session has expired – sign in again." },
        { level: "info", text: WAITING },
      ],
    ],
    ["signed-out", "wait-for-sign-in", [{ level: "info", text: WAITING }]],
  ] as const)("%s → %s", (state, action, lines) => {
    expect(loginPlan(state)).toEqual({ action, lines });
  });
});
