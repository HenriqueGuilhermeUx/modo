import { z } from "zod";
import { ContentUnitTypeSchema } from "./index.js";

export const ContentObjectiveSchema = z.enum([
  "autoridade",
  "demanda",
  "relacionamento",
  "conversao",
  "educacao",
]);
export type ContentObjective = z.infer<typeof ContentObjectiveSchema>;

export const ContentRequestStatusSchema = z.enum([
  "queued",
  "processing",
  "ready",
  "approved",
  "revision_requested",
  "failed",
  "cancelled",
]);
export type ContentRequestStatus = z.infer<typeof ContentRequestStatusSchema>;

export const ContentRequestCreateSchema = z.object({
  brandId: z.string().uuid(),
  contentType: ContentUnitTypeSchema,
  objective: ContentObjectiveSchema,
  brief: z.string().trim().min(10).max(2000),
  channel: z.string().trim().min(2).max(60).default("Instagram"),
});
export type ContentRequestCreate = z.infer<typeof ContentRequestCreateSchema>;

export const ContentSlideSchema = z.object({
  title: z.string().trim().min(1).max(180),
  body: z.string().trim().min(1).max(700),
});

export const ContentScriptSceneSchema = z.object({
  scene: z.string().trim().min(1).max(120),
  visual: z.string().trim().min(1).max(500),
  voiceover: z.string().trim().min(1).max(700),
});

export const ContentStoryFrameSchema = z.object({
  headline: z.string().trim().min(1).max(180),
  body: z.string().trim().min(1).max(500),
  interaction: z.string().trim().max(180).default(""),
});

export const GeneratedContentSchema = z.object({
  hook: z.string().trim().min(1).max(300),
  title: z.string().trim().min(1).max(220),
  caption: z.string().trim().min(1).max(5000),
  cta: z.string().trim().min(1).max(300),
  hashtags: z.array(z.string().trim().min(1).max(80)).max(15),
  visualDirection: z.string().trim().min(1).max(1500),
  slides: z.array(ContentSlideSchema).max(12).default([]),
  script: z.array(ContentScriptSceneSchema).max(12).default([]),
  storyFrames: z.array(ContentStoryFrameSchema).max(10).default([]),
  adaptationNotes: z.array(z.string().trim().min(1).max(500)).max(10).default([]),
});
export type GeneratedContent = z.infer<typeof GeneratedContentSchema>;

export const ContentGenerationCallbackSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("completed"),
    output: GeneratedContentSchema,
    providerRunId: z.string().trim().max(200).optional(),
  }),
  z.object({
    status: z.literal("failed"),
    error: z.string().trim().min(1).max(2000),
    providerRunId: z.string().trim().max(200).optional(),
  }),
]);
export type ContentGenerationCallback = z.infer<typeof ContentGenerationCallbackSchema>;

export const ContentRevisionRequestSchema = z.object({
  instructions: z.string().trim().min(5).max(1500),
});
export type ContentRevisionRequest = z.infer<typeof ContentRevisionRequestSchema>;

export const ContentRequestSchema = z.object({
  id: z.string().uuid(),
  organizationId: z.string(),
  brandId: z.string().uuid(),
  contentType: ContentUnitTypeSchema,
  objective: ContentObjectiveSchema,
  brief: z.string(),
  channel: z.string(),
  status: ContentRequestStatusSchema,
  creditsCharged: z.number().int().positive(),
  revisionCount: z.number().int().nonnegative(),
  maxRevisions: z.number().int().nonnegative(),
  revisionInstructions: z.string().nullable(),
  output: GeneratedContentSchema.nullable(),
  error: z.string().nullable(),
  providerRunId: z.string().nullable(),
  approvedAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type ContentRequest = z.infer<typeof ContentRequestSchema>;

export const ContentRequestListSchema = z.object({ requests: z.array(ContentRequestSchema) });
export type ContentRequestList = z.infer<typeof ContentRequestListSchema>;
