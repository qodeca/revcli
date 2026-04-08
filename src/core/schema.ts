import { z } from "zod";
import { createHash } from "node:crypto";

export const OwnerResponseSchema = z.object({
  text: z.string().nullable(),
  originalText: z.string().nullable(),
  originalLanguage: z.string().nullable(),
  publishTime: z.string(),
});

export const ReviewSchema = z.object({
  id: z.string(),
  author: z.string(),
  authorUrl: z.string().nullable(),
  publishTime: z.string(),
  publishTimestamp: z.string().nullable(),
  rating: z.number().int().min(1).max(5),
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
  provider: z.literal("playwright"),
  scrapeDurationMs: z.number(),
  reviewsCollected: z.number().int(),
  sortOrder: z.string(),
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

export function generateReviewId(
  author: string,
  publishTime: string,
  rating: number,
): string {
  const input = `${author}|${publishTime}|${rating}`;
  return createHash("sha256").update(input).digest("hex").slice(0, 12);
}
