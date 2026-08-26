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

export const VideoSceneSchema = z.object({
  index: z.number().int().min(1).max(12),
  startFrame: z.number().int().nonnegative(),
  endFrame: z.number().int().positive(),
  headline: z.string().trim().min(1).max(300),
  visual: z.string().trim().min(1).max(800),
  caption: z.string().trim().min(1).max(900),
  imageUrl: z.string().url().max(2000).nullable(),
});
export type VideoScene = z.infer<typeof VideoSceneSchema>;

export const VideoProjectCreateSchema = z.object({
  contentRequestId: z.string().uuid(),
  durationSeconds: VideoDurationSecondsSchema.default(30),
  captions: z.boolean().default(true),
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
  status: VideoRenderStatusSchema,
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
