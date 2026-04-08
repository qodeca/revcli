import { writeFile } from "node:fs/promises";
import type { ScrapeResult } from "../core/schema.js";

const CSV_HEADERS = [
  "business_name",
  "review_id",
  "author",
  "rating",
  "publish_time",
  "text",
  "original_text",
  "original_language",
  "photos",
  "owner_response_text",
  "owner_response_time",
];

function escapeCsv(value: string | null | undefined): string {
  if (value == null) return "";
  const str = String(value);
  if (str.includes(",") || str.includes('"') || str.includes("\n")) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export async function writeCsv(
  result: ScrapeResult,
  outputPath: string | null,
): Promise<void> {
  const rows = [CSV_HEADERS.join(",")];

  for (const review of result.reviews) {
    rows.push(
      [
        escapeCsv(result.business.name),
        escapeCsv(review.id),
        escapeCsv(review.author),
        String(review.rating),
        escapeCsv(review.publishTime),
        escapeCsv(review.text),
        escapeCsv(review.originalText),
        escapeCsv(review.originalLanguage),
        String(review.photos),
        escapeCsv(review.ownerResponse?.text),
        escapeCsv(review.ownerResponse?.publishTime),
      ].join(","),
    );
  }

  const csv = rows.join("\n") + "\n";

  if (outputPath) {
    await writeFile(outputPath, csv, "utf-8");
  } else {
    process.stdout.write(csv);
  }
}
