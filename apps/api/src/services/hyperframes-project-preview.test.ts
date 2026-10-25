import { describe, expect, it } from "vitest";
import type { VideoProject } from "@modo/contracts/video";
import { exportVideoProjectHyperframesPreview } from "./hyperframes-project-preview.js";

const sample = (): VideoProject => ({
  id: "11111111-1111-4111-8111-111111111111",
  organizationId: "organization-x",
  brandId: "22222222-2222-4222-8222-222222222222",
  contentRequestId: "33333333-3333-4333-8333-333333333333",
  durationSeconds: 15,
  aspectRatio: "9:16",
  fps: 30,
  captions: true,
  voiceover: false,
  voiceProvider: null,
  visualProvider: null,
  brollProvider: null,
  status: "ready",
  renderer: "remotion",
  scenes: [{
    index: 1, startFrame: 0, endFrame: 150,
    headline: "Presença que converte",
    caption: "Primeiro corte de marca",
    visual: "Brand gradient",
    imageUrl: null,
    videoUrl: null,
    visualType: "kinetic_text",
    motion: "static",
    assetSource: "native",
    assetRevision: 0,
    visualPrompt: null,
    stockQuery: null,
    stockCredit: null,
  }],
  outputUrl: null, mimeType: null, error: null,
  createdAt: "2026-10-25T18:00:00.000Z",
  updatedAt: "2026-10-25T18:00:00.000Z",
});

describe("MODO project to HyperFrames preview", () => {
  it("keeps tenant identity, exports from original scenes, never publishes", () => {
    const output = exportVideoProjectHyperframesPreview(sample(), "Marca Teste");
    expect(output.organizationId).toBe("organization-x");
    expect(output.projectId).toBe(sample().id);
    expect(output.durationSeconds).toBe(5);
    expect(output.html).toContain("Presença que converte");
    expect(output.publishingAllowed).toBe(false);
  });
  it("rejects timelines that cannot be represented without distortion", () => {
    const project = sample();
    project.scenes[0].endFrame = 450;
    expect(() => exportVideoProjectHyperframesPreview(project, "Marca")).toThrow(/UNSUPPORTED_SCENE_DURATION/);
    project.scenes = Array.from({length: 9}, (_, i) => ({...sample().scenes[0], index: i + 1 }));
    expect(() => exportVideoProjectHyperframesPreview(project, "Marca")).toThrow(/UNSUPPORTED_SCENE_COUNT/);
  });
});
