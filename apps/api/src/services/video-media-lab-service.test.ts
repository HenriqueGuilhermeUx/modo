import type { ContentRequest, GeneratedContent } from "@modo/contracts/content";
import { describe, expect, it } from "vitest";
import { VideoMediaLabService, sceneMediaState } from "./video-media-lab-service.js";
import { VideoError, VideoService } from "./video-service.js";

const output: GeneratedContent = {
  hook: "Abra com uma cena forte.",
  title: "Media Lab",
  caption: "Conteúdo para testar mídia própria.",
  cta: "Feche com direção.",
  hashtags: ["#MODO"],
  visualDirection: "Editorial vertical.",
  slides: [],
  storyFrames: [],
  adaptationNotes: [],
  imagePrompt: "",
  imageAlt: "",
  imageUrl: null,
  imageStatus: "not_requested",
  visualAssets: [],
  script: [
    { scene: "Abertura", visual: "Pessoa trabalhando em uma mesa.", voiceover: "Abertura com contexto." },
    { scene: "Método", visual: "Tela com processo organizado.", voiceover: "Depois mostramos o método." },
    { scene: "CTA", visual: "Marca e chamada final.", voiceover: "Finalize com uma chamada clara." },
  ],
};

function content(): ContentRequest {
  const now = new Date().toISOString();
  return {
    id: "550e8400-e29b-41d4-a716-446655440101",
    organizationId: "organization-one",
    brandId: "550e8400-e29b-41d4-a716-446655440102",
    contentType: "short_video_script",
    objective: "autoridade",
    brief: "Testar Media Lab.",
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

async function editableProject(video: VideoService) {
  const project = await video.createProject({
    organizationId: "organization-one",
    content: content(),
    durationSeconds: 15,
    captions: true,
  });
  return video.cancel(project.id, "organization-one");
}

const tinyPng = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const tinyMp4 = Buffer.concat([Buffer.from([0, 0, 0, 16]), Buffer.from("ftyp"), Buffer.from("isom0000")]);

describe("MODO Video Media Lab V1.7", () => {
  it("lê enquadramento e trim persistidos no URL da cena", () => {
    const state = sceneMediaState({
      imageUrl: null,
      videoUrl: "https://modo.example.com/asset.mp4?mlfx=22&mlfy=71&mlz=1.35&mltrim=2.4&mldur=10",
    });
    expect(state).toEqual({
      focalX: 22,
      focalY: 71,
      zoom: 1.35,
      trimStartSeconds: 2.4,
      durationSeconds: 10,
    });
  });

  it("envia imagem própria, transforma em take selecionável e preserva o arquivo", async () => {
    const video = new VideoService({ publicApiUrl: "https://modo.example.com" });
    const mediaLab = new VideoMediaLabService(video, "https://modo.example.com");
    const project = await editableProject(video);

    const uploaded = await mediaLab.uploadAndAttach({
      project,
      organizationId: "organization-one",
      sceneIndex: 1,
      upload: {
        fileName: "produto-final.png",
        mimeType: "image/png",
        dataBase64: tinyPng.toString("base64"),
        durationSeconds: null,
      },
    });

    expect(uploaded.scenes[0]).toMatchObject({
      assetSource: "upload",
      visualType: "generated_image",
      stockCredit: null,
    });
    expect(uploaded.scenes[0].imageUrl).toContain("mlfx=50");
    expect(uploaded.scenes[0].imageUrl).toContain("mlz=1");

    const takes = await mediaLab.listSceneTakes(uploaded, "organization-one", 1);
    expect(takes).toHaveLength(1);
    expect(takes[0]).toMatchObject({
      provider: "upload",
      selectable: true,
      active: true,
      originalFileName: "produto-final.png",
      kind: "image",
    });
  });

  it("altera enquadramento sem duplicar o asset nem avançar a revisão", async () => {
    const video = new VideoService({ publicApiUrl: "https://modo.example.com" });
    const mediaLab = new VideoMediaLabService(video, "https://modo.example.com");
    const project = await editableProject(video);
    const uploaded = await mediaLab.uploadAndAttach({
      project,
      organizationId: "organization-one",
      sceneIndex: 1,
      upload: {
        fileName: "hero.png",
        mimeType: "image/png",
        dataBase64: tinyPng.toString("base64"),
        durationSeconds: null,
      },
    });
    const beforeRevision = uploaded.scenes[0].assetRevision;
    const beforeTakes = await mediaLab.listSceneTakes(uploaded, "organization-one", 1);

    const editable = await video.cancel(uploaded.id, "organization-one");
    const framed = await mediaLab.updateTransform({
      project: editable,
      organizationId: "organization-one",
      sceneIndex: 1,
      patch: { focalX: 18, focalY: 76, zoom: 1.45 },
    });

    expect(framed.scenes[0].assetRevision).toBe(beforeRevision);
    expect(framed.scenes[0].imageUrl).toContain("mlfx=18");
    expect(framed.scenes[0].imageUrl).toContain("mlfy=76");
    expect(framed.scenes[0].imageUrl).toContain("mlz=1.45");
    const afterTakes = await mediaLab.listSceneTakes(framed, "organization-one", 1);
    expect(afterTakes).toHaveLength(beforeTakes.length);
    expect(afterTakes[0].token).toBe(beforeTakes[0].token);
  });

  it("recusa conteúdo que não corresponde ao MIME informado", async () => {
    const video = new VideoService({ publicApiUrl: "https://modo.example.com" });
    const mediaLab = new VideoMediaLabService(video, "https://modo.example.com");
    const project = await editableProject(video);

    await expect(mediaLab.uploadAndAttach({
      project,
      organizationId: "organization-one",
      sceneIndex: 1,
      upload: {
        fileName: "falso.jpg",
        mimeType: "image/jpeg",
        dataBase64: tinyPng.toString("base64"),
        durationSeconds: null,
      },
    })).rejects.toMatchObject<Partial<VideoError>>({ code: "VIDEO_MEDIA_SIGNATURE_MISMATCH" });
  });

  it("não permite trim em imagem", async () => {
    const video = new VideoService({ publicApiUrl: "https://modo.example.com" });
    const mediaLab = new VideoMediaLabService(video, "https://modo.example.com");
    const project = await editableProject(video);
    const uploaded = await mediaLab.uploadAndAttach({
      project,
      organizationId: "organization-one",
      sceneIndex: 1,
      upload: {
        fileName: "capa.webp",
        mimeType: "image/png",
        dataBase64: tinyPng.toString("base64"),
        durationSeconds: null,
      },
    });
    const editable = await video.cancel(uploaded.id, "organization-one");

    await expect(mediaLab.updateTransform({
      project: editable,
      organizationId: "organization-one",
      sceneIndex: 1,
      patch: { trimStartSeconds: 1 },
    })).rejects.toMatchObject<Partial<VideoError>>({ code: "VIDEO_MEDIA_TRIM_VIDEO_ONLY" });
  });

  it("valida duração do MP4 e aplica trim sem baixar ou duplicar o take", async () => {
    const video = new VideoService({ publicApiUrl: "https://modo.example.com" });
    const mediaLab = new VideoMediaLabService(video, "https://modo.example.com");
    const project = await editableProject(video);
    const uploaded = await mediaLab.uploadAndAttach({
      project,
      organizationId: "organization-one",
      sceneIndex: 1,
      upload: {
        fileName: "bastidores.mp4",
        mimeType: "video/mp4",
        dataBase64: tinyMp4.toString("base64"),
        durationSeconds: 10,
      },
    });
    const takesBefore = await mediaLab.listSceneTakes(uploaded, "organization-one", 1);
    expect(takesBefore[0]).toMatchObject({ provider: "upload", durationSeconds: 10, selectable: true });

    const editable = await video.cancel(uploaded.id, "organization-one");
    const trimmed = await mediaLab.updateTransform({
      project: editable,
      organizationId: "organization-one",
      sceneIndex: 1,
      patch: { trimStartSeconds: 3 },
    });
    expect(trimmed.scenes[0].videoUrl).toContain("mltrim=3");
    const takesAfter = await mediaLab.listSceneTakes(trimmed, "organization-one", 1);
    expect(takesAfter).toHaveLength(1);
    expect(takesAfter[0].token).toBe(takesBefore[0].token);

    const editableAgain = await video.cancel(trimmed.id, "organization-one");
    await expect(mediaLab.updateTransform({
      project: editableAgain,
      organizationId: "organization-one",
      sceneIndex: 1,
      patch: { trimStartSeconds: 5.5 },
    })).rejects.toMatchObject<Partial<VideoError>>({ code: "VIDEO_MEDIA_TRIM_OUT_OF_RANGE" });
  });

  it("mantém isolamento por organização", async () => {
    const video = new VideoService({ publicApiUrl: "https://modo.example.com" });
    const mediaLab = new VideoMediaLabService(video, "https://modo.example.com");
    const project = await editableProject(video);

    await expect(mediaLab.uploadAndAttach({
      project,
      organizationId: "organization-two",
      sceneIndex: 1,
      upload: {
        fileName: "intruso.png",
        mimeType: "image/png",
        dataBase64: tinyPng.toString("base64"),
        durationSeconds: null,
      },
    })).rejects.toMatchObject<Partial<VideoError>>({ code: "VIDEO_SCENE_TAKE_NOT_FOUND" });
  });
});
