import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeFileAtomic } from "../src/output/atomic.js";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "revcli-atomic-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("writeFileAtomic (issue #33)", () => {
  it("writes the full content and leaves no temporary file", async () => {
    await writeFileAtomic(join(dir, "out.json"), '{"a":1}');
    expect(readFileSync(join(dir, "out.json"), "utf-8")).toBe('{"a":1}');
    expect(readdirSync(dir)).toEqual(["out.json"]);
  });

  it("replaces an existing file", async () => {
    await writeFileAtomic(join(dir, "out.json"), "old");
    await writeFileAtomic(join(dir, "out.json"), "new");
    expect(readFileSync(join(dir, "out.json"), "utf-8")).toBe("new");
  });

  it("leaves nothing behind when the write fails", async () => {
    await expect(writeFileAtomic(join(dir, "missing", "out.json"), "x")).rejects.toThrow();
    expect(readdirSync(dir)).toEqual([]);
  });

  it("removes its temporary file when the final rename fails", async () => {
    // A directory at the target path makes rename fail after the temp file exists.
    mkdirSync(join(dir, "out.json"));
    await expect(writeFileAtomic(join(dir, "out.json"), "x")).rejects.toThrow();
    expect(readdirSync(dir)).toEqual(["out.json"]);
  });
});
