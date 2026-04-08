import { writeFile } from "node:fs/promises";
import type { ScrapeResult } from "../core/schema.js";

export async function writeJson(
  result: ScrapeResult,
  outputPath: string | null,
): Promise<void> {
  const json = JSON.stringify(result, null, 2);

  if (outputPath) {
    await writeFile(outputPath, json, "utf-8");
  } else {
    process.stdout.write(json + "\n");
  }
}
