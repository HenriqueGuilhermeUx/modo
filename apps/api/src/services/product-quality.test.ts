import { nicheTemplates } from "@modo/contracts/niche-templates";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadCreativeGenerationContext } from "./creative-context.js";
import { IntelligenceService, normalizeMarketRadarItems } from "./intelligence-service.js";

const nicheKeys = [
  "saude_estetica",
  "servicos_profissionais",
  "imoveis",
  "varejo",
  "educacao",
  "creator",
  "outro",
] as const;

describe("qualidade do motor MODO", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("mantém direção específica para todos os nichos", () => {
    expect(Object.keys(nicheTemplates).sort()).toEqual([...nicheKeys].sort());
    for (const niche of nicheKeys) {
      const template = nicheTemplates[niche];
      expect(template.contentPillars.length).toBeGreaterThanOrEqual(4);
      expect(template.commonAngles.length).toBeGreaterThanOrEqual(3);
      expect(template.provenHooks.length).toBeGreaterThanOrEqual(3);
      expect(template.toneGuidance.length).toBeGreaterThan(30);
      expect(template.wordsToAvoid.length).toBeGreaterThanOrEqual(3);
    }
  });

  it("declara contexto indisponível quando não há banco configurado", async () => {
    vi.stubEnv("DATABASE_URL", "");
    const context = await loadCreativeGenerationContext("org-test", "brand-test");
    expect(context.contextStatus).toBe("unavailable");
    expect(context.failedQueries).toEqual([]);
    expect(context.foundation).toBeNull();
  });

  it("mantém playbooks sem Task do Apify na fila interna", async () => {
    const service = new IntelligenceService({
      provider: "apify",
      apifyToken: "token-de-teste",
      taskIds: { market_radar: "task-market-radar" },
    });
    const mission = await service.create(
      "org-test",
      "user-test",
      {
        brandId: "brand-test",
        name: "Prospecção futura",
        playbook: "b2b_prospecting",
        objective: "Mapear empresas",
        regions: ["Campinas, SP"],
        keywords: ["serviços"],
        competitors: [],
        products: [],
        maxItems: 20,
      },
      {
        id: "brand-test",
        name: "Marca Teste",
        niche: "servicos_profissionais",
        websiteUrl: "",
        instagramHandle: "",
      },
    );
    expect(mission.provider).toBe("queue");
    expect(mission.status).toBe("queued");
    expect(mission.providerMessage).toContain("fila interna");
  });

  it("normaliza e remove duplicatas do Radar de Mercado", () => {
    const items = normalizeMarketRadarItems([
      {
        platform: "google_maps",
        businessName: "Empresa A",
        website: "https://empresa-a.example.com",
        description: "  Resumo   com espaços  ",
        metrics: { rating: 4.7 },
      },
      {
        source: "google_maps",
        name: "Empresa A duplicada",
        url: "https://empresa-a.example.com/",
        summary: "Duplicada",
      },
    ]);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      source: "google_maps",
      name: "Empresa A",
      url: "https://empresa-a.example.com/",
      summary: "Resumo com espaços",
      signals: { rating: 4.7 },
    });
    expect(typeof items[0].collectedAt).toBe("string");
  });
});
