import { z } from "zod";

export const SourceExtractRequestSchema = z.object({
  url: z.string().trim().url().max(2000),
});
export type SourceExtractRequest = z.infer<typeof SourceExtractRequestSchema>;

export const SourceExtractResponseSchema = z.object({
  sourceUrl: z.string().url(),
  title: z.string().max(300),
  text: z.string().max(20000),
  wordCount: z.number().int().nonnegative(),
});
export type SourceExtractResponse = z.infer<typeof SourceExtractResponseSchema>;

export const QuickStartSourceKindSchema = z.enum([
  "ideas",
  "topic",
  "url",
  "text",
  "transcript",
  "voice",
]);
export type QuickStartSourceKind = z.infer<typeof QuickStartSourceKindSchema>;

export const QuickStartOutcomeSchema = z.enum([
  "decide",
  "post",
  "carousel",
  "video",
  "linkedin",
  "week",
  "campaign",
]);
export type QuickStartOutcome = z.infer<typeof QuickStartOutcomeSchema>;
