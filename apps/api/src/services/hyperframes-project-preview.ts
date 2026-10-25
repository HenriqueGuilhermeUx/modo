import type { VideoProject } from "@modo/contracts/video";
import {
  buildHyperframesPilot,
  type HyperframesPilotInput,
} from "./hyperframes-pilot.js";

/**
 * Read-only export of an already tenant-authorized video project.
 * A prototype must not silently drop media, voice, transitions, motion,
 * timeline gaps or text; incompatible projects stay on the existing Remotion renderer.
 */
export function exportVideoProjectHyperframesPreview(
  project: VideoProject,
  brandName: string,
) {
  if (!project || project.scenes.length < 1 || project.scenes.length > 8) {
    throw new Error("HYPERFRAMES_UNSUPPORTED_SCENE_COUNT");
  }
  if (project.aspectRatio !== "9:16" || project.fps !== 30 ||
      project.voiceover || project.voiceProvider) {
    throw new Error("HYPERFRAMES_UNSUPPORTED_PROJECT_FEATURE");
  }
  let expectedStart = 0;
  const scenes: HyperframesPilotInput["scenes"] = project.scenes.map((scene) => {
    if (!Number.isInteger(scene.startFrame) || !Number.isInteger(scene.endFrame) ||
        scene.startFrame !== expectedStart || scene.endFrame <= expectedStart) {
      throw new Error("HYPERFRAMES_UNSUPPORTED_TIMELINE");
    }
    if (scene.visualType !== "kinetic_text" || scene.assetSource !== "native" ||
        scene.imageUrl || scene.videoUrl || scene.motion !== "static" ||
        (scene.transition && scene.transition !== "cut")) {
      throw new Error("HYPERFRAMES_UNSUPPORTED_MEDIA_OR_TRANSITION");
    }
    if (scene.headline.length > 180 || scene.caption.length > 280) {
      throw new Error("HYPERFRAMES_UNSUPPORTED_TEXT_LENGTH");
    }
    const durationSeconds = (scene.endFrame - scene.startFrame) / project.fps;
    if (durationSeconds < 1 || durationSeconds > 12) {
      throw new Error("HYPERFRAMES_UNSUPPORTED_SCENE_DURATION");
    }
    expectedStart = scene.endFrame;
    return {
      headline: scene.headline,
      caption: scene.caption,
      durationSeconds: Number(durationSeconds.toFixed(3)),
    };
  });
  const preview = buildHyperframesPilot({
    brandName,
    accentColor: "#2ED19A",
    format: "reel",
    scenes,
  });
  return {
    projectId: project.id,
    organizationId: project.organizationId,
    ...preview,
    publishingAllowed: false as const,
    assetRenderingEnabled: false as const,
    unsupportedRemotionFeaturesExcluded: false as const,
  };
}
