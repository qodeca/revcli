import type { ScrapeResult, OutputFormat } from "../core/schema.js";
import { writeJson } from "./json.js";
import { writeCsv } from "./csv.js";

export async function writeOutput(
  result: ScrapeResult,
  outputPath: string | null,
  format: OutputFormat,
): Promise<void> {
  if (format === "csv") {
    await writeCsv(result, outputPath);
  } else {
    await writeJson(result, outputPath);
  }
}
