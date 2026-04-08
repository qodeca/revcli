import { z } from "zod";
import { createHash } from "node:crypto";

export const SORT_ORDERS = ["newest", "relevant", "highest", "lowest"] as const;
export type SortOrder = (typeof SORT_ORDERS)[number];

export const OUTPUT_FORMATS = ["json", "csv"] as const;
export type OutputFormat = (typeof OUTPUT_FORMATS)[number];

export const OwnerResponseSchema = z.object({
  text: z.string().nullable(),
  originalText: z.string().nullable(),
  originalLanguage: z.string().nullable(),
  publishTime: z.string().nullable(),
});

export const ReviewSchema = z.object({
  id: z.string(),
  author: z.string(),
  authorUrl: z.string().nullable(),
  publishTime: z.string(),
  rating: z.number().int().min(0).max(5),
  text: z.string().nullable(),
  originalText: z.string().nullable(),
  originalLanguage: z.string().nullable(),
  photos: z.number().int().min(0),
  ownerResponse: OwnerResponseSchema.nullable(),
});

export const BusinessSchema = z.object({
  name: z.string(),
  placeId: z.string().nullable(),
  url: z.string(),
  address: z.string().nullable(),
  rating: z.number().nullable(),
  totalReviews: z.number().int().nullable(),
  scrapeDate: z.string(),
});

export const MetadataSchema = z.object({
  provider: z.enum(["playwright"]),
  scrapeDurationMs: z.number(),
  reviewsCollected: z.number().int(),
  sortOrder: z.enum(SORT_ORDERS),
});

export const ScrapeResultSchema = z.object({
  business: BusinessSchema,
  reviews: z.array(ReviewSchema),
  metadata: MetadataSchema,
});

export type OwnerResponse = z.infer<typeof OwnerResponseSchema>;
export type Review = z.infer<typeof ReviewSchema>;
export type Business = z.infer<typeof BusinessSchema>;
export type ScrapeMetadata = z.infer<typeof MetadataSchema>;
export type ScrapeResult = z.infer<typeof ScrapeResultSchema>;

/**
 * Generate a fallback review ID when Google's data-review-id is unavailable.
 * NOTE: This hash is NOT stable across runs because publishTime is relative
 * (e.g., "2 weeks ago" becomes "3 weeks ago" next week).
 */
export function generateReviewId(
  author: string,
  publishTime: string,
  rating: number,
  textPrefix?: string,
): string {
  const input = `${author}|${publishTime}|${rating}|${textPrefix ?? ""}`;
  return createHash("sha256").update(input).digest("hex").slice(0, 16);
}
