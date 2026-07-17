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
