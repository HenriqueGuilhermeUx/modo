import { z } from "zod";

export const VideoDurationSecondsSchema = z.union([
  z.literal(15),
  z.literal(30),
  z.literal(45),
]);
export type VideoDurationSeconds = z.infer<typeof VideoDurationSecondsSchema>;

export const VideoAspectRatioSchema = z.literal("9:16");
export type VideoAspectRatio = z.infer<typeof VideoAspectRatioSchema>;

export const VideoRenderStatusSchema = z.enum([
  "queued",
  "rendering",
  "ready",
  "failed",
  "cancelled",
]);
export type VideoRenderStatus = z.infer<typeof VideoRenderStatusSchema>;

export const VideoApprovalStatusSchema = z.enum(["pending", "approved"]);
export type VideoApprovalStatus = z.infer<typeof VideoApprovalStatusSchema>;

export const VideoSceneReviewStatusSchema = z.enum(["pending", "approved"]);
export type VideoSceneReviewStatus = z.infer<typeof VideoSceneReviewStatusSchema>;

export const VideoSceneReviewSchema = z.object({
  sceneIndex: z.number().int().min(1).max(12),
  status: VideoSceneReviewStatusSchema,
  reviewedAt: z.string().datetime().nullable(),
});
export type VideoSceneReview = z.infer<typeof VideoSceneReviewSchema>;

export const VideoProjectReviewSchema = z.object({
  approvalStatus: VideoApprovalStatusSchema,
  approvedAt: z.string().datetime().nullable(),
  scenes: z.array(VideoSceneReviewSchema).max(12),
});
export type VideoProjectReview = z.infer<typeof VideoProjectReviewSchema>;

export const VideoSceneVisualTypeSchema = z.enum([
  "brand_asset",
  "generated_image",
  "broll_video",
  "interface",
  "data_card",
  "kinetic_text",
]);
export type VideoSceneVisualType = z.infer<typeof VideoSceneVisualTypeSchema>;

export const VideoSceneMotionSchema = z.enum([
  "push_in",
  "zoom_out",
  "pan_left",
  "pan_right",
  "static",
]);
export type VideoSceneMotion = z.infer<typeof VideoSceneMotionSchema>;

export const VideoSceneTransitionSchema = z.enum([
  "cut",
  "fade",
  "slide",
  "zoom",
]);
export type VideoSceneTransition = z.infer<typeof VideoSceneTransitionSchema>;

export const VideoScenePaceSchema = z.enum([
  "calm",
  "balanced",
  "energetic",
]);
export type VideoScenePace = z.infer<typeof VideoScenePaceSchema>;

export const VideoSoundtrackStyleSchema = z.enum([
  "ambient",
  "pulse",
  "cinematic",
]);
export type VideoSoundtrackStyle = z.infer<typeof VideoSoundtrackStyleSchema>;

export const VideoSceneAssetSourceSchema = z.enum([
  "content",
  "generated",
  "stock",
  "native",
]);
export type VideoSceneAssetSource = z.infer<typeof VideoSceneAssetSourceSchema>;

export const VideoSceneStockCreditSchema = z.object({
  provider: z.literal("pexels"),
  authorName: z.string().trim().min(1).max(160),
  authorUrl: z.string().url().max(2000),
  sourceUrl: z.string().url().max(2000),
});
export type VideoSceneStockCredit = z.infer<typeof VideoSceneStockCreditSchema>;

export const VideoSceneSchema = z.object({
  index: z.number().int().min(1).max(12),
  startFrame: z.number().int().nonnegative(),
  endFrame: z.number().int().positive(),
  headline: z.string().trim().min(1).max(300),
  visual: z.string().trim().min(1).max(800),
  caption: z.string().trim().min(1).max(900),
  imageUrl: z.string().url().max(2000).nullable(),
  videoUrl: z.string().url().max(2000).nullable().default(null),
  visualType: VideoSceneVisualTypeSchema.default("kinetic_text"),
  motion: VideoSceneMotionSchema.default("push_in"),
  transition: VideoSceneTransitionSchema.default("fade"),
  pace: VideoScenePaceSchema.default("balanced"),
  assetSource: VideoSceneAssetSourceSchema.default("native"),
  assetRevision: z.number().int().nonnegative().default(0),
  visualPrompt: z.string().trim().max(1600).nullable().default(null),
  stockQuery: z.string().trim().max(240).nullable().default(null),
  stockCredit: VideoSceneStockCreditSchema.nullable().default(null),
});
export type VideoScene = z.infer<typeof VideoSceneSchema>;

export const VideoSceneModeSchema = z.enum([
  "auto",
  "generated_image",
  "broll_video",
  "interface",
  "data_card",
  "kinetic_text",
]);
export type VideoSceneMode = z.infer<typeof VideoSceneModeSchema>;

export const VideoSceneUpdateSchema = z
  .object({
    headline: z.string().trim().min(1).max(300).optional(),
    visual: z.string().trim().min(1).max(800).optional(),
    caption: z.string().trim().min(1).max(900).optional(),
    visualPrompt: z.string().trim().min(1).max(1600).optional(),
    stockQuery: z.string().trim().min(1).max(240).optional(),
    visualMode: VideoSceneModeSchema.optional(),
    motion: VideoSceneMotionSchema.optional(),
    transition: VideoSceneTransitionSchema.optional(),
    pace: VideoScenePaceSchema.optional(),
  })
  .refine((value) => Object.values(value).some((item) => item !== undefined), {
    message: "Informe ao menos uma alteração para a cena.",
  });
export type VideoSceneUpdate = z.infer<typeof VideoSceneUpdateSchema>;

export const VideoProjectCreateSchema = z.object({
  contentRequestId: z.string().uuid(),
  durationSeconds: VideoDurationSecondsSchema.default(30),
  captions: z.boolean().default(true),
  voiceover: z.boolean().default(false),
  soundtrackEnabled: z.boolean().default(true),
  soundtrackStyle: VideoSoundtrackStyleSchema.default("pulse"),
  soundtrackVolume: z.number().min(0).max(0.3).default(0.12),
});
export type VideoProjectCreate = z.infer<typeof VideoProjectCreateSchema>;

export const VideoProjectAudiovisualUpdateSchema = z
  .object({
    soundtrackEnabled: z.boolean().optional(),
    soundtrackStyle: VideoSoundtrackStyleSchema.optional(),
    soundtrackVolume: z.number().min(0).max(0.3).optional(),
  })
  .refine((value) => Object.values(value).some((item) => item !== undefined), {
    message: "Informe ao menos um ajuste audiovisual.",
  });
export type VideoProjectAudiovisualUpdate = z.infer<typeof VideoProjectAudiovisualUpdateSchema>;

export const VideoProjectSchema = z.object({
  id: z.string().uuid(),
  organizationId: z.string(),
  brandId: z.string().uuid(),
  contentRequestId: z.string().uuid(),
  durationSeconds: VideoDurationSecondsSchema,
  aspectRatio: VideoAspectRatioSchema,
  fps: z.literal(30),
  captions: z.boolean(),
  voiceover: z.boolean().default(false),
  voiceProvider: z.enum(["openai"]).nullable().default(null),
  visualProvider: z.enum(["openai"]).nullable().default(null),
  brollProvider: z.enum(["pexels"]).nullable().default(null),
  soundtrackEnabled: z.boolean().default(false),
  soundtrackStyle: VideoSoundtrackStyleSchema.default("pulse"),
  soundtrackVolume: z.number().min(0).max(0.3).default(0.12),
  status: VideoRenderStatusSchema,
  review: VideoProjectReviewSchema.optional(),
  renderer: z.literal("remotion"),
  scenes: z.array(VideoSceneSchema).min(1).max(12),
  outputUrl: z.string().url().nullable(),
  mimeType: z.literal("video/mp4").nullable(),
  error: z.string().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type VideoProject = z.infer<typeof VideoProjectSchema>;

export const VideoProjectListSchema = z.object({
  projects: z.array(VideoProjectSchema),
});
export type VideoProjectList = z.infer<typeof VideoProjectListSchema>;
