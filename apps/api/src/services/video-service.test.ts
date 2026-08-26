import type { ContentRequest, GeneratedContent } from "@modo/contracts/content";
import { describe, expect, it, vi } from "vitest";
import { planVideoScenes, VideoError, VideoService } from "./video-service.js";

const output: GeneratedContent = {
  hook: "Pare de publicar sem saber o que quer gerar.",
  title: "Conteúdo com direção",
  caption: "Uma legenda completa para acompanhar o vídeo.",
  cta: "Abra a MODO e planeje seu próximo movimento.",
  hashtags: ["#MODO"],
  visualDirection: "Visual editorial com contraste forte.",
  slides: [],
  storyFrames: [],
  adaptationNotes: [],
  imagePrompt: "",
  imageAlt: "Imagem contextual da marca",
  imageUrl: "https://example.com/hero.png",
  imageStatus: "generated",
  visualAssets: [],
  script: [
    { scene: "Problema", visual: "Empresário olhando várias abas abertas.", voiceover: "Publicar por publicar só aumenta o ruído." },
    { scene: "Virada", visual: "Tela muda para uma direção única.", voiceover: "Comece pela decisão de marketing." },
    { scene: "Método", visual: "Três passos aparecem na tela.", voiceover: "A MODO transforma estratégia em roteiro e execução." },
    { scene: "Prova", visual: "Conteúdos entram em uma agenda.", voiceover: "Você aprova, publica e aprende com o resultado." },
    { scene: "CTA", visual: "Marca e chamada final.", voiceover: "Faça seu próximo conteúdo com direção." },
    { scene: "Extra", visual: "Cena que deve ser cortada em 30 segundos.", voiceover: "Cena extra." },
  ],
};

function contentRequest(overrides: Partial<ContentRequest> = {}): ContentRequest {
  return {
    id: "550e8400-e29b-41d4-a716-446655440001",
    organizationId: "organization-one",
    brandId: "550e8400-e29b-41d4-a716-446655440000",
    contentType: "short_video_script",
    objective: "autoridade",
    brief: "Criar um vídeo curto sobre marketing com direção.",
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
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

function humanOutput(): GeneratedContent {
  return {
    ...output,
    imageUrl: null,
    imageStatus: "not_requested",
    script: [
      { scene: "Abertura", visual: "Empresária brasileira conversando com um cliente em uma cafeteria.", voiceover: "Estratégia começa entendendo pessoas." },
      { scene: "CTA", visual: "Marca e chamada final.", voiceover: "Planeje com direção." },
    ],
  };
}

describe("MODO Video", () => {
  it("monta um vídeo de 30s com no máximo cinco cenas e 900 frames", () => {
    const scenes = planVideoScenes(output, 30);
    expect(scenes).toHaveLength(5);
    expect(scenes[0].startFrame).toBe(0);
    expect(scenes.at(-1)?.endFrame).toBe(900);
    expect(scenes[0].headline).toBe(output.hook);
    expect(scenes.at(-1)?.headline).toBe(output.cta);
    expect(scenes[0].caption).toBe(output.script[0].voiceover);
  });

  it("escolhe tratamento visual por cena sem gerar imagem para tudo", () => {
    const scenes = planVideoScenes(output, 30);
    expect(scenes[0]).toMatchObject({
      visualType: "brand_asset",
      assetSource: "content",
      imageUrl: output.imageUrl,
    });
    expect(scenes[1]).toMatchObject({
      visualType: "interface",
      assetSource: "native",
      imageUrl: null,
    });
    expect(scenes[3]).toMatchObject({
      visualType: "interface",
      assetSource: "native",
    });
    expect(scenes.at(-1)).toMatchObject({
      visualType: "kinetic_text",
      assetSource: "native",
      imageUrl: null,
    });
  });

  it("classifica uma cena humana/editorial sem asset como B-roll controlado", () => {
    const editorial = planVideoScenes(humanOutput(), 15);
    expect(editorial[0]).toMatchObject({
      visualType: "broll_video",
      assetSource: "stock",
      imageUrl: null,
      videoUrl: null,
    });
    expect(editorial[0].stockQuery).toContain("Empresária brasileira");
    expect(editorial[1].visualType).toBe("kinetic_text");
  });

  it("reduz o storyboard para três cenas em 15 segundos", () => {
    const scenes = planVideoScenes(output, 15);
    expect(scenes).toHaveLength(3);
    expect(scenes.at(-1)?.endFrame).toBe(450);
  });

  it("exige um roteiro existente em vez de criar um segundo cérebro de conteúdo", () => {
    expect(() => planVideoScenes({ ...output, script: [] }, 30)).toThrowError(VideoError);
  });

  it("persiste o projeto, isola organização e permite cancelar a fila", async () => {
    const service = new VideoService();
    const project = await service.createProject({
      organizationId: "organization-one",
      content: contentRequest(),
      durationSeconds: 30,
      captions: true,
    });

    expect(project.status).toBe("queued");
    expect(project.aspectRatio).toBe("9:16");
    expect(project.renderer).toBe("remotion");
    expect(project.voiceover).toBe(false);
    expect(project.voiceProvider).toBeNull();
    expect(project.visualProvider).toBeNull();
    expect(project.brollProvider).toBeNull();
    expect((await service.latestForContent("organization-one", project.contentRequestId))?.id).toBe(project.id);
    expect(await service.latestForContent("organization-two", project.contentRequestId)).toBeNull();

    const cancelled = await service.cancel(project.id, "organization-one");
    expect(cancelled.status).toBe("cancelled");
  });

  it("persiste a escolha de narração quando existe provider configurado", async () => {
    const service = new VideoService({
      voiceProvider: {
        name: "openai",
        async synthesize() {
          return { provider: "openai", mimeType: "audio/mpeg", data: Buffer.from("audio") };
        },
      },
    });
    const project = await service.createProject({
      organizationId: "organization-one",
      content: contentRequest(),
      durationSeconds: 30,
      captions: true,
      voiceover: true,
    });

    expect(service.voice).toEqual({ available: true, provider: "openai" });
    expect(project.voiceover).toBe(true);
    expect(project.voiceProvider).toBe("openai");
  });

  it("cacheia a locução por cena e não chama TTS de novo num rerender visual", async () => {
    const synthesize = vi.fn(async ({ text }: { text: string }) => ({
      provider: "openai" as const,
      mimeType: "audio/mpeg" as const,
      data: Buffer.from(`audio:${text}`),
    }));
    const service = new VideoService({
      voiceProvider: { name: "openai", synthesize },
    });
    const project = await service.createProject({
      organizationId: "organization-one",
      content: contentRequest(),
      durationSeconds: 30,
      captions: true,
      voiceover: true,
    });
    const row = (service as any).memory.get(project.id);

    const first = await (service as any).renderScenes(row, "MODO");
    expect(synthesize).toHaveBeenCalledTimes(project.scenes.length);
    expect(first.scenes.every((scene: any) => typeof scene.audioUrl === "string" && scene.audioUrl.startsWith("data:audio/mpeg;base64,"))).toBe(true);

    const second = await (service as any).renderScenes(row, "MODO");
    expect(synthesize).toHaveBeenCalledTimes(project.scenes.length);
    expect(second.scenes.map((scene: any) => scene.audioUrl)).toEqual(first.scenes.map((scene: any) => scene.audioUrl));
  });

  it("ao editar a locução, invalida somente o áudio daquela cena", async () => {
    const synthesize = vi.fn(async ({ text }: { text: string }) => ({
      provider: "openai" as const,
      mimeType: "audio/mpeg" as const,
      data: Buffer.from(`audio:${text}`),
    }));
    const service = new VideoService({ voiceProvider: { name: "openai", synthesize } });
    const project = await service.createProject({
      organizationId: "organization-one",
      content: contentRequest(),
      durationSeconds: 30,
      captions: true,
      voiceover: true,
    });
    const initialRow = (service as any).memory.get(project.id);
    await (service as any).renderScenes(initialRow, "MODO");
    expect(synthesize).toHaveBeenCalledTimes(project.scenes.length);

    await service.cancel(project.id, "organization-one");
    const edited = await service.updateScene({
      id: project.id,
      organizationId: "organization-one",
      sceneIndex: 2,
      patch: { caption: "Uma locução revisada somente para esta cena." },
    });
    expect(edited.scenes[1].caption).toBe("Uma locução revisada somente para esta cena.");

    const editedRow = (service as any).memory.get(project.id);
    await (service as any).renderScenes(editedRow, "MODO");
    expect(synthesize).toHaveBeenCalledTimes(project.scenes.length + 1);
    expect(synthesize.mock.calls.at(-1)?.[0]).toMatchObject({
      text: "Uma locução revisada somente para esta cena.",
    });
  });

  it("enriquece cena humana com B-roll, persiste asset e crédito", async () => {
    const fetchClip = vi.fn(async () => ({
      provider: "pexels" as const,
      mimeType: "video/mp4" as const,
      data: Buffer.from("stock-video"),
      credit: {
        provider: "pexels" as const,
        authorName: "Ana Criadora",
        authorUrl: "https://www.pexels.com/@ana",
        sourceUrl: "https://www.pexels.com/video/42/",
      },
    }));
    const service = new VideoService({
      publicApiUrl: "https://modo.example.com",
      brollProvider: { name: "pexels", fetchClip },
    });
    const project = await service.createProject({
      organizationId: "organization-one",
      content: contentRequest({ output: humanOutput() }),
      durationSeconds: 15,
      captions: true,
    });
    const row = (service as any).memory.get(project.id);
    const prepared = await (service as any).prepareVisualScenes(row, "MODO");

    expect(fetchClip).toHaveBeenCalledTimes(1);
    expect(prepared.row.broll_provider).toBe("pexels");
    expect(prepared.scenes[0]).toMatchObject({
      visualType: "broll_video",
      assetSource: "stock",
      stockCredit: {
        provider: "pexels",
        authorName: "Ana Criadora",
      },
    });
    expect(prepared.scenes[0].videoUrl).toMatch(/^https:\/\/modo\.example\.com\/api\/v1\/public\/video-scene-assets\//);
  });

  it("regenera somente o B-roll escolhido e preserva as demais cenas", async () => {
    const fetchClip = vi.fn(async ({ revision }: { revision: number }) => ({
      provider: "pexels" as const,
      mimeType: "video/mp4" as const,
      data: Buffer.from(`stock-video:${revision}`),
      credit: {
        provider: "pexels" as const,
        authorName: `Criador ${revision}`,
        authorUrl: "https://www.pexels.com/@criador",
        sourceUrl: `https://www.pexels.com/video/${revision + 1}/`,
      },
    }));
    const service = new VideoService({
      publicApiUrl: "https://modo.example.com",
      brollProvider: { name: "pexels", fetchClip },
    });
    const created = await service.createProject({
      organizationId: "organization-one",
      content: contentRequest({ output: humanOutput() }),
      durationSeconds: 15,
      captions: true,
    });
    const before = structuredClone(created.scenes);
    await service.cancel(created.id, "organization-one");

    const updated = await service.regenerateScene({
      id: created.id,
      organizationId: "organization-one",
      sceneIndex: 1,
      brandName: "MODO",
    });

    expect(fetchClip).toHaveBeenCalledTimes(1);
    expect(updated.status).toBe("queued");
    expect(updated.brollProvider).toBe("pexels");
    expect(updated.scenes[0]).toMatchObject({
      visualType: "broll_video",
      assetSource: "stock",
      assetRevision: 1,
      stockCredit: { authorName: "Criador 1" },
    });
    expect(updated.scenes[0].videoUrl).toMatch(/^https:\/\/modo\.example\.com\/api\/v1\/public\/video-scene-assets\//);
    expect(updated.scenes.slice(1)).toEqual(before.slice(1));
  });

  it("regenera somente o visual escolhido e preserva as demais cenas", async () => {
    const generate = vi.fn(async ({ sceneIndex, revision }: { sceneIndex: number; revision: number }) => ({
      provider: "openai" as const,
      mimeType: "image/png" as const,
      data: Buffer.from(`image:${sceneIndex}:${revision}`),
    }));
    const service = new VideoService({
      publicApiUrl: "https://modo.example.com",
      visualProvider: { name: "openai", generate },
    });
    const created = await service.createProject({
      organizationId: "organization-one",
      content: contentRequest(),
      durationSeconds: 30,
      captions: true,
    });
    const before = structuredClone(created.scenes);
    await service.cancel(created.id, "organization-one");

    const updated = await service.regenerateScene({
      id: created.id,
      organizationId: "organization-one",
      sceneIndex: 2,
      brandName: "MODO",
    });

    expect(generate).toHaveBeenCalledTimes(1);
    expect(updated.status).toBe("queued");
    expect(updated.outputUrl).toBeNull();
    expect(updated.visualProvider).toBe("openai");
    expect(updated.scenes[1]).toMatchObject({
      index: 2,
      visualType: "generated_image",
      assetSource: "generated",
      assetRevision: 1,
    });
    expect(updated.scenes[1].imageUrl).toMatch(/^https:\/\/modo\.example\.com\/api\/v1\/public\/video-scene-assets\//);
    expect(updated.scenes[0]).toEqual(before[0]);
    expect(updated.scenes.slice(2)).toEqual(before.slice(2));
  });

  it("faz fallback de B-roll para imagem gerada quando Pexels não está configurado", async () => {
    const generate = vi.fn(async () => ({
      provider: "openai" as const,
      mimeType: "image/png" as const,
      data: Buffer.from("fallback-image"),
    }));
    const service = new VideoService({
      publicApiUrl: "https://modo.example.com",
      visualProvider: { name: "openai", generate },
    });
    const project = await service.createProject({
      organizationId: "organization-one",
      content: contentRequest({ output: humanOutput() }),
      durationSeconds: 15,
      captions: true,
    });
    const row = (service as any).memory.get(project.id);
    const prepared = await (service as any).prepareVisualScenes(row, "MODO");

    expect(generate).toHaveBeenCalledTimes(1);
    expect(prepared.scenes[0]).toMatchObject({
      visualType: "generated_image",
      assetSource: "generated",
      videoUrl: null,
    });
    expect(prepared.scenes[0].imageUrl).toContain("/api/v1/public/video-scene-assets/");
  });

  it("não promete regeneração visual quando o ambiente não possui provider", async () => {
    const service = new VideoService();
    const created = await service.createProject({
      organizationId: "organization-one",
      content: contentRequest(),
      durationSeconds: 30,
      captions: true,
    });
    await service.cancel(created.id, "organization-one");
    await expect(service.regenerateScene({
      id: created.id,
      organizationId: "organization-one",
      sceneIndex: 2,
      brandName: "MODO",
    })).rejects.toMatchObject<Partial<VideoError>>({ code: "VIDEO_VISUAL_UNAVAILABLE" });
  });

  it("não promete troca de B-roll quando o ambiente não possui Pexels", async () => {
    const service = new VideoService();
    const created = await service.createProject({
      organizationId: "organization-one",
      content: contentRequest({ output: humanOutput() }),
      durationSeconds: 15,
      captions: true,
    });
    await service.cancel(created.id, "organization-one");
    await expect(service.regenerateScene({
      id: created.id,
      organizationId: "organization-one",
      sceneIndex: 1,
      brandName: "MODO",
    })).rejects.toMatchObject<Partial<VideoError>>({ code: "VIDEO_BROLL_UNAVAILABLE" });
  });

  it("não aceita narração quando o ambiente não possui provider", async () => {
    const service = new VideoService();
    await expect(service.createProject({
      organizationId: "organization-one",
      content: contentRequest(),
      durationSeconds: 30,
      captions: true,
      voiceover: true,
    })).rejects.toMatchObject<Partial<VideoError>>({ code: "VIDEO_VOICE_UNAVAILABLE" });
  });

  it("recusa tipos de conteúdo que não são roteiro de vídeo", async () => {
    const service = new VideoService();
    await expect(service.createProject({
      organizationId: "organization-one",
      content: contentRequest({ contentType: "carousel" }),
      durationSeconds: 30,
      captions: true,
    })).rejects.toMatchObject<Partial<VideoError>>({ code: "VIDEO_CONTENT_TYPE_REQUIRED" });
  });
});