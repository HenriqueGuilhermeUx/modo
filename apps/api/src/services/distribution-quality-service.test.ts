import type { ContentRequest } from "@modo/contracts/content";
import type { CreativeProfile } from "@modo/contracts/creative-intelligence";
import { describe, expect, it } from "vitest";
import { DistributionQualityService } from "./distribution-quality-service.js";

const request: ContentRequest = {
  id: "11111111-1111-4111-8111-111111111111",
  organizationId: "org-1",
  brandId: "22222222-2222-4222-8222-222222222222",
  contentType: "static_post",
  objective: "autoridade",
  brief: "Explique como a MODO transforma contexto em conteúdo útil para uma marca.",
  channel: "Instagram",
  status: "approved",
  creditsCharged: 1,
  revisionCount: 0,
  maxRevisions: 2,
  revisionInstructions: null,
  output: {
    hook: "Conteúdo sem contexto vira ruído.",
    title: "Contexto antes de conteúdo",
    caption: "A MODO organiza o contexto da empresa e transforma informação real em uma presença digital consistente, clara e útil para o público.",
    cta: "Veja como organizar sua presença digital.",
    hashtags: ["modo", "marketing", "conteudo"],
    visualDirection: "Visual editorial, limpo e coerente com a marca.",
    slides: [],
    script: [],
    storyFrames: [],
    adaptationNotes: [],
    imagePrompt: "Editorial social post",
    imageAlt: "Peça editorial da MODO",
    imageUrl: "https://cdn.example.com/modo.png",
    imageStatus: "generated",
    visualAssets: [],
  },
  error: null,
  providerRunId: "run-1",
  approvedAt: "2026-08-19T20:00:00.000Z",
  createdAt: "2026-08-19T19:00:00.000Z",
  updatedAt: "2026-08-19T20:00:00.000Z",
};

const profile: CreativeProfile = {
  accountId: "org-1",
  brandId: request.brandId,
  peopleAvailable: [],
  comfortableOnCamera: false,
  weeklyMinutesAvailable: 30,
  locations: [],
  productsOrServicesToShow: [],
  proofAvailable: [],
  recurringQuestions: [],
  currentPriorities: [],
  prohibitedTopics: ["garantia de resultado"],
  preferredChannels: ["instagram", "linkedin"],
  notes: "",
  updatedAt: "2026-08-19T20:00:00.000Z",
};

describe("DistributionQualityService", () => {
  const service = new DistributionQualityService();

  it("recomenda uma peça aprovada, estruturada e com mídia", () => {
    const report = service.evaluate(request, profile);
    expect(report.publishAllowed).toBe(true);
    expect(report.status).toBe("recommended");
    expect(report.score).toBeGreaterThanOrEqual(85);
    expect(report.blockers).toEqual([]);
  });

  it("bloqueia conteúdo que usa tópico proibido da marca", () => {
    const unsafe: ContentRequest = {
      ...request,
      output: request.output
        ? {
            ...request.output,
            caption: `${request.output.caption} Oferecemos garantia de resultado para todos.`,
          }
        : null,
    };
    const report = service.evaluate(unsafe, profile);
    expect(report.publishAllowed).toBe(false);
    expect(report.status).toBe("blocked");
    expect(report.blockers.join(" ")).toContain("garantia de resultado");
  });

  it("bloqueia Story sem mídia pronta", () => {
    const story: ContentRequest = {
      ...request,
      contentType: "story",
      output: request.output
        ? {
            ...request.output,
            imageUrl: null,
            imageStatus: "not_requested",
            visualAssets: [],
          }
        : null,
    };
    const report = service.evaluate(story, profile);
    expect(report.publishAllowed).toBe(false);
    expect(report.blockers.join(" ")).toContain("Stories precisam de mídia");
  });
});
