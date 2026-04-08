import { readFile } from "node:fs/promises";
import { ScrapeResultSchema } from "../core/schema.js";
import { logger } from "../utils/logger.js";

export async function validateCommand(file: string): Promise<void> {
  let content: string;
  try {
    content = await readFile(file, "utf-8");
  } catch {
    logger.error(`Cannot read file: ${file}`);
    process.exitCode = 1;
    return;
  }

  let data: unknown;
  try {
    data = JSON.parse(content);
  } catch {
    logger.error("Invalid JSON");
    process.exitCode = 1;
    return;
  }

  const result = ScrapeResultSchema.safeParse(data);

  if (result.success) {
    logger.success(
      `Valid: ${result.data.business.name} – ${result.data.reviews.length} reviews`,
    );
  } else {
    logger.error("Validation failed:");
    for (const issue of result.error.issues) {
      logger.error(`  ${issue.path.join(".")}: ${issue.message}`);
    }
    process.exitCode = 1;
  }
}
