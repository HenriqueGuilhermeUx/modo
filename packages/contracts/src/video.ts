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

export const VideoSceneAssetSourceSchema = z.enum([
  "content",
  "generated",
  "native",
]);
export type VideoSceneAssetSource = z.infer<typeof VideoSceneAssetSourceSchema>;

export const VideoSceneSchema = z.object({
  index: z.number().int().min(1).max(12),
  startFrame: z.number().int().nonnegative(),
  endFrame: z.number().int().positive(),
  headline: z.string().trim().min(1).max(300),
  visual: z.string().trim().min(1).max(800),
  caption: z.string().trim().min(1).max(900),
  imageUrl: z.string().url().max(2000).nullable(),
  visualType: VideoSceneVisualTypeSchema.default("kinetic_text"),
  motion: VideoSceneMotionSchema.default("push_in"),
  assetSource: VideoSceneAssetSourceSchema.default("native"),
  assetRevision: z.number().int().nonnegative().default(0),
  visualPrompt: z.string().trim().max(1600).nullable().default(null),
});
export type VideoScene = z.infer<typeof VideoSceneSchema>;

export const VideoProjectCreateSchema = z.object({
  contentRequestId: z.string().uuid(),
  durationSeconds: VideoDurationSecondsSchema.default(30),
  captions: z.boolean().default(true),
  voiceover: z.boolean().default(false),
});
export type VideoProjectCreate = z.infer<typeof VideoProjectCreateSchema>;

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
  status: VideoRenderStatusSchema,
  review: VideoProjectReviewSchema.default({ approvalStatus: "pending", approvedAt: null, scenes: [] }),
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
