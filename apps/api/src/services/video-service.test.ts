import type { ContentRequest, GeneratedContent } from "@modo/contracts/content";
import { describe, expect, it } from "vitest";
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
