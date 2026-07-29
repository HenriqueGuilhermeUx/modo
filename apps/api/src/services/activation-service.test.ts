import type { Brand } from "@modo/contracts";
import type { ContentRequest } from "@modo/contracts/content";
import { describe, expect, it } from "vitest";
import type { AuthService } from "./auth-service.js";
import type { ContentService } from "./content-service.js";
import { ActivationService } from "./activation-service.js";

const brand: Brand = {
  id: "7f215a3b-cb15-4ce1-9cb5-770f2529c306",
  organizationId: "org_test",
  name: "Marca Teste",
  websiteUrl: "",
  instagramHandle: "",
  niche: "servicos_profissionais",
  createdAt: "2026-07-01T10:00:00.000Z",
  updatedAt: "2026-07-01T10:00:00.000Z",
};

function contentRequest(status: ContentRequest["status"]): ContentRequest {
  return {
    id: "3698f9f4-c458-467a-8fe9-ae92bbbfa057",
    organizationId: "org_test",
    brandId: brand.id,
    contentType: "static_post",
    objective: "autoridade",
    brief: "Criar uma entrega contextual para o cliente.",
    channel: "Instagram",
    status,
    creditsCharged: 1,
    revisionCount: 0,
    maxRevisions: 1,
    revisionInstructions: null,
    output: null,
    error: null,
    providerRunId: null,
    approvedAt: status === "approved" ? "2026-07-03T10:00:00.000Z" : null,
    createdAt: "2026-07-02T10:00:00.000Z",
    updatedAt: "2026-07-03T10:00:00.000Z",
  };
}

function service(requests: ContentRequest[] = []) {
  const auth = {
    listBrands: async () => [brand],
  } as unknown as AuthService;
  const content = {
    list: async () => requests,
  } as unknown as ContentService;
  return new ActivationService({ auth, content });
}

describe("ActivationService", () => {
  it("orienta o onboarding quando existe marca, mas nenhuma produção", async () => {
    const summary = await service().summary("org_test");

    expect(summary.progress).toBe(33);
    expect(summary.nextAction.path).toBe("/app/onboarding");
    expect(summary.steps.find((step) => step.id === "brand")?.completed).toBe(true);
    expect(summary.steps.find((step) => step.id === "onboarding")?.completed).toBe(false);
  });

  it("preserva o progresso de contas antigas que já produziram conteúdo", async () => {
    const summary = await service([contentRequest("ready")]).summary("org_test");

    expect(summary.steps.find((step) => step.id === "onboarding")?.completed).toBe(true);
    expect(summary.steps.find((step) => step.id === "content")?.completed).toBe(true);
    expect(summary.nextAction.label).toBe("Revisar e aprovar");
  });

  it("conclui a ativação somente depois de aprovação e exportação", async () => {
    const activation = service([contentRequest("approved")]);
    await activation.record({
      organizationId: "org_test",
      userId: "user_test",
      name: "asset_exported",
      metadata: { contentRequestId: "3698f9f4-c458-467a-8fe9-ae92bbbfa057" },
    });

    const summary = await activation.summary("org_test");

    expect(summary.activated).toBe(true);
    expect(summary.progress).toBe(100);
    expect(summary.nextAction.path).toBe("/app/content");
    expect(summary.metrics.exports).toBe(1);
  });
});
