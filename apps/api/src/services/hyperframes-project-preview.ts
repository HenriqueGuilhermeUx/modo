import type { VideoProject } from "@modo/contracts/video";
import {
  buildHyperframesPilot,
  type HyperframesPilotInput,
} from "./hyperframes-pilot.js";

/**
 * Read-only export of an existing MODO video project. Does not persist or
 * publish, and uses the already authorized project selected by the route.
 */
export function exportVideoProjectHyperframesPreview(
  project: VideoProject,
  brandName: string,
) {
  if (!project.scenes.length || project.scenes.length > 8) {
    throw new Error("HYPERFRAMES_UNSUPPORTED_SCENE_COUNT");
  }
  const scenes: HyperframesPilotInput["scenes"] = project.scenes.map((scene) => {
    const durationSeconds = (scene.endFrame - scene.startFrame) / project.fps;
    if (durationSeconds < 1 || durationSeconds > 12) {
      throw new Error("HYPERFRAMES_UNSUPPORTED_SCENE_DURATION");
    }
    return {
      headline: scene.headline.slice(0, 180),
      caption: scene.caption.slice(0, 280),
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
  };
}
