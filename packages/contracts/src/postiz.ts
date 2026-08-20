import { z } from "zod";

export const PostizPlatformSchema = z.enum([
  "instagram",
  "instagram-standalone",
  "facebook",
  "linkedin",
  "linkedin-page",
  "threads",
]);
export type PostizPlatform = z.infer<typeof PostizPlatformSchema>;

export const PostizIntegrationSchema = z.object({
  id: z.string().min(1),
  brandId: z.string().uuid().nullable(),
  name: z.string(),
  identifier: PostizPlatformSchema,
  profile: z.string().nullable(),
  picture: z.string().url().nullable(),
  disabled: z.boolean(),
  connectedAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type PostizIntegration = z.infer<typeof PostizIntegrationSchema>;

export const PostizStatusSchema = z.object({
  configured: z.boolean(),
  connected: z.boolean(),
  provider: z.literal("postiz"),
  integrations: z.array(PostizIntegrationSchema),
});
export type PostizStatus = z.infer<typeof PostizStatusSchema>;

export const PostizConnectRequestSchema = z.object({
  brandId: z.string().uuid(),
  platform: PostizPlatformSchema,
});
export type PostizConnectRequest = z.infer<typeof PostizConnectRequestSchema>;

export const PostizConnectResponseSchema = z.object({
  pendingId: z.string().uuid(),
  authorizationUrl: z.string().url(),
  expiresAt: z.string().datetime(),
});
export type PostizConnectResponse = z.infer<typeof PostizConnectResponseSchema>;

export const PostizClaimRequestSchema = z.object({
  pendingId: z.string().uuid(),
});
export type PostizClaimRequest = z.infer<typeof PostizClaimRequestSchema>;

export const PostizClaimResponseSchema = z.object({
  status: z.enum(["pending", "connected"]),
  integrations: z.array(PostizIntegrationSchema),
});
export type PostizClaimResponse = z.infer<typeof PostizClaimResponseSchema>;

export const PostizPublishModeSchema = z.enum(["now", "schedule", "draft"]);
export type PostizPublishMode = z.infer<typeof PostizPublishModeSchema>;

export const PostizPublishRequestSchema = z
  .object({
    integrationIds: z.array(z.string().min(1)).min(1).max(10),
    mode: PostizPublishModeSchema.default("schedule"),
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
export type PostizPublishRequest = z.infer<typeof PostizPublishRequestSchema>;

export const PostizPublicationStatusSchema = z.enum([
  "draft",
  "scheduled",
  "submitted",
  "published",
  "failed",
]);
export type PostizPublicationStatus = z.infer<typeof PostizPublicationStatusSchema>;

export const PostizPublicationSchema = z.object({
  id: z.string().uuid(),
  contentRequestId: z.string().uuid(),
  brandId: z.string().uuid(),
  integrationId: z.string(),
  platform: PostizPlatformSchema,
  postizPostId: z.string(),
  mode: PostizPublishModeSchema,
  status: PostizPublicationStatusSchema,
  scheduledFor: z.string().datetime().nullable(),
  releaseUrl: z.string().url().nullable(),
  publishedAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type PostizPublication = z.infer<typeof PostizPublicationSchema>;

export const PostizAnalyticsMetricSchema = z.object({
  label: z.string(),
  latest: z.number(),
  percentageChange: z.number().nullable(),
});
export type PostizAnalyticsMetric = z.infer<typeof PostizAnalyticsMetricSchema>;

export const PostizAnalyticsSummarySchema = z.object({
  publicationId: z.string().uuid(),
  postizPostId: z.string(),
  days: z.number().int().min(1).max(365),
  score: z.number().min(0).max(100),
  engagementRate: z.number().nonnegative().nullable(),
  metrics: z.array(PostizAnalyticsMetricSchema),
  normalized: z.record(z.string(), z.number()),
  learningSignal: z.enum(["performed_well", "performed_poorly", "neutral"]),
  collectedAt: z.string().datetime(),
});
export type PostizAnalyticsSummary = z.infer<typeof PostizAnalyticsSummarySchema>;

export const PostizPublicationListSchema = z.object({
  publications: z.array(PostizPublicationSchema),
});
