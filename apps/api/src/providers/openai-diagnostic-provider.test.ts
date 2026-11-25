import { DiagnosticResultSchema } from "@modo/contracts";
import { describe, expect, it, vi } from "vitest";
import { OpenAiDiagnosticProvider, toDiagnosticResult } from "./openai-diagnostic-provider.js";

const input = {
  websiteUrl: "https://clinicaexemplo.com.br",
  niche: "saude_estetica",
  instagramHandle: "@clinicaexemplo",
} as const;

const site = {
  title: "Clínica Exemplo | Estética facial em Campinas",
  text: "A Clínica Exemplo oferece limpeza de pele, peeling e harmonização em Campinas. Agende pelo WhatsApp.",
};

const modelOutput = {
  brandSummary: {
    name: "Clínica Exemplo",
    segment: "Estética facial",
    primaryOffer: "Limpeza de pele e peeling",
    audience: "Mulheres de Campinas que cuidam da pele",
    positioning: "Cuidado de pele com agendamento fácil pelo WhatsApp",
  },
  diagnosis: {
    strength: "O site deixa claro o serviço e a cidade.",
    opportunity: "O site não mostra prova social.",
    impact: "Sem prova, quem chega pelo Instagram demora a agendar.",
    recommendation: "Mostrar a rotina da clínica e explicar cada procedimento.",
  },
  campaigns: [
    {
      objective: "autoridade",
      eyebrow: "Explica",
      title: "Peeling: para quem é",
      visualDirection: "Carrossel com 4 cards claros",
      caption: "Peeling não é tudo igual. Entenda. Agende pelo WhatsApp.",
      hashtags: ["peeling", "#estetica facial", "##campinas"],
      cta: "Agende pelo WhatsApp",
    },
    {
      objective: "leads",
      eyebrow: "Agenda",
      title: "Horários da semana",
      visualDirection: "Story com a agenda",
      caption: "Ainda temos horários nesta semana. Chame no WhatsApp.",
      hashtags: ["#limpezadepele"],
      cta: "Chame no WhatsApp",
    },
    {
      objective: "conexao",
      eyebrow: "Bastidores",
      title: "Quem cuida de você",
      visualDirection: "Foto real da equipe",
      caption: "Conheça a equipe. Comente sua dúvida.",
      hashtags: ["#campinas"],
      cta: "Comente sua dúvida",
    },
  ],
};

function okResponse(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

const silent = { warn: () => {} };

describe("toDiagnosticResult", () => {
  it("assigns stable ids and normalizes hashtags", () => {
    const result = toDiagnosticResult(modelOutput);
    expect(DiagnosticResultSchema.safeParse(result).success).toBe(true);
    expect(result.campaigns.map((c) => c.id)).toEqual([
      "scan-autoridade",
      "scan-leads",
      "scan-conexao",
    ]);
    expect(result.campaigns[0].hashtags).toEqual(["#peeling", "#esteticafacial", "#campinas"]);
  });

  it("rejects output without exactly 3 campaigns", () => {
    expect(() =>
      toDiagnosticResult({ ...modelOutput, campaigns: modelOutput.campaigns.slice(0, 2) }),
    ).toThrow();
  });
});

describe("OpenAiDiagnosticProvider", () => {
  it("returns the model diagnosis and sends a strict json_schema request", async () => {
    const fetchImpl = vi.fn(async () => okResponse({ output_text: JSON.stringify(modelOutput) }));
    const provider = new OpenAiDiagnosticProvider({
      apiKey: "sk-test",
      model: "gpt-5-mini",
      fetchImpl: fetchImpl as unknown as typeof fetch,
      readSite: async () => site,
      logger: silent,
    });

    const result = await provider.generate(input);

    expect(result.brandSummary.name).toBe("Clínica Exemplo");
    expect(result.sourceRead).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.openai.com/v1/responses");
    const body = JSON.parse(String(init.body));
    expect(body.model).toBe("gpt-5-mini");
    expect(body.text.format.type).toBe("json_schema");
    expect(body.text.format.strict).toBe(true);
    expect(body.input).toContain("Campinas");
  });

  it("reads output from the output[] content shape too", async () => {
    const fetchImpl = vi.fn(async () =>
      okResponse({
        output: [{ content: [{ type: "output_text", text: JSON.stringify(modelOutput) }] }],
      }),
    );
    const provider = new OpenAiDiagnosticProvider({
      apiKey: "sk-test",
      fetchImpl: fetchImpl as unknown as typeof fetch,
      readSite: async () => site,
      logger: silent,
    });
    const result = await provider.generate(input);
    expect(result.diagnosis.opportunity).toBe("O site não mostra prova social.");
  });

  it("falls back to rules when OpenAI fails", async () => {
    const fetchImpl = vi.fn(async () => new Response("erro", { status: 500 }));
    const provider = new OpenAiDiagnosticProvider({
      apiKey: "sk-test",
      fetchImpl: fetchImpl as unknown as typeof fetch,
      readSite: async () => site,
      logger: silent,
    });
    const result = await provider.generate(input);
    expect(DiagnosticResultSchema.safeParse(result).success).toBe(true);
    expect(result.brandSummary.name).not.toBe("");
  });

  it("falls back on invalid model JSON", async () => {
    const fetchImpl = vi.fn(async () => okResponse({ output_text: "{ não é json" }));
    const provider = new OpenAiDiagnosticProvider({
      apiKey: "sk-test",
      fetchImpl: fetchImpl as unknown as typeof fetch,
      readSite: async () => site,
      logger: silent,
    });
    const result = await provider.generate(input);
    expect(DiagnosticResultSchema.safeParse(result).success).toBe(true);
  });

  it("does not call OpenAI when the site cannot be read", async () => {
    const fetchImpl = vi.fn();
    const provider = new OpenAiDiagnosticProvider({
      apiKey: "sk-test",
      fetchImpl: fetchImpl as unknown as typeof fetch,
      readSite: async () => {
        throw new Error("timeout");
      },
      logger: silent,
    });
    const result = await provider.generate(input);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(DiagnosticResultSchema.safeParse(result).success).toBe(true);
    expect(result.sourceRead).toBe(false);
  });

  it("does not call OpenAI without an API key", async () => {
    const fetchImpl = vi.fn();
    const provider = new OpenAiDiagnosticProvider({
      fetchImpl: fetchImpl as unknown as typeof fetch,
      readSite: async () => site,
      logger: silent,
    });
    await provider.generate(input);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
