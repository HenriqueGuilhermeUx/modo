import { z } from "zod";
import { CreativeChannelSchema } from "./creative-intelligence.js";

export const PerformanceSignalCreateSchema = z.object({
  brandId: z.string().uuid(),
  contentRequestId: z.string().uuid(),
  channel: CreativeChannelSchema,
  reach: z.number().int().nonnegative().default(0),
  impressions: z.number().int().nonnegative().default(0),
  engagements: z.number().int().nonnegative().default(0),
  clicks: z.number().int().nonnegative().default(0),
  leads: z.number().int().nonnegative().default(0),
  conversions: z.number().int().nonnegative().default(0),
  revenueCents: z.number().int().nonnegative().default(0),
  notes: z.string().trim().max(1500).optional().default(""),
});
export type PerformanceSignalCreate = z.infer<typeof PerformanceSignalCreateSchema>;

export const PerformanceSignalSchema = PerformanceSignalCreateSchema.extend({
  id: z.string().uuid(),
  accountId: z.string(),
  score: z.number().min(0).max(100),
  classification: z.enum(["performed_well", "performed_poorly"]),
  createdAt: z.string().datetime(),
});
export type PerformanceSignal = z.infer<typeof PerformanceSignalSchema>;

export const PerformanceChannelSummarySchema = z.object({
  channel: CreativeChannelSchema,
  items: z.number().int().nonnegative(),
  averageScore: z.number().min(0).max(100),
  reach: z.number().int().nonnegative(),
  impressions: z.number().int().nonnegative(),
  engagements: z.number().int().nonnegative(),
  clicks: z.number().int().nonnegative(),
  leads: z.number().int().nonnegative(),
  conversions: z.number().int().nonnegative(),
  revenueCents: z.number().int().nonnegative(),
});

export const PerformanceSummarySchema = z.object({
  brandId: z.string().uuid(),
  totalSignals: z.number().int().nonnegative(),
  averageScore: z.number().min(0).max(100),
  positiveSignals: z.number().int().nonnegative(),
  negativeSignals: z.number().int().nonnegative(),
  channels: z.array(PerformanceChannelSummarySchema),
  recent: z.array(PerformanceSignalSchema),
  insights: z.array(z.string()),
});
export type PerformanceSummary = z.infer<typeof PerformanceSummarySchema>;
