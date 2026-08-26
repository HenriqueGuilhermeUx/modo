import { z } from "zod";

const TextListSchema = z.array(z.string().trim().min(1).max(240)).max(20).default([]);
const LongTextSchema = z.string().trim().max(4000).default("");

export const BrandFoundationSchema = z.object({
  audience: z.object({
    priority: LongTextSchema,
    context: LongTextSchema,
    pains: TextListSchema,
    desires: TextListSchema,
    objections: TextListSchema,
    decisionTriggers: TextListSchema,
  }),
  worldview: z.object({
    belief: LongTextSchema,
    marketProblem: LongTextSchema,
    desiredChange: LongTextSchema,
  }),
  positioning: z.object({
    category: LongTextSchema,
    differentiator: LongTextSchema,
    forWhom: LongTextSchema,
    notForWhom: LongTextSchema,
    territory: LongTextSchema,
  }),
  promise: z.object({
    transformation: LongTextSchema,
    mainBenefit: LongTextSchema,
    boundaries: LongTextSchema,
  }),
  personality: z.object({
    attributes: TextListSchema,
    tone: LongTextSchema,
    preferredWords: TextListSchema,
    prohibitedWords: TextListSchema,
    visualStyle: LongTextSchema,
  }),
  proof: z.object({
    origin: LongTextSchema,
    cases: TextListSchema,
    numbers: TextListSchema,
    testimonials: TextListSchema,
  }),
  universe: z.object({
    environments: TextListSchema,
    people: TextListSchema,
    objects: TextListSchema,
    themes: TextListSchema,
    visualReferences: TextListSchema,
  }),
  humanPresence: z.object({
    spokespersons: TextListSchema,
    team: TextListSchema,
    customers: TextListSchema,
    cameraAvailability: z.enum(["none", "low", "medium", "high"]).default("low"),
    notes: LongTextSchema,
  }),
});

export const BrandFoundationUpsertSchema = z.object({
  brandId: z.string().uuid(),
  foundation: BrandFoundationSchema,
  status: z.enum(["draft", "complete"]).default("draft"),
});

export const BrandFoundationProfileSchema = BrandFoundationUpsertSchema.extend({
  organizationId: z.string(),
  updatedAt: z.string().datetime(),
});

export const ChannelPlanItemSchema = z.object({
  channel: z.enum(["instagram", "facebook", "linkedin", "tiktok", "youtube", "whatsapp", "email", "blog", "other"]),
  role: z.string().trim().max(500).default(""),
  primaryObjective: z.string().trim().max(500).default(""),
  audience: z.string().trim().max(1000).default(""),
  contentPillars: TextListSchema,
  formats: TextListSchema,
  ctaTypes: TextListSchema,
  primaryKpi: z.string().trim().max(300).default(""),
  cadence: z.string().trim().max(300).default(""),
  notes: LongTextSchema,
});

export const ChannelMapUpsertSchema = z.object({
  brandId: z.string().uuid(),
  channels: z.array(ChannelPlanItemSchema).max(12),
  status: z.enum(["draft", "complete"]).default("draft"),
});

export const ChannelMapSchema = ChannelMapUpsertSchema.extend({
  organizationId: z.string(),
  updatedAt: z.string().datetime(),
});

export const RevenueMapUpsertSchema = z.object({
  brandId: z.string().uuid(),
  primaryOffer: LongTextSchema,
  priceContext: z.string().trim().max(500).default(""),
  revenueObjective: LongTextSchema,
  funnelStage: z.enum(["awareness", "consideration", "lead", "opportunity", "sale", "retention"]).default("lead"),
  conversionDestination: z.string().trim().max(1000).default(""),
  targetAudience: LongTextSchema,
  primaryConversion: z.string().trim().max(500).default(""),
  salesOwner: z.string().trim().max(300).default(""),
  monthlyBudgetCents: z.number().int().nonnegative().nullable().default(null),
  targetLeads: z.number().int().nonnegative().nullable().default(null),
  targetSales: z.number().int().nonnegative().nullable().default(null),
  notes: LongTextSchema,
  status: z.enum(["draft", "complete"]).default("draft"),
});

export const RevenueMapSchema = RevenueMapUpsertSchema.extend({
  organizationId: z.string(),
  updatedAt: z.string().datetime(),
});

export const HumanSupportTypeSchema = z.enum([
  "strategy",
  "art_direction",
  "copywriting",
  "design",
  "motion",
  "video_editing",
  "paid_media",
  "campaign_review",
  "full_management",
  "other",
]);

export const HumanSupportRequestCreateSchema = z.object({
  brandId: z.string().uuid(),
  contentRequestId: z.string().uuid().optional().nullable(),
  type: HumanSupportTypeSchema,
  context: z.string().trim().min(20).max(5000),
  desiredOutcome: z.string().trim().max(2000).default(""),
  urgency: z.enum(["normal", "priority"]).default("normal"),
});

export const HumanSupportRequestSchema = HumanSupportRequestCreateSchema.extend({
  id: z.string().uuid(),
  organizationId: z.string(),
  userId: z.string().uuid(),
  status: z.enum(["requested", "triage", "proposal", "in_progress", "completed", "declined"]),
  pricingStatus: z.enum(["under_review", "proposal_required", "included", "not_available"]),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export const SpecialistRoleSchema = z.enum([
  "strategist",
  "art_director",
  "copywriter",
  "designer",
  "creative",
  "motion_designer",
  "video_editor",
  "paid_media_specialist",
  "account_manager",
  "other",
]);

export const SpecialistApplicationCreateSchema = z.object({
  name: z.string().trim().min(2).max(120),
  email: z.string().trim().toLowerCase().email().max(180),
  whatsapp: z.string().trim().max(40).default(""),
  city: z.string().trim().max(120).default(""),
  primaryRole: SpecialistRoleSchema,
  secondaryRoles: z.array(SpecialistRoleSchema).max(6).default([]),
  experienceYears: z.number().int().min(0).max(60),
  portfolioUrl: z.string().url().max(500),
  linkedinUrl: z.string().url().max(500).optional().or(z.literal("")),
  availability: z.enum(["project", "part_time", "recurring", "full_time_interest"]),
  engagementPreference: z.enum(["freelance", "partner", "contractor", "open"]),
  about: z.string().trim().min(40).max(5000),
  consent: z.literal(true),
});

export const SpecialistApplicationSchema = SpecialistApplicationCreateSchema.extend({
  id: z.string().uuid(),
  status: z.enum(["received", "under_review", "approved", "talent_pool", "declined"]),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export const PartnerBusinessTypeSchema = z.enum([
  "agency",
  "social_media",
  "paid_media",
  "consultancy",
  "production_company",
  "freelancer",
  "other",
]);

export const PartnerApplicationCreateSchema = z.object({
  name: z.string().trim().min(2).max(120),
  email: z.string().trim().toLowerCase().email().max(180),
  whatsapp: z.string().trim().min(8).max(40),
  companyName: z.string().trim().min(2).max(160),
  city: z.string().trim().max(120).default(""),
  websiteUrl: z.string().url().max(500).optional().or(z.literal("")),
  instagramUrl: z.string().url().max(500).optional().or(z.literal("")),
  businessType: PartnerBusinessTypeSchema,
  activeClients: z.number().int().min(0).max(10000),
  monthlyServiceRevenueCents: z.number().int().nonnegative().nullable().default(null),
  currentServices: z.array(z.string().trim().min(2).max(120)).min(1).max(12),
  whyPartner: z.string().trim().min(40).max(4000),
  targetClientsWithModo: z.number().int().min(1).max(1000),
  consent: z.literal(true),
});

export const PartnerApplicationSchema = PartnerApplicationCreateSchema.extend({
  id: z.string().uuid(),
  status: z.enum(["received", "under_review", "interview", "approved", "waitlist", "declined"]),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type BrandFoundation = z.infer<typeof BrandFoundationSchema>;
export type BrandFoundationUpsert = z.infer<typeof BrandFoundationUpsertSchema>;
export type BrandFoundationProfile = z.infer<typeof BrandFoundationProfileSchema>;
export type ChannelPlanItem = z.infer<typeof ChannelPlanItemSchema>;
export type ChannelMapUpsert = z.infer<typeof ChannelMapUpsertSchema>;
export type ChannelMap = z.infer<typeof ChannelMapSchema>;
export type RevenueMapUpsert = z.infer<typeof RevenueMapUpsertSchema>;
export type RevenueMap = z.infer<typeof RevenueMapSchema>;
export type HumanSupportType = z.infer<typeof HumanSupportTypeSchema>;
export type HumanSupportRequestCreate = z.infer<typeof HumanSupportRequestCreateSchema>;
export type HumanSupportRequest = z.infer<typeof HumanSupportRequestSchema>;
export type SpecialistRole = z.infer<typeof SpecialistRoleSchema>;
export type SpecialistApplicationCreate = z.infer<typeof SpecialistApplicationCreateSchema>;
export type SpecialistApplication = z.infer<typeof SpecialistApplicationSchema>;
export type PartnerBusinessType = z.infer<typeof PartnerBusinessTypeSchema>;
export type PartnerApplicationCreate = z.infer<typeof PartnerApplicationCreateSchema>;
export type PartnerApplication = z.infer<typeof PartnerApplicationSchema>;
