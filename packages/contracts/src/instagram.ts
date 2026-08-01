import { z } from "zod";

export const InstagramConnectResponseSchema = z.object({
  authorizationUrl: z.string().url(),
});
export type InstagramConnectResponse = z.infer<typeof InstagramConnectResponseSchema>;

export const InstagramConnectionStatusSchema = z.object({
  provider: z.literal("instagram"),
  integrationConfigured: z.boolean(),
  connected: z.boolean(),
  brandId: z.string().uuid().nullable(),
  instagramUserId: z.string().nullable(),
  username: z.string().nullable(),
  profilePictureUrl: z.string().url().nullable(),
  expiresAt: z.string().datetime().nullable(),
  scopes: z.array(z.string()),
  canPublish: z.boolean(),
  message: z.string(),
});
export type InstagramConnectionStatus = z.infer<typeof InstagramConnectionStatusSchema>;

export const InstagramPublishResultSchema = z.object({
  provider: z.literal("instagram"),
  contentRequestId: z.string().uuid(),
  creationId: z.string(),
  postId: z.string(),
  permalink: z.string().url().nullable(),
  publishedAt: z.string().datetime(),
});
export type InstagramPublishResult = z.infer<typeof InstagramPublishResultSchema>;

export const InstagramDataDeletionResponseSchema = z.object({
  url: z.string().url(),
  confirmation_code: z.string().min(8),
});
export type InstagramDataDeletionResponse = z.infer<typeof InstagramDataDeletionResponseSchema>;
