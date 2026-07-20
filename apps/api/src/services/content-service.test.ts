import { describe, expect, it } from "vitest";
import { ContentError, ContentService } from "./content-service.js";

const input = {
  brandId: "550e8400-e29b-41d4-a716-446655440000",
  contentType: "carousel" as const,
  objective: "autoridade" as const,
  brief: "Apresentar a proposta da marca de forma educativa.",
  channel: "Instagram",
};

const output = {
  hook: "Uma pergunta forte para abrir o conteúdo.",
  title: "Título principal",
  caption: "Legenda completa do conteúdo.",
  cta: "Converse com a nossa equipe.",
  hashtags: ["#Marca"],
  visualDirection: "Direção visual limpa e objetiva.",
  slides: [
    { title: "Slide 1", body: "Abertura" },
    { title: "Slide 2", body: "Desenvolvimento" },
  ],
  script: [],
  storyFrames: [],
  adaptationNotes: [],
};

describe("ContentService", () => {
  it("creates queued requests and isolates them by organization", async () => {
    const service = new ContentService();
    const first = await service.create(
      "request-one",
      "organization-one",
      input,
      2,
      2,
    );

    expect(first.status).toBe("queued");
    expect(first.creditsCharged).toBe(2);
    expect(first.maxRevisions).toBe(2);
    expect(await service.list("organization-one")).toHaveLength(1);
    expect(await service.list("organization-two")).toHaveLength(0);
  });

  it("moves generated content through revision and approval", async () => {
    const service = new ContentService();
    await service.create("request-two", "organization-one", input, 2, 1);
    await service.markProcessing("request-two");
    const ready = await service.complete("request-two", output, "run-one");

    expect(ready.status).toBe("ready");
    expect(ready.output?.title).toBe("Título principal");

    const revision = await service.requestRevision(
      "request-two",
      "organization-one",
      "Deixe o segundo slide mais direto.",
    );
    expect(revision.status).toBe("revision_requested");
    expect(revision.revisionCount).toBe(1);

    await service.markProcessing("request-two");
    await service.complete("request-two", { ...output, title: "Título revisado" }, "run-two");
    const approved = await service.approve("request-two", "organization-one");

    expect(approved.status).toBe("approved");
    expect(approved.output?.title).toBe("Título revisado");
    expect(approved.approvedAt).toBeTruthy();
  });

  it("blocks revisions above the plan limit", async () => {
    const service = new ContentService();
    await service.create("request-three", "organization-one", input, 2, 0);
    await service.markProcessing("request-three");
    await service.complete("request-three", output);

    await expect(
      service.requestRevision("request-three", "organization-one", "Altere o tom."),
    ).rejects.toMatchObject<Partial<ContentError>>({ code: "REVISION_LIMIT_REACHED" });
  });
});
