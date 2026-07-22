import { nicheLabels, type DiagnosticCreateRequest, type DiagnosticResult } from "@modo/contracts";
import { extractPublicSource } from "../services/source-extractor.js";
import type { DiagnosticProvider } from "./diagnostic-provider.js";

const sleep = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));

function brandNameFromUrl(rawUrl: string): string {
  const hostname = new URL(rawUrl).hostname.replace(/^www\./, "");
  const firstPart = hostname.split(".")[0] ?? "Sua marca";
  return firstPart.split(/[-_]/).filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(" ");
}

function cleanBrandName(title: string, fallback: string) {
  const candidate = title.split(/\s+[|–—-]\s+/)[0]?.trim() || "";
  if (candidate.length < 2 || candidate.length > 60) return fallback;
  return candidate;
}

function sentences(text: string) {
  return text
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?])\s+/)
    .map((item) => item.trim())
    .filter((item) => item.length >= 35 && item.length <= 220);
}

function firstMatchingSentence(text: string, words: string[]) {
  const normalizedWords = words.map((word) => word.toLowerCase());
  return sentences(text).find((sentence) => {
    const normalized = sentence.toLowerCase();
    return normalizedWords.some((word) => normalized.includes(word));
  });
}

function detectedChannels(text: string) {
  const normalized = text.toLowerCase();
  const channels = [
    ["LinkedIn", "linkedin"],
    ["Instagram", "instagram"],
    ["Facebook", "facebook"],
    ["WhatsApp", "whatsapp"],
    ["TikTok", "tiktok"],
    ["YouTube", "youtube"],
  ] as const;
  return channels.filter(([, token]) => normalized.includes(token)).map(([label]) => label);
}

function audienceFor(input: DiagnosticCreateRequest, text: string) {
  const normalized = text.toLowerCase();
  if (normalized.includes("linkedin") && (normalized.includes("empresa") || normalized.includes("profissional"))) {
    return "Empresas e profissionais que precisam construir presença, autoridade e oportunidades";
  }
  const byNiche: Record<DiagnosticCreateRequest["niche"], string> = {
    saude_estetica: "Pessoas que buscam segurança, confiança e clareza antes de escolher um cuidado",
    servicos_profissionais: "Empresas e pessoas que precisam tomar uma decisão segura sobre um serviço especializado",
    imoveis: "Pessoas avaliando uma decisão imobiliária e buscando segurança durante a escolha",
    varejo: "Consumidores comparando opções, benefícios e confiança antes da compra",
    educacao: "Pessoas que desejam aprender, evoluir ou tomar uma decisão de formação",
    creator: "Pessoas interessadas no conhecimento, experiência e visão do criador",
    outro: "Pessoas que precisam entender rapidamente por que esta marca é relevante para elas",
  };
  return byNiche[input.niche];
}

function segmentFor(input: DiagnosticCreateRequest, text: string) {
  const normalized = text.toLowerCase();
  if ((normalized.includes("inteligência artificial") || normalized.includes(" ia ")) && normalized.includes("conteúdo")) {
    return "Plataforma de inteligência criativa e conteúdo";
  }
  if (normalized.includes("software") || normalized.includes("plataforma")) {
    return `Plataforma digital para ${nicheLabels[input.niche].toLowerCase()}`;
  }
  return nicheLabels[input.niche];
}

function offerFor(text: string, segment: string) {
  const sentence = firstMatchingSentence(text, [
    "ajuda", "transforma", "cria", "produz", "oferece", "plataforma", "solução", "serviço",
  ]);
  if (sentence) return sentence.replace(/^[-–—•\s]+/, "").slice(0, 180);
  return `Uma solução de ${segment.toLowerCase()} apresentada no site`;
}

function diagnosticFor(name: string, text: string, offer: string) {
  const normalized = text.toLowerCase();
  const channels = detectedChannels(text);
  const hasProof = /(depoimento|case|resultado|clientes|mais de \d|\d+%|economiz)/i.test(text);
  const hasDemo = /(demonstração|demo|exemplo|antes e depois|veja como|resultado pronto)/i.test(text);
  const hasManyCapabilities = ["cria", "planeja", "publica", "aprende", "agenda", "linkedin", "vídeo"]
    .filter((token) => normalized.includes(token)).length >= 4;

  const strength = channels.length
    ? `A página apresenta ${offer.toLowerCase()} e cita atuação em ${channels.join(", ")}.`
    : `A página comunica uma oferta reconhecível: ${offer}`;

  if (hasManyCapabilities && (!hasProof || !hasDemo)) {
    return {
      strength,
      opportunity: `${name} explica bastante valor, mas ainda faz o visitante imaginar o resultado.`,
      impact: "A pessoa percebe que a solução é ampla, porém não vê cedo o suficiente um antes e depois, uma entrega real ou uma transformação concreta. A curiosidade pode cair antes do próximo clique.",
      recommendation: "Mostrar na primeira rolagem uma transformação completa: o que o cliente entrega, o que recebe, quanto esforço economiza e qual será o próximo passo.",
    };
  }

  if (!hasProof) {
    return {
      strength,
      opportunity: `${name} apresenta a proposta antes de tornar a prova visível.`,
      impact: "Sem exemplos, resultados, demonstrações ou evidências próximas da promessa, o visitante precisa confiar antes de enxergar o que muda na prática.",
      recommendation: "Colocar uma demonstração real, um caso ou uma amostra do resultado imediatamente depois da promessa principal.",
    };
  }

  if (!hasDemo) {
    return {
      strength,
      opportunity: `A proposta de ${name} pode ficar mais tangível já no primeiro contato.`,
      impact: "O visitante entende o tema, mas ainda precisa montar mentalmente como a solução funciona e o que receberá ao avançar.",
      recommendation: "Criar uma sequência visual simples: entrada real, processo resumido, resultado entregue e chamada para experimentar.",
    };
  }

  return {
    strength,
    opportunity: `${name} já comunica valor; a oportunidade está em transformar atenção em uma próxima ação mais específica.`,
    impact: "Quando a chamada para ação é ampla, visitantes interessados podem adiar a decisão por não saberem exatamente o que acontecerá depois.",
    recommendation: "Trocar chamadas genéricas por uma ação concreta, com resultado e tempo estimado claramente informados.",
  };
}

export class DemoDiagnosticProvider implements DiagnosticProvider {
  constructor(private readonly delayMs = 2600) {}

  async generate(input: DiagnosticCreateRequest): Promise<DiagnosticResult> {
    await sleep(this.delayMs);
    const fallbackName = brandNameFromUrl(input.websiteUrl);
    let pageTitle = fallbackName;
    let pageText = "";

    try {
      const source = await extractPublicSource(input.websiteUrl);
      pageTitle = source.title;
      pageText = source.text;
    } catch {
      pageText = `${nicheLabels[input.niche]} ${input.instagramHandle || ""}`;
    }

    const name = cleanBrandName(pageTitle, fallbackName);
    const segment = segmentFor(input, pageText);
    const primaryOffer = offerFor(pageText, segment);
    const audience = audienceFor(input, pageText);
    const diagnosis = diagnosticFor(name, pageText, primaryOffer);

    return {
      brandSummary: {
        name,
        segment,
        primaryOffer,
        audience,
        positioning: diagnosis.opportunity,
      },
      diagnosis,
      campaigns: [
        {
          id: "proof-01",
          objective: "autoridade",
          eyebrow: "Prova de valor",
          title: `Antes de explicar tudo sobre ${name}, mostre esta transformação`,
          visualDirection: "Carrossel ou documento com quatro momentos: situação inicial, decisão, transformação e próximo passo. Usar elementos reais da página e uma comparação visual clara.",
          caption: `Quem chega até a ${name} precisa entender rapidamente o que muda na prática. Em vez de começar por todas as funcionalidades, mostre uma situação reconhecível, a direção adotada e o resultado que o cliente pode visualizar. Clareza primeiro; profundidade depois.`,
          hashtags: ["#provadevalor", "#posicionamento", "#presencadigital"],
          cta: "Veja como esta transformação funcionaria para a sua realidade.",
        },
        {
          id: "demand-01",
          objective: "leads",
          eyebrow: "Geração de demanda",
          title: `3 sinais de que você precisa da solução apresentada pela ${name}`,
          visualDirection: "Conteúdo vertical com três sintomas reconhecíveis, uma consequência e um convite para diagnóstico ou demonstração.",
          caption: `A melhor geração de demanda começa quando o público reconhece o próprio problema antes de receber a oferta. A ${name} pode transformar dúvidas recorrentes em sinais claros de que chegou a hora de agir.`,
          hashtags: ["#geracaodedemanda", "#conteudoestrategico", "#negocios"],
          cta: "Qual destes sinais aparece hoje na sua empresa?",
        },
        {
          id: "human-01",
          objective: "conexao",
          eyebrow: "Conexão humana",
          title: `A decisão por trás da ${name} que o site ainda não conta`,
          visualDirection: "Vídeo curto ou post de fundador com ambiente real, abertura direta, conflito, escolha e aprendizado.",
          caption: `Marcas ficam mais memoráveis quando o público entende por que elas existem e quais decisões moldam sua forma de trabalhar. Uma história real cria contexto, diferenciação e confiança sem depender de uma promessa publicitária.`,
          hashtags: ["#bastidores", "#historiademarca", "#autoridade"],
          cta: "Que decisão mudou a forma como sua empresa trabalha?",
        },
      ],
    };
  }
}
