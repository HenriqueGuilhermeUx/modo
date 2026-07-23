import { describe, expect, it } from "vitest";
import { buildDiagnosticFromPage } from "./demo-diagnostic-provider.js";

const baseInput = {
  instagramHandle: "",
} as const;

describe("DemoDiagnosticProvider evidence engine", () => {
  it("creates materially different diagnoses for union tech, legal AI and crypto fintech", () => {
    const sind = buildDiagnosticFromPage(
      {
        ...baseInput,
        websiteUrl: "https://sindcopilot.com.br",
        niche: "servicos_profissionais",
      },
      "SindCopilot | Inteligência para sindicatos",
      `
        O SindCopilot organiza documentos, atas, convenções coletivas e histórico da entidade em um só lugar.
        Dirigentes podem perguntar em linguagem natural e localizar rapidamente a base para responder associados.
        A plataforma ajuda a criar comunicados para a categoria e registrar decisões da diretoria sindical.
      `,
    );

    const nexjud = buildDiagnosticFromPage(
      {
        ...baseInput,
        websiteUrl: "https://nexjudsolucoes.com.br",
        niche: "servicos_profissionais",
      },
      "NexJud - Justiça Inteligente onDemand",
      `
        A IA jurídica que trabalha como um sócio do escritório.
        O NexJud analisa documentos, organiza casos, encontra riscos, monta estratégias, simula decisões e ajuda a criar peças jurídicas em um único workspace.
        Envie contrato, estatuto, ata, petição ou PDF. O Legal Brain cruza memória, jurisprudência, precedentes e CNJ.
        Comece com Trial Premium por 7 dias sem cartão.
      `,
    );

    const nexa = buildDiagnosticFromPage(
      {
        ...baseInput,
        websiteUrl: "https://trynexa.com.br",
        niche: "outro",
      },
      "Nexa - Experimente o dólar digital",
      `
        Experimente o dólar digital. R$ 10 é o tempo de um Pix.
        Deposite por Pix, converta para USDC, receba rendimento em dólar e pague qualquer QR Code Pix.
        A Nexa informa spread de 1,5%, zero IOF, liquidez 24/7, KYC e reservas auditadas.
      `,
    );

    expect(sind.brandSummary.segment).toContain("gestão sindical");
    expect(nexjud.brandSummary.segment).toContain("trabalho jurídico");
    expect(nexa.brandSummary.segment).toContain("dólar digital");

    expect(sind.diagnosis.opportunity).toContain("rotina sindical");
    expect(nexjud.diagnosis.opportunity).toContain("resposta jurídica auditável");
    expect(nexa.diagnosis.opportunity).toContain("caminho do dinheiro e do risco");

    expect(new Set([
      sind.diagnosis.opportunity,
      nexjud.diagnosis.opportunity,
      nexa.diagnosis.opportunity,
    ]).size).toBe(3);

    expect(new Set([
      sind.diagnosis.recommendation,
      nexjud.diagnosis.recommendation,
      nexa.diagnosis.recommendation,
    ]).size).toBe(3);

    expect(sind.campaigns[0].title).toContain("convenção");
    expect(nexjud.campaigns[0].title).toContain("documento");
    expect(nexa.campaigns[0].title).toContain("R$ 10");
  });

  it("grounds the finding in an actual page message", () => {
    const result = buildDiagnosticFromPage(
      {
        ...baseInput,
        websiteUrl: "https://example.com",
        niche: "educacao",
      },
      "Escola Exemplo",
      "Aprenda gestão financeira criando um plano aplicável ao seu negócio em quatro semanas. Cada aluno recebe acompanhamento e conclui um projeto real.",
    );

    expect(result.diagnosis.strength).toContain("Encontramos esta mensagem no site");
    expect(result.diagnosis.strength).toMatch(/Aprenda|aluno|projeto real/);
  });

  it("does not pretend to understand a page that could not be read", () => {
    const result = buildDiagnosticFromPage(
      {
        ...baseInput,
        websiteUrl: "https://indisponivel.example",
        niche: "outro",
      },
      "Indisponível",
      "Outro segmento",
      false,
    );

    expect(result.diagnosis.strength).toContain("Não foi possível ler conteúdo público suficiente");
    expect(result.diagnosis.opportunity).toContain("não pôde ser analisada com segurança");
  });
});
