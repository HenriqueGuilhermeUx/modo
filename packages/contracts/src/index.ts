import { z } from "zod";

export const NicheSchema = z.enum([
  "saude_estetica",
  "servicos_profissionais",
  "imoveis",
  "varejo",
  "educacao",
  "creator",
  "outro",
]);

export type Niche = z.infer<typeof NicheSchema>;

export const nicheLabels: Record<Niche, string> = {
  saude_estetica: "Saúde & Estética",
  servicos_profissionais: "Serviços profissionais",
  imoveis: "Imóveis",
  varejo: "Varejo & E-commerce",
  educacao: "Educação",
  creator: "Creator & Marca pessoal",
  outro: "Outro segmento",
};

export const DiagnosticCreateRequestSchema = z.object({
  websiteUrl: z.string().url().max(500),
  niche: NicheSchema,
  instagramHandle: z.string().trim().max(80).optional().default(""),
});
export type DiagnosticCreateRequest = z.infer<typeof DiagnosticCreateRequestSchema>;

export const CampaignSchema = z.object({
  id: z.string(),
  objective: z.enum(["autoridade", "leads", "conexao"]),
  eyebrow: z.string(),
  title: z.string(),
  visualDirection: z.string(),
  caption: z.string(),
  hashtags: z.array(z.string()),
  cta: z.string(),
});
export type Campaign = z.infer<typeof CampaignSchema>;

export const DiagnosticResultSchema = z.object({
  brandSummary: z.object({
    name: z.string(),
    segment: z.string(),
    primaryOffer: z.string(),
    audience: z.string(),
    positioning: z.string(),
  }),
  diagnosis: z.object({
    strength: z.string(),
    opportunity: z.string(),
    impact: z.string(),
    recommendation: z.string(),
  }),
  campaigns: z.array(CampaignSchema).length(3),
});
export type DiagnosticResult = z.infer<typeof DiagnosticResultSchema>;

export const DiagnosticStageSchema = z.enum([
  "queued",
  "validating",
  "extracting",
  "structuring",
  "generating",
  "completed",
  "failed",
]);
export type DiagnosticStage = z.infer<typeof DiagnosticStageSchema>;

export const DiagnosticJobSchema = z.object({
  id: z.string(),
  status: z.enum(["processing", "completed", "failed"]),
  progress: z.number().int().min(0).max(100),
  stage: DiagnosticStageSchema,
  result: DiagnosticResultSchema.optional(),
  error: z.string().optional(),
  createdAt: z.string(),
  completedAt: z.string().optional(),
});
export type DiagnosticJob = z.infer<typeof DiagnosticJobSchema>;

export const LeadCreateRequestSchema = z.object({
  diagnosticId: z.string().uuid(),
  name: z.string().trim().min(2).max(100),
  contact: z.string().trim().min(8).max(160),
  consent: z.literal(true),
});
export type LeadCreateRequest = z.infer<typeof LeadCreateRequestSchema>;

export const PlanSlugSchema = z.enum(["start", "presenca", "pro", "business"]);
export type PlanSlug = z.infer<typeof PlanSlugSchema>;

export const ContentUnitTypeSchema = z.enum([
  "static_post",
  "story",
  "carousel",
  "short_video_script",
  "channel_adaptation",
]);
export type ContentUnitType = z.infer<typeof ContentUnitTypeSchema>;

export const contentCreditCost: Record<ContentUnitType, number> = {
  static_post: 1,
  story: 1,
  carousel: 2,
  short_video_script: 2,
  channel_adaptation: 1,
};

export const PlanEntitlementSchema = z.object({
  priceCents: z.number().int().nonnegative(),
  monthlyCredits: z.number().int().positive(),
  maxBrands: z.number().int().positive(),
  maxChannels: z.number().int().positive(),
  maxUsers: z.number().int().positive(),
  maxCarouselsPerMonth: z.number().int().nonnegative(),
  maxShortVideoScriptsPerMonth: z.number().int().nonnegative(),
  includedRevisionCycles: z.number().int().nonnegative(),
  scheduling: z.boolean(),
  analytics: z.boolean(),
  customApprovalFlows: z.boolean(),
});
export type PlanEntitlement = z.infer<typeof PlanEntitlementSchema>;

export const planEntitlements: Record<PlanSlug, PlanEntitlement> = {
  start: {
    priceCents: 9900,
    monthlyCredits: 6,
    maxBrands: 1,
    maxChannels: 1,
    maxUsers: 1,
    maxCarouselsPerMonth: 2,
    maxShortVideoScriptsPerMonth: 0,
    includedRevisionCycles: 1,
    scheduling: false,
    analytics: false,
    customApprovalFlows: false,
  },
  presenca: {
    priceCents: 19900,
    monthlyCredits: 15,
    maxBrands: 1,
    maxChannels: 2,
    maxUsers: 1,
    maxCarouselsPerMonth: 5,
    maxShortVideoScriptsPerMonth: 2,
    includedRevisionCycles: 2,
    scheduling: true,
    analytics: false,
    customApprovalFlows: false,
  },
  pro: {
    priceCents: 39900,
    monthlyCredits: 30,
    maxBrands: 2,
    maxChannels: 4,
    maxUsers: 3,
    maxCarouselsPerMonth: 10,
    maxShortVideoScriptsPerMonth: 6,
    includedRevisionCycles: 3,
    scheduling: true,
    analytics: true,
    customApprovalFlows: false,
  },
  business: {
    priceCents: 79000,
    monthlyCredits: 60,
    maxBrands: 4,
    maxChannels: 8,
    maxUsers: 8,
    maxCarouselsPerMonth: 12,
    maxShortVideoScriptsPerMonth: 12,
    includedRevisionCycles: 3,
    scheduling: true,
    analytics: true,
    customApprovalFlows: true,
  },
};

export const PlanSelectionSchema = z.object({
  plan: PlanSlugSchema,
});
export type PlanSelection = z.infer<typeof PlanSelectionSchema>;
