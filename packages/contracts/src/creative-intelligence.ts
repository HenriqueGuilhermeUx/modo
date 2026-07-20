import { z } from "zod";
import { ContentObjectiveSchema } from "./content.js";

export const CreativeChannelSchema = z.enum([
  "instagram",
  "facebook",
  "linkedin",
  "reels",
  "stories",
  "youtube_shorts",
  "blog",
  "email",
  "website",
]);
export type CreativeChannel = z.infer<typeof CreativeChannelSchema>;

export const CreativeRecommendationKindSchema = z.enum([
  "create",
  "capture",
  "campaign",
  "repurpose",
]);
export type CreativeRecommendationKind = z.infer<typeof CreativeRecommendationKindSchema>;

export const CreativeRecommendationStatusSchema = z.enum([
  "suggested",
  "accepted",
  "dismissed",
  "completed",
]);
export type CreativeRecommendationStatus = z.infer<typeof CreativeRecommendationStatusSchema>;

export const CreativeProfileSchema = z.object({
  accountId: z.string(),
  brandId: z.string().uuid(),
  peopleAvailable: z.array(z.string().trim().min(2).max(120)).max(20),
  comfortableOnCamera: z.boolean(),
  weeklyMinutesAvailable: z.number().int().min(0).max(600),
  locations: z.array(z.string().trim().min(2).max(180)).max(20),
  productsOrServicesToShow: z.array(z.string().trim().min(2).max(180)).max(30),
  proofAvailable: z.array(z.string().trim().min(2).max(240)).max(30),
  recurringQuestions: z.array(z.string().trim().min(2).max(300)).max(30),
  currentPriorities: z.array(z.string().trim().min(2).max(240)).max(15),
  prohibitedTopics: z.array(z.string().trim().min(2).max(240)).max(20),
  preferredChannels: z.array(CreativeChannelSchema).min(1).max(9),
  notes: z.string().trim().max(3000),
  updatedAt: z.string().datetime(),
});
export type CreativeProfile = z.infer<typeof CreativeProfileSchema>;

export const CreativeProfileUpsertSchema = CreativeProfileSchema.omit({
  accountId: true,
  updatedAt: true,
}).partial({
  peopleAvailable: true,
  comfortableOnCamera: true,
  weeklyMinutesAvailable: true,
  locations: true,
  productsOrServicesToShow: true,
  proofAvailable: true,
  recurringQuestions: true,
  currentPriorities: true,
  prohibitedTopics: true,
  preferredChannels: true,
  notes: true,
}).extend({ brandId: z.string().uuid() });
export type CreativeProfileUpsert = z.infer<typeof CreativeProfileUpsertSchema>;

export const CaptureMissionSchema = z.object({
  person: z.string(),
  estimatedMinutes: z.number().int().min(1).max(180),
  location: z.string(),
  duration: z.string(),
  framing: z.string(),
  openingLine: z.string(),
  structure: z.array(z.string()).min(1).max(10),
  bRoll: z.array(z.string()).max(10),
  checklist: z.array(z.string()).min(1).max(12),
});
export type CaptureMission = z.infer<typeof CaptureMissionSchema>;

export const CreativeRecommendationSchema = z.object({
  id: z.string().uuid(),
  accountId: z.string(),
  brandId: z.string().uuid(),
  kind: CreativeRecommendationKindSchema,
  status: CreativeRecommendationStatusSchema,
  title: z.string(),
  rationale: z.string(),
  objective: ContentObjectiveSchema,
  channels: z.array(CreativeChannelSchema).min(1),
  effortMinutes: z.number().int().min(1).max(600),
  expectedOutcome: z.string(),
  brief: z.string(),
  captureMission: CaptureMissionSchema.nullable(),
  derivativeAssets: z.array(z.string()).max(15),
  priorityScore: z.number().int().min(0).max(100),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type CreativeRecommendation = z.infer<typeof CreativeRecommendationSchema>;

export const CreativeRecommendationListSchema = z.object({
  recommendations: z.array(CreativeRecommendationSchema),
});

export const CreativePlanSchema = z.object({
  brandId: z.string().uuid(),
  headline: z.string(),
  rationale: z.string(),
  recommendations: z.array(CreativeRecommendationSchema),
  generatedAt: z.string().datetime(),
});
export type CreativePlan = z.infer<typeof CreativePlanSchema>;

export const CreativeFeedbackSchema = z.object({
  recommendationId: z.string().uuid().optional(),
  contentRequestId: z.string().uuid().optional(),
  signal: z.enum([
    "accepted",
    "dismissed",
    "approved",
    "revision_requested",
    "published",
    "performed_well",
    "performed_poorly",
  ]),
  score: z.number().min(0).max(100).optional(),
  notes: z.string().trim().max(1500).optional(),
  metrics: z.record(z.string(), z.number()).optional(),
}).refine((value) => value.recommendationId || value.contentRequestId, {
  message: "Informe recommendationId ou contentRequestId.",
});
export type CreativeFeedback = z.infer<typeof CreativeFeedbackSchema>;
