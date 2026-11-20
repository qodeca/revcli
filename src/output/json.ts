import { writeFileAtomic } from "./atomic.js";
import type { ScrapeResult } from "../core/schema.js";

export async function writeJson(
  result: ScrapeResult,
  outputPath: string | null,
): Promise<void> {
  const json = JSON.stringify(result, null, 2);

  if (outputPath) {
    await writeFileAtomic(outputPath, json);
  } else {
    process.stdout.write(json + "\n");
  }
}
