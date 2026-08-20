import { z } from "zod";

export const NativePublisherProviderSchema = z.enum(["instagram", "facebook", "threads", "linkedin"]);
export type NativePublisherProvider = z.infer<typeof NativePublisherProviderSchema>;

export const NativePublisherModeSchema = z.enum(["now", "schedule", "draft"]);
export type NativePublisherMode = z.infer<typeof NativePublisherModeSchema>;

export const NativeConnectionSchema = z.object({
  id: z.string().uuid(),
  provider: NativePublisherProviderSchema,
  brandId: z.string().uuid(),
  providerAccountId: z.string(),
  displayName: z.string(),
  username: z.string().nullable(),
  profilePictureUrl: z.string().url().nullable(),
  scopes: z.array(z.string()),
  expiresAt: z.string().datetime().nullable(),
  connected: z.boolean(),
  canPublish: z.boolean(),
  canReadInsights: z.boolean(),
  metadata: z.record(z.string(), z.unknown()).default({}),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type NativeConnection = z.infer<typeof NativeConnectionSchema>;

export const NativePublicationStatusSchema = z.enum([
  "draft",
  "scheduled",
  "publishing",
  "published",
  "retrying",
  "failed",
  "cancelled",
]);
export type NativePublicationStatus = z.infer<typeof NativePublicationStatusSchema>;

export const NativePublicationCreateSchema = z.object({
  contentRequestId: z.string().uuid(),
  provider: NativePublisherProviderSchema,
  brandId: z.string().uuid(),
  connectionId: z.string().uuid().optional(),
  mode: NativePublisherModeSchema.default("now"),
  scheduledFor: z.string().datetime().optional(),
  idempotencyKey: z.string().min(8).max(240).optional(),
});
export type NativePublicationCreate = z.infer<typeof NativePublicationCreateSchema>;

export const NativePublicationSchema = z.object({
  id: z.string().uuid(),
  organizationId: z.string(),
  brandId: z.string().uuid(),
  contentRequestId: z.string().uuid(),
  provider: NativePublisherProviderSchema,
  connectionId: z.string().uuid(),
  status: NativePublicationStatusSchema,
  scheduledFor: z.string().datetime().nullable(),
  publishedAt: z.string().datetime().nullable(),
  providerPostId: z.string().nullable(),
  permalink: z.string().url().nullable(),
  attemptCount: z.number().int().nonnegative(),
  maxAttempts: z.number().int().positive(),
  nextAttemptAt: z.string().datetime().nullable(),
  lastError: z.string().nullable(),
  idempotencyKey: z.string(),
  qualityScore: z.number().min(0).max(100),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type NativePublication = z.infer<typeof NativePublicationSchema>;

export const NativeAnalyticsSnapshotSchema = z.object({
  id: z.string().uuid(),
  publicationId: z.string().uuid(),
  provider: NativePublisherProviderSchema,
  collectedAt: z.string().datetime(),
  metrics: z.record(z.string(), z.number()),
  score: z.number().min(0).max(100),
  learningSignal: z.enum(["performed_well", "performed_poorly", "neutral"]),
});
export type NativeAnalyticsSnapshot = z.infer<typeof NativeAnalyticsSnapshotSchema>;

export const NativeBrandInsightSchema = z.object({
  brandId: z.string().uuid(),
  periodDays: z.number().int().positive(),
  publishedCount: z.number().int().nonnegative(),
  scheduledCount: z.number().int().nonnegative(),
  failedCount: z.number().int().nonnegative(),
  averageQualityScore: z.number().min(0).max(100),
  averagePerformanceScore: z.number().min(0).max(100),
  topProvider: NativePublisherProviderSchema.nullable(),
  topPublicationId: z.string().uuid().nullable(),
  recommendation: z.string(),
  generatedAt: z.string().datetime(),
});
export type NativeBrandInsight = z.infer<typeof NativeBrandInsightSchema>;

export const NativeCalendarItemSchema = z.object({
  publicationId: z.string().uuid(),
  contentRequestId: z.string().uuid(),
  provider: NativePublisherProviderSchema,
  status: NativePublicationStatusSchema,
  scheduledFor: z.string().datetime().nullable(),
  publishedAt: z.string().datetime().nullable(),
  title: z.string(),
});
export type NativeCalendarItem = z.infer<typeof NativeCalendarItemSchema>;

export const NativeProviderConnectSchema = z.object({ brandId: z.string().uuid() });
export type NativeProviderConnect = z.infer<typeof NativeProviderConnectSchema>;
