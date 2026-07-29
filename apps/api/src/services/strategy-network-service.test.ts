import { describe, expect, it } from "vitest";
import { StrategyNetworkError, StrategyNetworkService } from "./strategy-network-service.js";

const foundation = {
  audience: { priority: "Pequenas empresas", context: "", pains: ["Falta de direção"], desires: [], objections: [], decisionTriggers: [] },
  worldview: { belief: "Marketing precisa ser simples", marketProblem: "", desiredChange: "" },
  positioning: { category: "", differentiator: "", forWhom: "", notForWhom: "", territory: "" },
  promise: { transformation: "", mainBenefit: "", boundaries: "" },
  personality: { attributes: [], tone: "", preferredWords: [], prohibitedWords: [], visualStyle: "" },
  proof: { origin: "", cases: [], numbers: [], testimonials: [] },
  universe: { environments: [], people: [], objects: [], themes: [], visualReferences: [] },
  humanPresence: { spokespersons: [], team: [], customers: [], cameraAvailability: "low" as const, notes: "" },
};

describe("StrategyNetworkService", () => {
  it("persiste a fundação por organização e marca", async () => {
    const service = new StrategyNetworkService();
    const saved = await service.upsertFoundation("org-1", { brandId: "00000000-0000-4000-8000-000000000001", foundation, status: "complete" });
    expect(saved.organizationId).toBe("org-1");
    expect(saved.status).toBe("complete");
    expect((await service.getFoundation("org-1", saved.brandId))?.foundation.audience.priority).toBe("Pequenas empresas");
    expect(await service.getFoundation("org-2", saved.brandId)).toBeNull();
  });

  it("cria solicitação humana sem preço ou contratação automática", async () => {
    const service = new StrategyNetworkService();
    const request = await service.createSupportRequest(
      { organizationId: "org-1", userId: "00000000-0000-4000-8000-000000000010", email: "cliente@modo.test" },
      {
        brandId: "00000000-0000-4000-8000-000000000001",
        contentRequestId: null,
        type: "campaign_review",
        context: "Precisamos de uma revisão antes de começar a investir na campanha.",
        desiredOutcome: "Validar mensagem e estrutura.",
        urgency: "normal",
      },
    );
    expect(request.status).toBe("requested");
    expect(request.pricingStatus).toBe("under_review");
  });

  it("bloqueia candidatura pública duplicada", async () => {
    const service = new StrategyNetworkService();
    const input = {
      name: "Profissional Modo",
      email: "talento@modo.test",
      whatsapp: "",
      city: "São Paulo",
      primaryRole: "designer" as const,
      secondaryRoles: ["art_director" as const],
      experienceYears: 5,
      portfolioUrl: "https://portfolio.example.com",
      linkedinUrl: "",
      availability: "project" as const,
      engagementPreference: "open" as const,
      about: "Trabalho com sistemas visuais, campanhas digitais e produtos orientados a resultado.",
      consent: true as const,
    };
    await service.createSpecialistApplication(input);
    await expect(service.createSpecialistApplication(input)).rejects.toBeInstanceOf(StrategyNetworkError);
  });
});
