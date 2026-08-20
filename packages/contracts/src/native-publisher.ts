import { z } from "zod";

export const NativeSocialPlatformSchema = z.enum([
  "instagram",
  "facebook",
  "threads",
  "linkedin",
]);
export type NativeSocialPlatform = z.infer<typeof NativeSocialPlatformSchema>;

export const NativeConnectionSchema = z.object({
  platform: NativeSocialPlatformSchema,
  brandId: z.string().uuid().nullable(),
  externalAccountId: z.string().nullable(),
  displayName: z.string().nullable(),
  pictureUrl: z.string().url().nullable(),
  connected: z.boolean(),
  configured: z.boolean(),
  canPublish: z.boolean(),
  expiresAt: z.string().datetime().nullable(),
  scopes: z.array(z.string()),
  message: z.string(),
});
export type NativeConnection = z.infer<typeof NativeConnectionSchema>;

export const NativeConnectionListSchema = z.object({
  connections: z.array(NativeConnectionSchema),
});
export type NativeConnectionList = z.infer<typeof NativeConnectionListSchema>;

export const NativePublishModeSchema = z.enum(["now", "schedule"]);
export type NativePublishMode = z.infer<typeof NativePublishModeSchema>;

export const NativePublicationStatusSchema = z.enum([
  "scheduled",
  "publishing",
  "retrying",
  "published",
  "failed",
  "cancelled",
]);
export type NativePublicationStatus = z.infer<typeof NativePublicationStatusSchema>;

export const NativeScheduleRequestSchema = z
  .object({
    contentRequestId: z.string().uuid(),
    platform: NativeSocialPlatformSchema,
    mode: NativePublishModeSchema.default("schedule"),
    scheduledFor: z.string().datetime().optional(),
  })
  .superRefine((value, context) => {
    if (value.mode === "schedule" && !value.scheduledFor) {
      context.addIssue({
        code: "custom",
        path: ["scheduledFor"],
        message: "Informe a data e hora do agendamento.",
      });
    }
  });
export type NativeScheduleRequest = z.infer<typeof NativeScheduleRequestSchema>;

export const NativePublicationSchema = z.object({
  id: z.string().uuid(),
  contentRequestId: z.string().uuid(),
  brandId: z.string().uuid(),
  platform: NativeSocialPlatformSchema,
  status: NativePublicationStatusSchema,
  scheduledFor: z.string().datetime(),
  publishedAt: z.string().datetime().nullable(),
  externalPostId: z.string().nullable(),
  releaseUrl: z.string().url().nullable(),
  attempts: z.number().int().nonnegative(),
  lastError: z.string().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type NativePublication = z.infer<typeof NativePublicationSchema>;

export const NativePublicationListSchema = z.object({
  publications: z.array(NativePublicationSchema),
});
export type NativePublicationList = z.infer<typeof NativePublicationListSchema>;

export const NativeAnalyticsMetricSchema = z.object({
  key: z.string(),
  label: z.string(),
  value: z.number(),
});
export type NativeAnalyticsMetric = z.infer<typeof NativeAnalyticsMetricSchema>;

export const NativeAnalyticsSummarySchema = z.object({
  publicationId: z.string().uuid(),
  platform: NativeSocialPlatformSchema,
  score: z.number().min(0).max(100),
  engagementRate: z.number().nonnegative().nullable(),
  metrics: z.array(NativeAnalyticsMetricSchema),
  normalized: z.record(z.string(), z.number()),
  learningSignal: z.enum(["performed_well", "performed_poorly", "neutral"]),
  collectedAt: z.string().datetime(),
});
export type NativeAnalyticsSummary = z.infer<typeof NativeAnalyticsSummarySchema>;

export const NativeCalendarItemSchema = NativePublicationSchema.extend({
  contentTitle: z.string(),
  channel: z.string(),
});
export type NativeCalendarItem = z.infer<typeof NativeCalendarItemSchema>;

export const NativeCalendarSchema = z.object({
  items: z.array(NativeCalendarItemSchema),
});
export type NativeCalendar = z.infer<typeof NativeCalendarSchema>;

export const NativeMetaConnectRequestSchema = z.object({
  brandId: z.string().uuid(),
});
export type NativeMetaConnectRequest = z.infer<typeof NativeMetaConnectRequestSchema>;

export const NativeMetaConnectResponseSchema = z.object({
  authorizationUrl: z.string().url(),
});
export type NativeMetaConnectResponse = z.infer<typeof NativeMetaConnectResponseSchema>;
