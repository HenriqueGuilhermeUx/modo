import { z } from "zod";

const ShortTextSchema = z.string().trim().min(2).max(180);
const OptionalUrlSchema = z.union([z.literal(""), z.string().url().max(1000)]).optional().default("");

export const IntelligencePlaybookSchema = z.enum([
  "market_radar",
  "b2b_prospecting",
  "price_monitoring",
]);
export type IntelligencePlaybook = z.infer<typeof IntelligencePlaybookSchema>;

export const IntelligenceProviderSchema = z.enum(["queue", "apify", "n8n"]);
export type IntelligenceProvider = z.infer<typeof IntelligenceProviderSchema>;

export const IntelligenceMissionStatusSchema = z.enum([
  "queued",
  "running",
  "succeeded",
  "failed",
]);
export type IntelligenceMissionStatus = z.infer<typeof IntelligenceMissionStatusSchema>;

export const IntelligenceProductSchema = z.object({
  name: ShortTextSchema,
  sku: z.string().trim().max(120).optional().default(""),
  url: OptionalUrlSchema,
});
export type IntelligenceProduct = z.infer<typeof IntelligenceProductSchema>;

export const IntelligenceMissionCreateSchema = z
  .object({
    brandId: z.string().trim().min(3).max(120),
    name: z.string().trim().min(3).max(140),
    playbook: IntelligencePlaybookSchema,
    objective: z.string().trim().min(3).max(1200),
    regions: z.array(ShortTextSchema).max(20).optional().default([]),
    keywords: z.array(ShortTextSchema).max(40).optional().default([]),
    competitors: z.array(z.string().trim().min(2).max(1000)).max(40).optional().default([]),
    products: z.array(IntelligenceProductSchema).max(200).optional().default([]),
    maxItems: z.number().int().min(1).max(5000).optional().default(100),
  })
  .superRefine((value, context) => {
    if (value.playbook === "b2b_prospecting") {
      if (value.keywords.length === 0) {
        context.addIssue({
          code: "custom",
          path: ["keywords"],
          message: "Informe ao menos um setor, perfil ou termo de busca para prospecção B2B.",
        });
      }
      if (value.regions.length !== 1) {
        context.addIssue({
          code: "custom",
          path: ["regions"],
          message: "Informe exatamente uma cidade, estado ou região por missão B2B.",
        });
      }
      if (value.maxItems > 500) {
        context.addIssue({
          code: "custom",
          path: ["maxItems"],
          message: "O piloto B2B aceita até 500 empresas por missão.",
        });
      }
    }
    if (value.playbook === "price_monitoring" && value.products.length === 0) {
      context.addIssue({
        code: "custom",
        path: ["products"],
        message: "Informe ao menos um produto para monitoramento de preços.",
      });
    }
    if (
      value.playbook === "market_radar" &&
      value.keywords.length === 0 &&
      value.competitors.length === 0
    ) {
      context.addIssue({
        code: "custom",
        path: ["keywords"],
        message: "Informe termos de mercado ou concorrentes para o radar.",
      });
    }
  });
export type IntelligenceMissionCreate = z.infer<typeof IntelligenceMissionCreateSchema>;

export const IntelligenceBrandContextSchema = z.object({
  id: z.string(),
  name: z.string(),
  niche: z.string().optional().default(""),
  websiteUrl: OptionalUrlSchema,
  instagramHandle: z.string().optional().default(""),
});
export type IntelligenceBrandContext = z.infer<typeof IntelligenceBrandContextSchema>;

export const IntelligenceResultItemSchema = z.record(z.string(), z.unknown());

export const IntelligenceMissionSchema = IntelligenceMissionCreateSchema.safeExtend({
  id: z.string().uuid(),
  organizationId: z.string(),
  userId: z.string(),
  provider: IntelligenceProviderSchema,
  status: IntelligenceMissionStatusSchema,
  taskId: z.string().optional().default(""),
  providerRunId: z.string().optional().default(""),
  providerDatasetId: z.string().optional().default(""),
  providerMessage: z.string().optional().default(""),
  resultCount: z.number().int().nonnegative().optional().default(0),
  resultPreview: z.array(IntelligenceResultItemSchema).max(100).optional().default([]),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type IntelligenceMission = z.infer<typeof IntelligenceMissionSchema>;

export const IntelligenceMissionListSchema = z.object({
  missions: z.array(IntelligenceMissionSchema),
});

export const IntelligenceCallbackSchema = z.object({
  status: z.enum(["completed", "failed"]),
  providerRunId: z.string().trim().max(200).optional().default(""),
  providerDatasetId: z.string().trim().max(200).optional().default(""),
  resultCount: z.number().int().nonnegative().optional().default(0),
  resultPreview: z.array(IntelligenceResultItemSchema).max(100).optional().default([]),
  error: z.string().trim().max(2000).optional().default(""),
});
export type IntelligenceCallback = z.infer<typeof IntelligenceCallbackSchema>;

export const intelligencePlaybookCatalog = {
  market_radar: {
    name: "Radar de mercado",
    promise: "Observa concorrentes, reputação, ofertas e sinais de demanda.",
  },
  b2b_prospecting: {
    name: "Prospecção B2B",
    promise: "Encontra e prioriza empresas por setor, região e sinais de oportunidade.",
  },
  price_monitoring: {
    name: "Monitoramento de preços",
    promise: "Acompanha produtos comparáveis, mudanças de preço e competitividade.",
  },
} as const satisfies Record<IntelligencePlaybook, { name: string; promise: string }>;
