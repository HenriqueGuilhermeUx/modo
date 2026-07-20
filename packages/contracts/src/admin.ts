import { z } from "zod";
import {
  BillingUsageSchema,
  PlanSlugSchema,
  PublicPlanSlugSchema,
  SubscriptionStatusSchema,
} from "./index.js";

const AdminPasswordSchema = z.string().min(10).max(128);

export const AdminLoginRequestSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(180),
  password: AdminPasswordSchema,
});
export type AdminLoginRequest = z.infer<typeof AdminLoginRequestSchema>;

export const PlatformAdminSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  email: z.string().email(),
  createdAt: z.string().datetime(),
});
export type PlatformAdmin = z.infer<typeof PlatformAdminSchema>;

export const AdminSessionSchema = z.object({
  token: z.string().min(20),
  expiresAt: z.string().datetime(),
  admin: PlatformAdminSchema,
});
export type AdminSession = z.infer<typeof AdminSessionSchema>;

export const AdminOverviewSchema = z.object({
  users: z.number().int().nonnegative(),
  organizations: z.number().int().nonnegative(),
  activeSubscriptions: z.number().int().nonnegative(),
  trialSubscriptions: z.number().int().nonnegative(),
  suspendedSubscriptions: z.number().int().nonnegative(),
  contentRequests: z.number().int().nonnegative(),
  contentReady: z.number().int().nonnegative(),
  invitationsOpen: z.number().int().nonnegative(),
  discountCampaignsActive: z.number().int().nonnegative(),
  estimatedMrrCents: z.number().int().nonnegative(),
  paymentsReceived: z.number().int().nonnegative(),
});
export type AdminOverview = z.infer<typeof AdminOverviewSchema>;

export const AdminOrganizationSchema = z.object({
  id: z.string(),
  name: z.string(),
  ownerName: z.string(),
  ownerEmail: z.string().email(),
  plan: PlanSlugSchema,
  status: SubscriptionStatusSchema,
  creditsGranted: z.number().int(),
  creditsUsed: z.number().int().nonnegative(),
  creditsRemaining: z.number().int(),
  brands: z.number().int().nonnegative(),
  users: z.number().int().nonnegative(),
  contentRequests: z.number().int().nonnegative(),
  createdAt: z.string().datetime(),
});
export type AdminOrganization = z.infer<typeof AdminOrganizationSchema>;

export const AdminOrganizationListSchema = z.object({
  organizations: z.array(AdminOrganizationSchema),
});

export const AdminInvitationCreateSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(180),
  plan: PlanSlugSchema.default("trial"),
  bonusCredits: z.number().int().min(0).max(1000).default(0),
  expiresInDays: z.number().int().min(1).max(90).default(14),
  note: z.string().trim().max(500).optional().default(""),
});
export type AdminInvitationCreate = z.infer<typeof AdminInvitationCreateSchema>;

export const AdminInvitationSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  plan: PlanSlugSchema,
  bonusCredits: z.number().int().nonnegative(),
  note: z.string(),
  inviteUrl: z.string().url().optional(),
  status: z.enum(["open", "used", "expired", "revoked"]),
  expiresAt: z.string().datetime(),
  usedAt: z.string().datetime().nullable(),
  revokedAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
});
export type AdminInvitation = z.infer<typeof AdminInvitationSchema>;

export const AdminInvitationListSchema = z.object({
  invitations: z.array(AdminInvitationSchema),
});

export const InvitationPreviewSchema = z.object({
  email: z.string().email(),
  plan: PlanSlugSchema,
  bonusCredits: z.number().int().nonnegative(),
  expiresAt: z.string().datetime(),
  note: z.string(),
});
export type InvitationPreview = z.infer<typeof InvitationPreviewSchema>;

export const InvitationAcceptRequestSchema = z.object({
  name: z.string().trim().min(2).max(100),
  password: z.string().min(8).max(128).regex(/[A-Za-z]/).regex(/[0-9]/),
  organizationName: z.string().trim().min(2).max(120),
});
export type InvitationAcceptRequest = z.infer<typeof InvitationAcceptRequestSchema>;

export const DiscountKindSchema = z.enum(["percent", "fixed_cents"]);
export type DiscountKind = z.infer<typeof DiscountKindSchema>;

export const AdminDiscountCampaignCreateSchema = z.object({
  name: z.string().trim().min(2).max(120),
  code: z.string().trim().toUpperCase().min(3).max(32).regex(/^[A-Z0-9_-]+$/),
  kind: DiscountKindSchema,
  value: z.number().int().positive(),
  plans: z.array(PublicPlanSlugSchema).min(1).max(4),
  maxRedemptions: z.number().int().min(1).max(100000),
  startsAt: z.string().datetime(),
  endsAt: z.string().datetime(),
  active: z.boolean().default(true),
}).superRefine((value, context) => {
  if (value.kind === "percent" && value.value > 100) {
    context.addIssue({ code: "custom", path: ["value"], message: "Percentual máximo: 100%." });
  }
  if (new Date(value.endsAt) <= new Date(value.startsAt)) {
    context.addIssue({ code: "custom", path: ["endsAt"], message: "O término deve ser posterior ao início." });
  }
});
export type AdminDiscountCampaignCreate = z.infer<typeof AdminDiscountCampaignCreateSchema>;

export const AdminDiscountCampaignSchema = AdminDiscountCampaignCreateSchema.extend({
  id: z.string().uuid(),
  redemptions: z.number().int().nonnegative(),
  createdAt: z.string().datetime(),
});
export type AdminDiscountCampaign = z.infer<typeof AdminDiscountCampaignSchema>;

export const AdminDiscountCampaignListSchema = z.object({
  campaigns: z.array(AdminDiscountCampaignSchema),
});

export const AdminCreditAdjustmentSchema = z.object({
  credits: z.number().int().min(-1000).max(1000).refine((value) => value !== 0),
  reason: z.string().trim().min(3).max(300),
});
export type AdminCreditAdjustment = z.infer<typeof AdminCreditAdjustmentSchema>;

export const AdminSubscriptionUpdateSchema = z.object({
  plan: PlanSlugSchema.optional(),
  status: SubscriptionStatusSchema.optional(),
}).refine((value) => value.plan || value.status, {
  message: "Informe plano ou status.",
});
export type AdminSubscriptionUpdate = z.infer<typeof AdminSubscriptionUpdateSchema>;

export const AdminOrganizationUsageSchema = z.object({
  usage: BillingUsageSchema,
});

export const DiscountQuoteSchema = z.object({
  campaignId: z.string().uuid(),
  reservationId: z.string().uuid(),
  code: z.string(),
  originalPriceCents: z.number().int().nonnegative(),
  finalPriceCents: z.number().int().positive(),
  savedCents: z.number().int().nonnegative(),
});
export type DiscountQuote = z.infer<typeof DiscountQuoteSchema>;
