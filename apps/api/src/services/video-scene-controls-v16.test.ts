import type { ContentRequest, GeneratedContent } from "@modo/contracts/content";
import { describe, expect, it, vi } from "vitest";
import { planVideoScenes, VideoError, VideoService } from "./video-service.js";

const baseOutput: GeneratedContent = {
  hook: "Comece com direção.",
  title: "Direção audiovisual",
  caption: "Legenda do vídeo.",
  cta: "Planeje com a MODO.",
  hashtags: ["#MODO"],
  visualDirection: "Editorial vertical.",
  slides: [],
  storyFrames: [],
  adaptationNotes: [],
  imagePrompt: "",
  imageAlt: "Visual da marca",
  imageUrl: "https://example.com/brand.png",
  imageStatus: "generated",
  visualAssets: [],
  script: [
    { scene: "Abertura", visual: "Marca em composição editorial.", voiceover: "Uma abertura clara." },
    { scene: "Interface", visual: "Dashboard com indicadores em uma tela.", voiceover: "A informação aparece no momento certo." },
    { scene: "CTA", visual: "Marca e chamada final.", voiceover: "Planeje com direção." },
  ],
};

function humanOutput(): GeneratedContent {
  return {
    ...baseOutput,
    imageUrl: null,
    imageStatus: "not_requested",
    script: [
      { scene: "Pessoas", visual: "Empresária brasileira conversa com cliente em cafeteria.", voiceover: "Entenda pessoas primeiro." },
      { scene: "CTA", visual: "Marca e chamada final.", voiceover: "Planeje com direção." },
    ],
  };
}

function content(output: GeneratedContent = baseOutput): ContentRequest {
  const now = new Date().toISOString();
  return {
    id: "550e8400-e29b-41d4-a716-446655440091",
    organizationId: "organization-one",
    brandId: "550e8400-e29b-41d4-a716-446655440090",
    contentType: "short_video_script",
    objective: "autoridade",
    brief: "Vídeo com direção audiovisual.",
    channel: "Instagram",
    status: "ready",
    creditsCharged: 2,
    revisionCount: 0,
    maxRevisions: 2,
    revisionInstructions: null,
    output,
    error: null,
    providerRunId: null,
    approvedAt: null,
    createdAt: now,
    updatedAt: now,
  };
}

describe("MODO Video V1.6 scene controls", () => {
  it("planeja ritmo e transição sem remover a direção visual existente", () => {
    const scenes = planVideoScenes(baseOutput, 15);
    expect(scenes[0]).toMatchObject({ pace: "steady", transition: "cut" });
    expect(scenes[1]).toMatchObject({ visualType: "data_card", pace: "calm", transition: "fade" });
    expect(scenes[2]).toMatchObject({ visualType: "kinetic_text", pace: "dynamic", transition: "slide" });
  });

  it("ajusta apenas montagem sem consumir outro asset nem alterar revisão visual", async () => {
    const service = new VideoService({ publicApiUrl: "https://modo.example.com" });
    const created = await service.createProject({
      organizationId: "organization-one",
      content: content(),
      durationSeconds: 15,
      captions: true,
    });
    const before = structuredClone(created.scenes[0]);
    await service.cancel(created.id, "organization-one");

    const updated = await service.updateScene({
      id: created.id,
      organizationId: "organization-one",
      sceneIndex: 1,
      patch: { motion: "static", pace: "calm", transition: "zoom" },
    });

    expect(updated.scenes[0]).toMatchObject({
      motion: "static",
      pace: "calm",
      transition: "zoom",
      assetRevision: before.assetRevision,
      imageUrl: before.imageUrl,
      videoUrl: before.videoUrl,
    });
    expect(updated.scenes.slice(1)).toEqual(created.scenes.slice(1));
  });

  it("mantém histórico de B-roll com crédito e restaura take sem nova chamada ao Pexels", async () => {
    const fetchClip = vi.fn(async ({ revision }: { revision: number }) => ({
      provider: "pexels" as const,
      mimeType: "video/mp4" as const,
      data: Buffer.from(`clip:${revision}`),
      credit: {
        provider: "pexels" as const,
        authorName: `Criador ${revision}`,
        authorUrl: `https://www.pexels.com/@criador-${revision}`,
        sourceUrl: `https://www.pexels.com/video/${100 + revision}/`,
      },
    }));
    const service = new VideoService({
      publicApiUrl: "https://modo.example.com",
      brollProvider: { name: "pexels", fetchClip },
    });
    const created = await service.createProject({
      organizationId: "organization-one",
      content: content(humanOutput()),
      durationSeconds: 15,
      captions: true,
    });

    const initialRow = (service as any).memory.get(created.id);
    await (service as any).prepareVisualScenes(initialRow, "MODO");
    expect(fetchClip).toHaveBeenCalledTimes(1);
    await service.cancel(created.id, "organization-one");

    await service.regenerateScene({
      id: created.id,
      organizationId: "organization-one",
      sceneIndex: 1,
      brandName: "MODO",
    });
    expect(fetchClip).toHaveBeenCalledTimes(2);

    const takes = await service.listSceneTakes(created.id, "organization-one", 1);
    expect(takes).toHaveLength(2);
    expect(takes.map((take) => take.stockCredit?.authorName)).toEqual(["Criador 1", "Criador 0"]);
    expect(takes.every((take) => take.selectable)).toBe(true);
    expect(takes[0].active).toBe(true);

    await service.cancel(created.id, "organization-one");
    const restored = await service.selectSceneTake({
      id: created.id,
      organizationId: "organization-one",
      sceneIndex: 1,
      token: takes[1].token,
    });

    expect(fetchClip).toHaveBeenCalledTimes(2);
    expect(restored.scenes[0].videoUrl).toBe(takes[1].url);
    expect(restored.scenes[0].stockCredit?.authorName).toBe("Criador 0");
    expect(restored.scenes[0].assetRevision).toBeGreaterThanOrEqual(1);
  });

  it("não permite consultar ou restaurar takes de outra organização", async () => {
    const service = new VideoService({ publicApiUrl: "https://modo.example.com" });
    const created = await service.createProject({
      organizationId: "organization-one",
      content: content(),
      durationSeconds: 15,
      captions: true,
    });

    await expect(service.listSceneTakes(created.id, "organization-two", 1)).rejects.toMatchObject<Partial<VideoError>>({
      code: "VIDEO_PROJECT_NOT_FOUND",
    });
    await expect(service.selectSceneTake({
      id: created.id,
      organizationId: "organization-two",
      sceneIndex: 1,
      token: "550e8400-e29b-41d4-a716-446655440099",
    })).rejects.toMatchObject<Partial<VideoError>>({ code: "VIDEO_PROJECT_NOT_FOUND" });
  });
});
