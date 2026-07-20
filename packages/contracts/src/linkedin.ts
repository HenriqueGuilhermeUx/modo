import { z } from "zod";

export const LinkedInAuthorTypeSchema = z.enum(["member", "organization"]);
export type LinkedInAuthorType = z.infer<typeof LinkedInAuthorTypeSchema>;

export const LinkedInConnectRequestSchema = z.object({
  authorType: LinkedInAuthorTypeSchema.default("member"),
  organizationUrn: z
    .string()
    .trim()
    .regex(/^urn:li:organization:\d+$/, "Informe uma URN de organização válida.")
    .optional(),
  organizationName: z.string().trim().min(2).max(160).optional(),
}).superRefine((value, context) => {
  if (value.authorType === "organization" && !value.organizationUrn) {
    context.addIssue({
      code: "custom",
      path: ["organizationUrn"],
      message: "Informe a URN da página da empresa.",
    });
  }
});
export type LinkedInConnectRequest = z.infer<typeof LinkedInConnectRequestSchema>;

export const LinkedInConnectResponseSchema = z.object({
  authorizationUrl: z.string().url(),
});
export type LinkedInConnectResponse = z.infer<typeof LinkedInConnectResponseSchema>;

export const LinkedInConnectionStatusSchema = z.object({
  provider: z.literal("linkedin"),
  integrationConfigured: z.boolean(),
  connected: z.boolean(),
  authorType: LinkedInAuthorTypeSchema.nullable(),
  authorUrn: z.string().nullable(),
  displayName: z.string().nullable(),
  expiresAt: z.string().datetime().nullable(),
  scopes: z.array(z.string()),
  canPublishText: z.boolean(),
  canPublishDocuments: z.boolean(),
  message: z.string(),
});
export type LinkedInConnectionStatus = z.infer<typeof LinkedInConnectionStatusSchema>;

export const LinkedInPublicationStatusSchema = z.enum([
  "draft",
  "scheduled",
  "publishing",
  "published",
  "failed",
  "manual",
]);
export type LinkedInPublicationStatus = z.infer<typeof LinkedInPublicationStatusSchema>;

export const LinkedInPublishRequestSchema = z.object({
  contentRequestId: z.string().uuid(),
  scheduledFor: z.string().datetime().optional(),
});
export type LinkedInPublishRequest = z.infer<typeof LinkedInPublishRequestSchema>;

export const LinkedInPublicationSchema = z.object({
  id: z.string().uuid(),
  contentRequestId: z.string().uuid(),
  status: LinkedInPublicationStatusSchema,
  scheduledFor: z.string().datetime().nullable(),
  publishedAt: z.string().datetime().nullable(),
  postUrn: z.string().nullable(),
  error: z.string().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type LinkedInPublication = z.infer<typeof LinkedInPublicationSchema>;

export const LinkedInPublicationListSchema = z.object({
  publications: z.array(LinkedInPublicationSchema),
});
export type LinkedInPublicationList = z.infer<typeof LinkedInPublicationListSchema>;
