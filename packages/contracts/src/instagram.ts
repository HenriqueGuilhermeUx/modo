import { z } from "zod";

export const InstagramConnectionStatusSchema = z.object({
  provider: z.literal("instagram"),
  integrationConfigured: z.boolean(),
  connected: z.boolean(),
  brandId: z.string().uuid().nullable(),
  instagramUsername: z.string().nullable(),
  expiresAt: z.string().datetime().nullable(),
  scopes: z.array(z.string()),
  message: z.string(),
});
export type InstagramConnectionStatus = z.infer<typeof InstagramConnectionStatusSchema>;

export const InstagramConnectRequestSchema = z.object({
  brandId: z.string().uuid().optional(),
});
export type InstagramConnectRequest = z.infer<typeof InstagramConnectRequestSchema>;

export const InstagramConnectResponseSchema = z.object({
  authorizationUrl: z.string().url(),
});
export type InstagramConnectResponse = z.infer<typeof InstagramConnectResponseSchema>;

export const InstagramPublicationSchema = z.object({
  provider: z.literal("instagram"),
  contentRequestId: z.string().uuid().nullable(),
  creationId: z.string(),
  mediaId: z.string(),
  instagramUserId: z.string(),
  instagramUsername: z.string(),
  permalink: z.string().url().nullable(),
  publishedAt: z.string().datetime(),
});
export type InstagramPublication = z.infer<typeof InstagramPublicationSchema>;

export const InstagramDataDeletionResponseSchema = z.object({
  url: z.string().url(),
  confirmation_code: z.string().min(8),
});
export type InstagramDataDeletionResponse = z.infer<typeof InstagramDataDeletionResponseSchema>;
