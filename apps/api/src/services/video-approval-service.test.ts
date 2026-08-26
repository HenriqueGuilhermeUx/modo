import type { VideoProject } from "@modo/contracts/video";
import { describe, expect, it } from "vitest";
import { VideoApprovalError, VideoApprovalService } from "./video-approval-service.js";

function project(overrides: Partial<VideoProject> = {}): VideoProject {
  const now = new Date().toISOString();
  return {
    id: "550e8400-e29b-41d4-a716-446655440010",
    organizationId: "organization-one",
    brandId: "550e8400-e29b-41d4-a716-446655440000",
    contentRequestId: "550e8400-e29b-41d4-a716-446655440001",
    durationSeconds: 15,
    aspectRatio: "9:16",
    fps: 30,
    captions: true,
    voiceover: true,
    voiceProvider: "openai",
    visualProvider: "openai",
    status: "ready",
    review: { approvalStatus: "pending", approvedAt: null, scenes: [] },
    renderer: "remotion",
    scenes: [
      {
        index: 1,
        startFrame: 0,
        endFrame: 225,
        headline: "Cena 1",
        visual: "Visual 1",
        caption: "Locução 1",
        imageUrl: null,
        visualType: "kinetic_text",
        motion: "push_in",
        assetSource: "native",
        assetRevision: 0,
        visualPrompt: "Visual 1",
      },
      {
        index: 2,
        startFrame: 225,
        endFrame: 450,
        headline: "Cena 2",
        visual: "Visual 2",
        caption: "Locução 2",
        imageUrl: "https://example.com/scene.png",
        visualType: "generated_image",
        motion: "pan_right",
        assetSource: "generated",
        assetRevision: 0,
        visualPrompt: "Visual 2",
      },
    ],
    outputUrl: "https://example.com/video.mp4",
    mimeType: "video/mp4",
    error: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe("VideoApprovalService", () => {
  it("preserva vídeos legados prontos como aprovados quando ainda não existe review", async () => {
    const service = new VideoApprovalService();
    const decorated = await service.decorate(project());
    expect(decorated.review.approvalStatus).toBe("approved");
    expect(decorated.review.scenes.every((scene) => scene.status === "approved")).toBe(true);
  });

  it("cria novos projetos em revisão pendente mesmo quando o render termina depois", async () => {
    const service = new VideoApprovalService();
    const queued = project({ status: "queued", outputUrl: null, mimeType: null });
    const initial = await service.decorate(queued, "pending");
    expect(initial.review.approvalStatus).toBe("pending");
    expect(initial.review.scenes.every((scene) => scene.status === "pending")).toBe(true);

    const ready = project();
    const afterRender = await service.decorate(ready);
    expect(afterRender.review.approvalStatus).toBe("pending");
  });

  it("aprova cena por cena e só libera o vídeo quando todas foram revisadas", async () => {
    const service = new VideoApprovalService();
    const ready = project();
    await service.ensure(ready, "pending");

    const first = await service.approveScene(ready, 1);
    expect(first.scenes).toEqual([
      expect.objectContaining({ sceneIndex: 1, status: "approved" }),
      expect.objectContaining({ sceneIndex: 2, status: "pending" }),
    ]);
    await expect(service.approveProject(ready)).rejects.toMatchObject<Partial<VideoApprovalError>>({
      code: "VIDEO_SCENES_PENDING",
    });

    const second = await service.approveScene(ready, 2);
    expect(second.scenes.every((scene) => scene.status === "approved")).toBe(true);
    const final = await service.approveProject(ready);
    expect(final.approvalStatus).toBe("approved");
    expect(final.approvedAt).toBeTruthy();
  });

  it("regenerar uma cena reabre apenas aquela revisão e a aprovação final", async () => {
    const service = new VideoApprovalService();
    const ready = project();
    await service.ensure(ready, "pending");
    await service.approveScene(ready, 1);
    await service.approveScene(ready, 2);
    await service.approveProject(ready);

    const rerendering = project({ status: "queued", outputUrl: null, mimeType: null });
    const reset = await service.resetScene(rerendering, 2);
    expect(reset.approvalStatus).toBe("pending");
    expect(reset.approvedAt).toBeNull();
    expect(reset.scenes).toEqual([
      expect.objectContaining({ sceneIndex: 1, status: "approved" }),
      expect.objectContaining({ sceneIndex: 2, status: "pending", reviewedAt: null }),
    ]);
  });

  it("bloqueia Publisher enquanto o vídeo novo ainda não recebeu aprovação final", async () => {
    const service = new VideoApprovalService();
    const ready = project();
    await service.ensure(ready, "pending");
    await expect(service.requireApproved(ready)).rejects.toMatchObject<Partial<VideoApprovalError>>({
      code: "VIDEO_APPROVAL_REQUIRED",
    });
  });
});
