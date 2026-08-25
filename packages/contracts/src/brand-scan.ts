import { z } from "zod";
import { NicheSchema } from "./index.js";
import { CreativeChannelSchema } from "./creative-intelligence.js";
import { BrandFoundationSchema } from "./strategy-network.js";

export const BrandScanRequestSchema = z.object({
  url: z.string().trim().url().max(500),
});
export type BrandScanRequest = z.infer<typeof BrandScanRequestSchema>;

export const BrandScanSourceTypeSchema = z.enum([
  "website_native",
  "website_apify",
  "instagram_apify",
]);
export type BrandScanSourceType = z.infer<typeof BrandScanSourceTypeSchema>;

export const BrandScanEvidenceSchema = z.object({
  field: z.string().trim().min(1).max(120),
  evidence: z.string().trim().min(1).max(500),
  sourceUrl: z.string().trim().url().max(1000),
});
export type BrandScanEvidence = z.infer<typeof BrandScanEvidenceSchema>;

export const BrandScanSuggestedProfileSchema = z.object({
  productsOrServicesToShow: z.array(z.string().trim().min(1).max(180)).max(20).default([]),
  proofAvailable: z.array(z.string().trim().min(1).max(240)).max(20).default([]),
  recurringQuestions: z.array(z.string().trim().min(1).max(300)).max(20).default([]),
  prohibitedTopics: z.array(z.string().trim().min(1).max(240)).max(20).default([]),
  preferredChannels: z.array(CreativeChannelSchema).max(9).default([]),
  suggestedPriorities: z.array(z.string().trim().min(1).max(240)).max(10).default([]),
});
export type BrandScanSuggestedProfile = z.infer<typeof BrandScanSuggestedProfileSchema>;

export const BrandScanResultSchema = z.object({
  sourceUrl: z.string().url(),
  sourceType: BrandScanSourceTypeSchema,
  brand: z.object({
    name: z.string().trim().min(1).max(120),
    niche: NicheSchema,
    websiteUrl: z.string().trim().max(500),
    instagramHandle: z.string().trim().max(80),
  }),
  foundation: BrandFoundationSchema,
  suggestedProfile: BrandScanSuggestedProfileSchema,
  evidence: z.array(BrandScanEvidenceSchema).max(20),
  needsConfirmation: z.array(z.string().trim().min(1).max(240)).max(20),
  warnings: z.array(z.string().trim().min(1).max(500)).max(10),
  pagesAnalyzed: z.array(z.object({
    sourceUrl: z.string().url(),
    title: z.string().trim().max(300),
  })).max(12),
  confidence: z.number().min(0).max(1),
});
export type BrandScanResult = z.infer<typeof BrandScanResultSchema>;
