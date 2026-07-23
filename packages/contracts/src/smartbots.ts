import { z } from "zod";

const OptionalTextSchema = z.string().trim().max(4000).optional().default("");
const OptionalLinkSchema = z.union([z.literal(""), z.string().url().max(800)]).optional().default("");

export const SmartBotsIntakePayloadSchema = z.object({
  partner: z.literal("modo").default("modo"),
  plan: z.literal("presenca").default("presenca"),
  businessName: z.string().trim().min(2).max(180),
  ownerName: z.string().trim().min(2).max(140),
  email: z.string().trim().email().max(180),
  phone: z.string().trim().min(8).max(40),
  instagram: z.string().trim().max(120).optional().default(""),
  segment: z.string().trim().min(2).max(180),
  services: z.string().trim().min(3).max(5000),
  openingHours: OptionalTextSchema,
  faq: OptionalTextSchema,
  prices: OptionalTextSchema,
  welcomeMessage: z.string().trim().min(3).max(1200),
  googleReviewLink: OptionalLinkSchema,
  notes: OptionalTextSchema,
});
export type SmartBotsIntakePayload = z.infer<typeof SmartBotsIntakePayloadSchema>;

export const SmartBotsIntakeStatusSchema = z.enum([
  "submitted",
  "sent",
  "setup_in_progress",
  "ready",
  "failed",
]);
export type SmartBotsIntakeStatus = z.infer<typeof SmartBotsIntakeStatusSchema>;

export const SmartBotsIntakeSchema = SmartBotsIntakePayloadSchema.extend({
  id: z.string().uuid(),
  organizationId: z.string(),
  userId: z.string(),
  status: SmartBotsIntakeStatusSchema,
  providerMessage: z.string().optional().default(""),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type SmartBotsIntake = z.infer<typeof SmartBotsIntakeSchema>;

export const SmartBotsIntakeListSchema = z.object({
  intakes: z.array(SmartBotsIntakeSchema),
});
