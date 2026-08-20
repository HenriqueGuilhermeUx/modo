import { z } from "zod";

export const DistributionQualityCheckSchema = z.object({
  key: z.enum([
    "approval",
    "copy",
    "cta",
    "hashtags",
    "media",
    "brand_safety",
    "structure",
  ]),
  label: z.string(),
  score: z.number().int().min(0),
  maxScore: z.number().int().positive(),
  status: z.enum(["pass", "warning", "block"]),
  message: z.string(),
});
export type DistributionQualityCheck = z.infer<typeof DistributionQualityCheckSchema>;

export const DistributionQualityReportSchema = z.object({
  contentRequestId: z.string().uuid(),
  brandId: z.string().uuid(),
  score: z.number().int().min(0).max(100),
  status: z.enum(["recommended", "review", "blocked"]),
  publishAllowed: z.boolean(),
  blockers: z.array(z.string()),
  warnings: z.array(z.string()),
  checks: z.array(DistributionQualityCheckSchema),
  evaluatedAt: z.string().datetime(),
});
export type DistributionQualityReport = z.infer<typeof DistributionQualityReportSchema>;
