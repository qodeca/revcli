import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * `launchBrowser` and `PROFILE_DIR` open the persistent profile in ~/.revcli,
 * which is a credential store holding a real Google session. No test may
 * import them (AGENTS.md "Browser tests").
 */
const TESTS_DIR = fileURLToPath(new URL(".", import.meta.url));
const FORBIDDEN = ["launchBrowser", "PROFILE_DIR"];

/** Import statements (static or dynamic) whose specifier is scraper/browser. */
const BROWSER_MODULE_IMPORT =
  /import\s*(?:type\s+)?([\s\S]*?)\s*from\s*["'][^"']*scraper\/browser(?:\.js|\.ts)?["']|import\(\s*["'][^"']*scraper\/browser(?:\.js|\.ts)?["']\s*\)/g;

/** Names a test file imports from scraper/browser that it must not. */
export function forbiddenBrowserImports(source: string): string[] {
  const found: string[] = [];
  for (const match of source.matchAll(BROWSER_MODULE_IMPORT)) {
    const clause = match[1];
    // Namespace, default and dynamic imports expose every export.
    if (clause === undefined || !clause.trim().startsWith("{")) {
      found.push(match[0]);
      continue;
    }
    for (const name of FORBIDDEN) {
      if (new RegExp(`\\b${name}\\b`).test(clause)) found.push(name);
    }
  }
  return found;
}

/**
 * Functions that open (or, for logout, delete) the real profile themselves.
 * No test may reference them at all. Names are built from parts so this file
 * does not trip its own scan.
 */
const PROFILE_ENTRY_POINTS = [
  ["scrape", "Location"],
  ["auth", "StatusCommand"],
  ["auth", "LoginCommand"],
  ["auth", "LogoutCommand"],
  ["scrape", "Command"],
  ["batch", "Command"],
].map((parts) => parts.join(""));

/** Profile-opening entry points a test source refers to. */
export function profileEntryPointUses(source: string): string[] {
  return PROFILE_ENTRY_POINTS.filter((name) => new RegExp(`\\b${name}\\b`).test(source));
}

describe("browser-profile import guard", () => {
  it("finds no test file that refers to a profile-opening entry point", () => {
    expect(profileEntryPointUses(`await ${PROFILE_ENTRY_POINTS[3]}();`)).toEqual([PROFILE_ENTRY_POINTS[3]]);
    expect(profileEntryPointUses("navigateWithAuthFallback(page, deps)")).toEqual([]);
    const files = readdirSync(TESTS_DIR, { recursive: true, encoding: "utf8" }).filter((f) =>
      f.endsWith(".ts"),
    );
    const offenders = files.flatMap((f) =>
      profileEntryPointUses(readFileSync(join(TESTS_DIR, f), "utf8")).map((h) => `${f}: ${h}`),
    );
    expect(offenders).toEqual([]);
  });

  it("detects the forbidden import shapes", () => {
    // Specifier built from parts so this file's own samples do not trip the scan below.
    const mod = (prefix: string, ext = ".js") => `${prefix}scraper/${"browser"}${ext}`;
    expect(forbiddenBrowserImports(`import { launchBrowser } from "${mod("../src/")}";`)).toEqual([
      "launchBrowser",
    ]);
    expect(
      forbiddenBrowserImports(`import {\n  closeBrowser,\n  PROFILE_DIR,\n} from '${mod("../../src/", "")}'`),
    ).toEqual(["PROFILE_DIR"]);
    expect(forbiddenBrowserImports(`import * as b from "${mod("../src/")}";`)).toHaveLength(1);
    expect(forbiddenBrowserImports(`await import("${mod("../src/")}")`)).toHaveLength(1);
    expect(
      forbiddenBrowserImports(`import { clearVolatileBrowserState } from "${mod("../src/")}";`),
    ).toEqual([]);
    expect(forbiddenBrowserImports("// never import `launchBrowser` from src/scraper/browser.ts")).toEqual([]);
  });

  it("finds no test file importing launchBrowser or PROFILE_DIR", () => {
    const files = readdirSync(TESTS_DIR, { recursive: true, encoding: "utf8" }).filter((f) =>
      f.endsWith(".ts"),
    );
    // Recursive: the browser tests and their harness are scanned too.
    expect(files).toContain(join("browser", "harness.ts"));
    const offenders = files.flatMap((f) => {
      const hits = forbiddenBrowserImports(readFileSync(join(TESTS_DIR, f), "utf8"));
      return hits.map((h) => `${relative(TESTS_DIR, join(TESTS_DIR, f))}: ${h}`);
    });
    expect(offenders).toEqual([]);
  });
});
