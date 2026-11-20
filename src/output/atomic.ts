import { randomBytes } from "node:crypto";
import { rename, unlink, writeFile } from "node:fs/promises";

/**
 * Write a file so that it is either complete or not there: write a temporary
 * file next to it, then rename (atomic on the same file system). A stop
 * signal or crash mid-write leaves no half-written output (issue #33).
 *
 * The temporary name is random and opened with `wx` (fail if it exists), so
 * a link planted at a guessable name in a shared folder is never written
 * through.
 */
export async function writeFileAtomic(path: string, data: string): Promise<void> {
  const tmp = `${path}.${randomBytes(6).toString("hex")}.tmp`;
  try {
    await writeFile(tmp, data, { encoding: "utf-8", flag: "wx" });
    await rename(tmp, path);
  } catch (err) {
    await unlink(tmp).catch(() => {});
    throw err;
  }
}
