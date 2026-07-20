import { nicheLabels, type DiagnosticCreateRequest, type DiagnosticResult } from "@modo/contracts";
import type { DiagnosticProvider } from "./diagnostic-provider.js";

const sleep = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));

function brandNameFromUrl(rawUrl: string): string {
  const hostname = new URL(rawUrl).hostname.replace(/^www\./, "");
  const firstPart = hostname.split(".")[0] ?? "Sua marca";
  return firstPart.split(/[-_]/).filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(" ");
}

export class DemoDiagnosticProvider implements DiagnosticProvider {
  constructor(private readonly delayMs = 2600) {}

  async generate(input: DiagnosticCreateRequest): Promise<DiagnosticResult> {
    await sleep(this.delayMs);
    const name = brandNameFromUrl(input.websiteUrl);
    const segment = nicheLabels[input.niche];

    return {
      brandSummary: {
        name,
        segment,
        primaryOffer: `Soluções especializadas em ${segment.toLowerCase()}`,
        audience: "Pessoas que buscam confiança, clareza e uma decisão segura",
        positioning: "Uma marca com conhecimento relevante, mas que pode transformar melhor sua experiência em conteúdo recorrente.",
      },
      diagnosis: {
        strength: "A proposta transmite especialização e possui matéria-prima suficiente para construir autoridade.",
        opportunity: "O conteúdo pode conectar melhor conhecimento, prova de valor e chamadas para ação em uma sequência editorial consistente.",
        impact: "Sem essa cadência, a marca depende de publicações isoladas e perde oportunidades de permanecer presente durante a decisão do público.",
        recommendation: "Organizar o próximo ciclo em três frentes: autoridade, geração de demanda e conexão humana.",
      },
      campaigns: [
        {
          id: "authority-01", objective: "autoridade", eyebrow: "Autoridade",
          title: `O que ninguém explica antes de escolher uma solução em ${segment}`,
          visualDirection: "Carrossel limpo com uma pergunta forte na capa, três critérios práticos e fechamento com posicionamento da marca.",
          caption: `Escolher apenas pelo preço pode esconder fatores que mudam completamente o resultado. Neste conteúdo, a ${name} apresenta os critérios que ajudam o público a comparar opções com mais segurança e clareza.`,
          hashtags: ["#autoridade", "#conteudoestrategico", "#presencadigital"],
          cta: "Salve este conteúdo para consultar antes da sua próxima decisão.",
        },
        {
          id: "leads-01", objective: "leads", eyebrow: "Geração de demanda",
          title: "3 sinais de que está na hora de buscar uma solução especializada",
          visualDirection: "Post vertical com checklist visual, contraste azul e destaque verde no último sinal.",
          caption: `Nem sempre o problema está na falta de esforço — muitas vezes falta direção. A ${name} reuniu três sinais que indicam quando uma avaliação especializada pode economizar tempo e evitar retrabalho.`,
          hashtags: ["#geracaodeleads", "#negocios", "#estrategia"],
          cta: "Fale com a nossa equipe e entenda qual caminho faz sentido para você.",
        },
        {
          id: "connection-01", objective: "conexao", eyebrow: "Conexão",
          title: `Por trás da ${name}: como transformamos atenção em cuidado`,
          visualDirection: "Sequência humanizada com bastidor real, uma frase curta e detalhes do processo da equipe.",
          caption: "Toda entrega começa muito antes do resultado final. Mostrar o processo, as decisões e as pessoas por trás da marca cria familiaridade e torna a confiança mais concreta.",
          hashtags: ["#bastidores", "#marcahumana", "#conexao"],
          cta: "Qual parte do nosso processo você gostaria de conhecer melhor?",
        },
      ],
    };
  }
}
