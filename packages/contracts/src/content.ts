import { z } from "zod";
import { ContentUnitTypeSchema } from "./index.js";

export const ContentObjectiveSchema = z.enum(["autoridade", "demanda", "relacionamento", "conversao", "educacao"]);
export type ContentObjective = z.infer<typeof ContentObjectiveSchema>;

export const ContentRequestStatusSchema = z.enum(["queued", "processing", "ready", "failed", "cancelled"]);
export type ContentRequestStatus = z.infer<typeof ContentRequestStatusSchema>;

export const ContentRequestCreateSchema = z.object({
  brandId: z.string().uuid(),
  contentType: ContentUnitTypeSchema,
  objective: ContentObjectiveSchema,
  brief: z.string().trim().min(10).max(2000),
  channel: z.string().trim().min(2).max(60).default("Instagram"),
});
export type ContentRequestCreate = z.infer<typeof ContentRequestCreateSchema>;

export const ContentRequestSchema = z.object({
  id: z.string().uuid(), organizationId: z.string(), brandId: z.string().uuid(),
  contentType: ContentUnitTypeSchema, objective: ContentObjectiveSchema,
  brief: z.string(), channel: z.string(), status: ContentRequestStatusSchema,
  creditsCharged: z.number().int().positive(),
  output: z.record(z.string(), z.unknown()).nullable(), error: z.string().nullable(),
  createdAt: z.string().datetime(), updatedAt: z.string().datetime(),
});
export type ContentRequest = z.infer<typeof ContentRequestSchema>;

export const ContentRequestListSchema = z.object({ requests: z.array(ContentRequestSchema) });
export type ContentRequestList = z.infer<typeof ContentRequestListSchema>;
