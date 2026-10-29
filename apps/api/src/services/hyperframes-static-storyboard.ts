import { createHash } from "node:crypto";
import type { VideoProject } from "@modo/contracts/video";
import { exportVideoProjectHyperframesPreview } from "./hyperframes-project-preview.js";

/**
 * Read-only, 30fps static-text storyboard for the *same supported subset*
 * accepted by MODO's existing HyperFrames preview. No provider execution,
 * publication, DB access or customer-input scheduling occurs here.
 *
 * All scene timings are INTEGRAL FRAMES, not rounded HTML seconds. This
 * avoids losing boundaries for 31-frame/37-frame scenes at 30fps.
 */
export function buildStaticStoryboardPlan(project: VideoProject, brandName: string) {
  // This preserves the canonical fail-closed feature gate: native, static,
  // cut-only, silent text scenes; no unsupported Remotion feature is dropped.
  const preview = exportVideoProjectHyperframesPreview(project, brandName);
  const scenes = project.scenes.map((scene, index) => ({
    selector: `#scene-${index + 1}`,
    startFrame: scene.startFrame,
    endFrame: scene.endFrame,
    frames: scene.endFrame - scene.startFrame,
    headline: scene.headline,
    caption: scene.caption,
  }));
  const totalFrames = scenes.reduce((sum, scene) => sum + scene.frames, 0);
  if (preview.fps !== 30 || preview.width !== 1080 ||
      preview.height !== 1920 || scenes.length === 0 ||
      totalFrames !== project.durationSeconds * 30 ||
      totalFrames < 30 || totalFrames > 1800 ||
      scenes.some(scene => !Number.isSafeInteger(scene.frames) || scene.frames < 30)) {
    throw new Error("HYPERFRAMES_STATIC_STORYBOARD_UNSUPPORTED_TIMING");
  }
  const digest = createHash("sha256")
    .update(JSON.stringify(["modo-static-storyboard-v1", preview.html, scenes, totalFrames]))
    .digest("hex");
  return {
    renderer: "cdp-ffmpeg-static-pilot" as const,
    inputType: "validated-modo-video-project" as const,
    html: preview.html,
    width: 1080 as const,
    height: 1920 as const,
    fps: 30 as const,
    totalFrames,
    scenes,
    planSha256: digest,
    previewOnly: true as const,
    publishingAllowed: false as const,
    // Preserve the commercial Remotion renderer: synthetic static text is
    // not pixel-equivalent, motion-equivalent or soundtrack-equivalent.
    remotionVisualParity: "not-equivalent" as const,
    remotionAudioParity: "not-equivalent" as const,
    replacesRemotion: false as const,
    // No tenant, project IDs, banking credentials or provider URLs are
    // included in the browser handoff. The calling scheduler is responsible
    // for authorization BEFORE constructing the plan.
  };
}
