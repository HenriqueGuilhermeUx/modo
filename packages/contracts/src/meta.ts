import { z } from "zod";

export const MetaConnectResponseSchema = z.object({
  authorizationUrl: z.string().url(),
});
export type MetaConnectResponse = z.infer<typeof MetaConnectResponseSchema>;

export const MetaConnectionStatusSchema = z.object({
  provider: z.literal("instagram"),
  integrationConfigured: z.boolean(),
  connected: z.boolean(),
  instagramUserId: z.string().nullable(),
  username: z.string().nullable(),
  displayName: z.string().nullable(),
  accountType: z.string().nullable(),
  expiresAt: z.string().datetime().nullable(),
  scopes: z.array(z.string()),
  canReadProfile: z.boolean(),
  canReadInsights: z.boolean(),
  readOnly: z.literal(true),
  message: z.string(),
});
export type MetaConnectionStatus = z.infer<typeof MetaConnectionStatusSchema>;

export const MetaProfileSchema = z.object({
  id: z.string(),
  username: z.string(),
  name: z.string().nullable(),
  accountType: z.string().nullable(),
  profilePictureUrl: z.string().url().nullable(),
  followersCount: z.number().int().nonnegative().nullable(),
  followsCount: z.number().int().nonnegative().nullable(),
  mediaCount: z.number().int().nonnegative().nullable(),
  biography: z.string().nullable(),
  website: z.string().nullable(),
});
export type MetaProfile = z.infer<typeof MetaProfileSchema>;

export const MetaMetricSchema = z.object({
  name: z.string(),
  title: z.string(),
  value: z.number().nullable(),
  period: z.string().nullable(),
  endTime: z.string().nullable(),
});
export type MetaMetric = z.infer<typeof MetaMetricSchema>;

export const MetaMediaSchema = z.object({
  id: z.string(),
  caption: z.string().nullable(),
  mediaType: z.string(),
  mediaUrl: z.string().url().nullable(),
  thumbnailUrl: z.string().url().nullable(),
  permalink: z.string().url().nullable(),
  timestamp: z.string().nullable(),
  likeCount: z.number().int().nonnegative().nullable(),
  commentsCount: z.number().int().nonnegative().nullable(),
});
export type MetaMedia = z.infer<typeof MetaMediaSchema>;

export const MetaOverviewSchema = z.object({
  profile: MetaProfileSchema,
  metrics: z.array(MetaMetricSchema),
  recentMedia: z.array(MetaMediaSchema),
  warnings: z.array(z.string()),
  collectedAt: z.string().datetime(),
});
export type MetaOverview = z.infer<typeof MetaOverviewSchema>;
