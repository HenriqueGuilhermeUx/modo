import {
  DiagnosticResultSchema,
  nicheLabels,
  type DiagnosticCreateRequest,
  type DiagnosticResult,
} from "@modo/contracts";
import { extractPublicSite } from "../services/source-extractor.js";
import type { DiagnosticProvider } from "./diagnostic-provider.js";
import { buildDiagnosticFromPage } from "./demo-diagnostic-provider.js";

/** Quanto do texto do site vai para o modelo (custo e latência). */
const MAX_PROMPT_TEXT = 12_000;
const OPENAI_TIMEOUT_MS = 30_000;

type SiteReader = (url: string) => Promise<{ title: string; text: string }>;

export interface OpenAiDiagnosticOptions {
  apiKey?: string;
  model?: string;
  fetchImpl?: typeof fetch;
  readSite?: SiteReader;
  timeoutMs?: number;
  logger?: Pick<Console, "warn">;
}

const OBJECTIVES = ["autoridade", "leads", "conexao"] as const;

/**
 * JSON Schema estrito para a Responses API (structured outputs).
 * O `id` das campanhas é atribuído pelo servidor, não pelo modelo.
 */
const RESPONSE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["brandSummary", "diagnosis", "campaigns"],
  properties: {
    brandSummary: {
      type: "object",
      additionalProperties: false,
      required: ["name", "segment", "primaryOffer", "audience", "positioning"],
      properties: {
        name: { type: "string" },
        segment: { type: "string" },
        primaryOffer: { type: "string" },
        audience: { type: "string" },
        positioning: { type: "string" },
      },
    },
    diagnosis: {
      type: "object",
      additionalProperties: false,
      required: ["strength", "opportunity", "impact", "recommendation"],
      properties: {
        strength: { type: "string" },
        opportunity: { type: "string" },
        impact: { type: "string" },
        recommendation: { type: "string" },
      },
    },
    campaigns: {
      type: "array",
      minItems: 3,
      maxItems: 3,
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "objective",
          "eyebrow",
          "title",
          "visualDirection",
          "caption",
          "hashtags",
          "cta",
        ],
        properties: {
          objective: { type: "string", enum: [...OBJECTIVES] },
          eyebrow: { type: "string" },
          title: { type: "string" },
          visualDirection: { type: "string" },
          caption: { type: "string" },
          hashtags: { type: "array", items: { type: "string" } },
          cta: { type: "string" },
        },
      },
    },
  },
} as const;

const INSTRUCTIONS = [
  "Você é o MODO Scan, o diagnóstico de marketing da MODO para pequenos negócios de serviços no Brasil.",
  "Leia o texto do site e devolva um diagnóstico curto, específico e em português do Brasil.",
  "Regras:",
  "- Use só o que está no texto do site, no segmento e no @ informados. Não invente prêmios, números, depoimentos, preços ou resultados.",
  "- Se algo não aparece no site, diga isso de forma útil (ex.: 'o site não mostra prova social') em vez de supor.",
  "- Não prometa vendas ou clientes. Fale de clareza, constância e confiança.",
  "- Linguagem simples, para quem não é de marketing. Frases curtas.",
  "- Gere exatamente 3 ideias de post, uma para cada objetivo, nesta ordem: autoridade, leads, conexao.",
  "- Cada legenda tem até 600 caracteres, tom da própria marca, e termina com uma chamada para ação clara.",
  "- Hashtags: de 3 a 6, sem espaços, começando com #, relevantes para o segmento e a cidade quando houver.",
  "- visualDirection descreve a imagem ou carrossel em uma frase prática.",
  "- Respeite regras de publicidade do segmento (ex.: saúde e advocacia não prometem resultado nem mostram antes/depois).",
].join("\n");

function buildPrompt(input: DiagnosticCreateRequest, title: string, text: string) {
  return [
    `Site: ${input.websiteUrl}`,
    `Segmento escolhido pelo cliente: ${nicheLabels[input.niche]}`,
    `Instagram: ${input.instagramHandle ? input.instagramHandle : "não informado"}`,
    `Título da página: ${title}`,
    "Texto extraído do site (pode estar incompleto):",
    "<<<",
    text.slice(0, MAX_PROMPT_TEXT),
    ">>>",
  ].join("\n");
}

function extractOutputText(data: unknown): string | undefined {
  const payload = data as {
    output_text?: unknown;
    output?: Array<{ content?: Array<{ type?: string; text?: string }> }>;
  };
  if (typeof payload.output_text === "string") return payload.output_text;
  return payload.output
    ?.flatMap((item) => item.content ?? [])
    .find((part) => part.type === "output_text")?.text;
}

function normalizeHashtag(tag: string) {
  const clean = tag.replace(/\s+/g, "").replace(/^#+/, "");
  return clean ? `#${clean}` : "";
}

/** Converte a resposta do modelo no contrato público, com ids estáveis. */
export function toDiagnosticResult(raw: unknown): DiagnosticResult {
  const candidate = raw as { campaigns?: Array<Record<string, unknown>> };
  const campaigns = (candidate.campaigns ?? []).map((campaign, index) => ({
    ...campaign,
    id: `scan-${OBJECTIVES[index] ?? index}`,
    hashtags: Array.isArray(campaign.hashtags)
      ? (campaign.hashtags as string[]).map(normalizeHashtag).filter(Boolean).slice(0, 6)
      : [],
  }));
  return DiagnosticResultSchema.parse({ ...(raw as object), campaigns, sourceRead: true });
}

/**
 * Diagnóstico do MODO Scan com a OpenAI.
 *
 * Lê o site público, pede ao modelo um diagnóstico estruturado e valida o
 * resultado. Em qualquer falha (sem chave, site ilegível, timeout, resposta
 * inválida) devolve o diagnóstico por regras do provedor demo, para que o
 * visitante nunca fique sem resposta.
 */
export class OpenAiDiagnosticProvider implements DiagnosticProvider {
  private readonly fetchImpl: typeof fetch;
  private readonly readSite: SiteReader;
  private readonly logger: Pick<Console, "warn">;

  constructor(private readonly options: OpenAiDiagnosticOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.readSite = options.readSite ?? extractPublicSite;
    this.logger = options.logger ?? console;
  }

  async generate(input: DiagnosticCreateRequest): Promise<DiagnosticResult> {
    let title = "";
    let text = "";
    let sourceRead = false;
    try {
      const source = await this.readSite(input.websiteUrl);
      title = source.title;
      text = source.text;
      sourceRead = text.trim().length > 0;
    } catch {
      // Sem leitura do site: o fallback deixa isso explícito para o visitante.
    }

    const fallback = () =>
      buildDiagnosticFromPage(
        input,
        title,
        text || `${nicheLabels[input.niche]} ${input.instagramHandle || ""}`,
        sourceRead,
      );

    // Sem texto do site, o modelo só poderia inventar. Melhor o fallback honesto.
    if (!this.options.apiKey || !sourceRead) return fallback();

    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      this.options.timeoutMs ?? OPENAI_TIMEOUT_MS,
    );
    try {
      const response = await this.fetchImpl("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: {
          authorization: `Bearer ${this.options.apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: this.options.model || "gpt-5-mini",
          instructions: INSTRUCTIONS,
          input: buildPrompt(input, title, text),
          text: {
            format: {
              type: "json_schema",
              name: "modo_scan_diagnostic",
              strict: true,
              schema: RESPONSE_SCHEMA,
            },
          },
        }),
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`OpenAI respondeu com status ${response.status}.`);
      const outputText = extractOutputText(await response.json());
      if (!outputText) throw new Error("OpenAI não devolveu texto.");
      return toDiagnosticResult(JSON.parse(outputText));
    } catch (error) {
      this.logger.warn(
        `[modo-scan] diagnóstico OpenAI falhou, usando regras: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return fallback();
    } finally {
      clearTimeout(timeout);
    }
  }
}
