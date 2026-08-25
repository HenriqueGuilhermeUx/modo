import type { Niche } from "@modo/contracts";
import {
  BrandScanResultSchema,
  type BrandScanResult,
  type BrandScanSourceType,
} from "@modo/contracts/brand-scan";
import type { BrandFoundation } from "@modo/contracts/strategy-network";
import { z } from "zod";
import { extractPublicSite } from "./source-extractor.js";

interface BrandScanServiceOptions {
  openAiApiKey?: string;
  openAiTextModel?: string;
  apifyBaseUrl?: string;
  apifyToken?: string;
  apifyWebsiteCrawlerActorId?: string;
  apifyInstagramScraperActorId?: string;
}

type SourceBundle = {
  sourceUrl: string;
  sourceType: BrandScanSourceType;
  text: string;
  pages: Array<{ sourceUrl: string; title: string }>;
  warnings: string[];
};

type OpenAiResponsePayload = {
  output_text?: string;
  output?: Array<{ content?: Array<{ type?: string; text?: string }> }>;
  error?: { message?: string };
};

const ChannelSchema = z.enum([
  "instagram",
  "facebook",
  "linkedin",
  "reels",
  "stories",
  "youtube_shorts",
  "tiktok",
  "whatsapp",
  "blog",
  "email",
  "website",
]);

const AiInferenceSchema = z.object({
  name: z.string().max(120),
  niche: z.enum([
    "saude_estetica",
    "servicos_profissionais",
    "imoveis",
    "varejo",
    "educacao",
    "creator",
    "outro",
  ]),
  audiencePriority: z.string().max(1500),
  audienceContext: z.string().max(1500),
  pains: z.array(z.string().max(240)).max(10),
  desires: z.array(z.string().max(240)).max(10),
  objections: z.array(z.string().max(240)).max(10),
  decisionTriggers: z.array(z.string().max(240)).max(10),
  belief: z.string().max(1500),
  marketProblem: z.string().max(1500),
  desiredChange: z.string().max(1500),
  category: z.string().max(1000),
  differentiator: z.string().max(1500),
  forWhom: z.string().max(1500),
  notForWhom: z.string().max(1500),
  territory: z.string().max(1000),
  transformation: z.string().max(1500),
  mainBenefit: z.string().max(1500),
  boundaries: z.string().max(1500),
  personalityAttributes: z.array(z.string().max(120)).max(8),
  tone: z.string().max(1000),
  preferredWords: z.array(z.string().max(120)).max(10),
  prohibitedWords: z.array(z.string().max(120)).max(10),
  visualStyle: z.string().max(1200),
  origin: z.string().max(1500),
  cases: z.array(z.string().max(240)).max(10),
  numbers: z.array(z.string().max(240)).max(10),
  testimonials: z.array(z.string().max(240)).max(8),
  environments: z.array(z.string().max(180)).max(10),
  people: z.array(z.string().max(180)).max(10),
  objects: z.array(z.string().max(180)).max(10),
  themes: z.array(z.string().max(180)).max(10),
  visualReferences: z.array(z.string().max(180)).max(10),
  spokespersons: z.array(z.string().max(180)).max(10),
  team: z.array(z.string().max(180)).max(10),
  customers: z.array(z.string().max(180)).max(10),
  productsOrServices: z.array(z.string().max(180)).max(20),
  proofAvailable: z.array(z.string().max(240)).max(20),
  recurringQuestions: z.array(z.string().max(300)).max(15),
  prohibitedTopics: z.array(z.string().max(240)).max(15),
  preferredChannels: z.array(ChannelSchema).max(9),
  suggestedPriorities: z.array(z.string().max(240)).max(8),
  evidence: z.array(z.object({
    field: z.string().max(120),
    evidence: z.string().max(500),
  })).max(16),
  needsConfirmation: z.array(z.string().max(240)).max(16),
  confidence: z.number().min(0).max(1),
});

type AiInference = z.infer<typeof AiInferenceSchema>;

const inferenceJsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    name: { type: "string" },
    niche: { type: "string", enum: ["saude_estetica", "servicos_profissionais", "imoveis", "varejo", "educacao", "creator", "outro"] },
    audiencePriority: { type: "string" },
    audienceContext: { type: "string" },
    pains: { type: "array", items: { type: "string" }, maxItems: 10 },
    desires: { type: "array", items: { type: "string" }, maxItems: 10 },
    objections: { type: "array", items: { type: "string" }, maxItems: 10 },
    decisionTriggers: { type: "array", items: { type: "string" }, maxItems: 10 },
    belief: { type: "string" },
    marketProblem: { type: "string" },
    desiredChange: { type: "string" },
    category: { type: "string" },
    differentiator: { type: "string" },
    forWhom: { type: "string" },
    notForWhom: { type: "string" },
    territory: { type: "string" },
    transformation: { type: "string" },
    mainBenefit: { type: "string" },
    boundaries: { type: "string" },
    personalityAttributes: { type: "array", items: { type: "string" }, maxItems: 8 },
    tone: { type: "string" },
    preferredWords: { type: "array", items: { type: "string" }, maxItems: 10 },
    prohibitedWords: { type: "array", items: { type: "string" }, maxItems: 10 },
    visualStyle: { type: "string" },
    origin: { type: "string" },
    cases: { type: "array", items: { type: "string" }, maxItems: 10 },
    numbers: { type: "array", items: { type: "string" }, maxItems: 10 },
    testimonials: { type: "array", items: { type: "string" }, maxItems: 8 },
    environments: { type: "array", items: { type: "string" }, maxItems: 10 },
    people: { type: "array", items: { type: "string" }, maxItems: 10 },
    objects: { type: "array", items: { type: "string" }, maxItems: 10 },
    themes: { type: "array", items: { type: "string" }, maxItems: 10 },
    visualReferences: { type: "array", items: { type: "string" }, maxItems: 10 },
    spokespersons: { type: "array", items: { type: "string" }, maxItems: 10 },
    team: { type: "array", items: { type: "string" }, maxItems: 10 },
    customers: { type: "array", items: { type: "string" }, maxItems: 10 },
    productsOrServices: { type: "array", items: { type: "string" }, maxItems: 20 },
    proofAvailable: { type: "array", items: { type: "string" }, maxItems: 20 },
    recurringQuestions: { type: "array", items: { type: "string" }, maxItems: 15 },
    prohibitedTopics: { type: "array", items: { type: "string" }, maxItems: 15 },
    preferredChannels: { type: "array", items: { type: "string", enum: ["instagram", "facebook", "linkedin", "reels", "stories", "youtube_shorts", "tiktok", "whatsapp", "blog", "email", "website"] }, maxItems: 9 },
    suggestedPriorities: { type: "array", items: { type: "string" }, maxItems: 8 },
    evidence: {
      type: "array",
      maxItems: 16,
      items: {
        type: "object",
        additionalProperties: false,
        properties: { field: { type: "string" }, evidence: { type: "string" } },
        required: ["field", "evidence"],
      },
    },
    needsConfirmation: { type: "array", items: { type: "string" }, maxItems: 16 },
    confidence: { type: "number", minimum: 0, maximum: 1 },
  },
  required: [
    "name", "niche", "audiencePriority", "audienceContext", "pains", "desires", "objections", "decisionTriggers",
    "belief", "marketProblem", "desiredChange", "category", "differentiator", "forWhom", "notForWhom", "territory",
    "transformation", "mainBenefit", "boundaries", "personalityAttributes", "tone", "preferredWords", "prohibitedWords",
    "visualStyle", "origin", "cases", "numbers", "testimonials", "environments", "people", "objects", "themes",
    "visualReferences", "spokespersons", "team", "customers", "productsOrServices", "proofAvailable", "recurringQuestions",
    "prohibitedTopics", "preferredChannels", "suggestedPriorities", "evidence", "needsConfirmation", "confidence"
  ],
} as const;

const scanSystemPrompt = `Você é o analista de onboarding da MODO. Sua função é transformar evidências públicas de uma empresa em uma HIPÓTESE de Base Estratégica para confirmação humana.
Regras obrigatórias:
- escreva em português do Brasil;
- use somente fatos e sinais presentes no material fornecido;
- não invente clientes, números, depoimentos, preços, resultados, certificações, equipe ou diferenciais;
- quando um campo não estiver sustentado, retorne string vazia ou array vazio e inclua o tema em needsConfirmation;
- inferências plausíveis de público, problema, benefício ou tom são permitidas, mas devem ser conservadoras e entrar em needsConfirmation quando não forem explícitas;
- mantenha casos, números e depoimentos vazios se não houver evidência textual direta;
- não trate linguagem promocional do site como prova factual de resultado;
- suggestedPriorities deve refletir oportunidades de marketing, não fatos sobre a empresa;
- preferredChannels só deve incluir canais citados no material ou claramente adequados como hipótese, e neste último caso deve constar em needsConfirmation;
- evidence deve conter trechos curtos do material que sustentem os campos mais importantes;
- entregue exatamente o JSON solicitado.`;

export class BrandScanError extends Error {
  constructor(
    public readonly code: string,
    public readonly statusCode: number,
    message: string,
  ) {
    super(message);
    this.name = "BrandScanError";
  }
}

function extractOutputText(payload: OpenAiResponsePayload) {
  if (payload.output_text?.trim()) return payload.output_text.trim();
  for (const item of payload.output || []) {
    for (const content of item.content || []) {
      if (content.type === "output_text" && content.text?.trim()) return content.text.trim();
    }
  }
  return "";
}

function cleanText(value: unknown, limit = 4000) {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, limit) : "";
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function actorPath(actorId: string) {
  return actorId.trim().replace(/^actors\//, "").replace("/", "~");
}

function normalizeUrl(rawUrl: string) {
  const value = rawUrl.trim();
  const normalized = /^https?:\/\//i.test(value) ? value : `https://${value}`;
  const url = new URL(normalized);
  url.hash = "";
  return url.toString();
}

function isInstagramUrl(rawUrl: string) {
  const host = new URL(rawUrl).hostname.toLowerCase().replace(/^www\./, "");
  return host === "instagram.com" || host.endsWith(".instagram.com");
}

function instagramHandleFromUrl(rawUrl: string) {
  const url = new URL(rawUrl);
  const first = url.pathname.split("/").filter(Boolean)[0] || "";
  if (["p", "reel", "reels", "stories", "explore"].includes(first.toLowerCase())) return "";
  return first ? `@${first.replace(/^@/, "")}` : "";
}

function websiteNameFallback(rawUrl: string) {
  const hostname = new URL(rawUrl).hostname.replace(/^www\./, "");
  const part = hostname.split(".")[0] || "Marca";
  return part
    .split(/[-_]/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ") || "Marca";
}

function foundationFromInference(value: AiInference): BrandFoundation {
  return {
    audience: {
      priority: value.audiencePriority,
      context: value.audienceContext,
      pains: value.pains,
      desires: value.desires,
      objections: value.objections,
      decisionTriggers: value.decisionTriggers,
    },
    worldview: {
      belief: value.belief,
      marketProblem: value.marketProblem,
      desiredChange: value.desiredChange,
    },
    positioning: {
      category: value.category,
      differentiator: value.differentiator,
      forWhom: value.forWhom,
      notForWhom: value.notForWhom,
      territory: value.territory,
    },
    promise: {
      transformation: value.transformation,
      mainBenefit: value.mainBenefit,
      boundaries: value.boundaries,
    },
    personality: {
      attributes: value.personalityAttributes,
      tone: value.tone,
      preferredWords: value.preferredWords,
      prohibitedWords: value.prohibitedWords,
      visualStyle: value.visualStyle,
    },
    proof: {
      origin: value.origin,
      cases: value.cases,
      numbers: value.numbers,
      testimonials: value.testimonials,
    },
    universe: {
      environments: value.environments,
      people: value.people,
      objects: value.objects,
      themes: value.themes,
      visualReferences: value.visualReferences,
    },
    humanPresence: {
      spokespersons: value.spokespersons,
      team: value.team,
      customers: value.customers,
      cameraAvailability: "low",
      notes: "Disponibilidade para câmera precisa ser confirmada pela empresa.",
    },
  };
}

export class BrandScanService {
  private readonly openAiApiKey?: string;
  private readonly openAiTextModel: string;
  private readonly apifyBaseUrl: string;
  private readonly apifyToken?: string;
  private readonly websiteActorId: string;
  private readonly instagramActorId: string;

  constructor(options: BrandScanServiceOptions = {}) {
    this.openAiApiKey = options.openAiApiKey?.trim() || undefined;
    this.openAiTextModel = options.openAiTextModel || "gpt-5-mini";
    this.apifyBaseUrl = (options.apifyBaseUrl || "https://api.apify.com/v2").replace(/\/$/, "");
    this.apifyToken = options.apifyToken?.trim() || undefined;
    this.websiteActorId = options.apifyWebsiteCrawlerActorId || "apify/website-content-crawler";
    this.instagramActorId = options.apifyInstagramScraperActorId || "apify/instagram-scraper";
  }

  get configured() {
    return Boolean(this.openAiApiKey);
  }

  get instagramConfigured() {
    return Boolean(this.apifyToken);
  }

  async scan(rawUrl: string): Promise<BrandScanResult> {
    if (!this.openAiApiKey) {
      throw new BrandScanError(
        "BRAND_SCAN_AI_NOT_CONFIGURED",
        503,
        "O onboarding inteligente ainda não está configurado neste ambiente.",
      );
    }

    const sourceUrl = normalizeUrl(rawUrl);
    const source = isInstagramUrl(sourceUrl)
      ? await this.extractInstagram(sourceUrl)
      : await this.extractWebsite(sourceUrl);
    if (source.text.length < 120) {
      throw new BrandScanError(
        "BRAND_SCAN_INSUFFICIENT_SOURCE",
        422,
        "Não encontramos contexto público suficiente. Tente o site principal da empresa ou preencha manualmente.",
      );
    }

    const inference = await this.infer(source);
    const fallbackName = websiteNameFallback(sourceUrl);
    const name = inference.name.trim() || fallbackName;
    const instagramHandle = isInstagramUrl(sourceUrl) ? instagramHandleFromUrl(sourceUrl) : "";

    return BrandScanResultSchema.parse({
      sourceUrl,
      sourceType: source.sourceType,
      brand: {
        name,
        niche: inference.niche as Niche,
        websiteUrl: isInstagramUrl(sourceUrl) ? "" : sourceUrl,
        instagramHandle,
      },
      foundation: foundationFromInference(inference),
      suggestedProfile: {
        productsOrServicesToShow: inference.productsOrServices,
        proofAvailable: inference.proofAvailable,
        recurringQuestions: inference.recurringQuestions,
        prohibitedTopics: inference.prohibitedTopics,
        preferredChannels: inference.preferredChannels,
        suggestedPriorities: inference.suggestedPriorities,
      },
      evidence: inference.evidence.map((item) => ({
        ...item,
        sourceUrl,
      })),
      needsConfirmation: [
        ...new Set([
          ...inference.needsConfirmation,
          "Objetivo comercial atual",
          "Disponibilidade de pessoas para aparecer nos conteúdos",
          "Tempo real disponível por semana",
        ]),
      ].slice(0, 20),
      warnings: source.warnings,
      pagesAnalyzed: source.pages,
      confidence: inference.confidence,
    });
  }

  private async extractWebsite(sourceUrl: string): Promise<SourceBundle> {
    try {
      const native = await extractPublicSite(sourceUrl);
      if (native.text.length >= 500) {
        return {
          sourceUrl: native.sourceUrl,
          sourceType: "website_native",
          text: native.text,
          pages: native.pages.map((page) => ({ sourceUrl: page.sourceUrl, title: page.title })),
          warnings: [],
        };
      }
    } catch (error) {
      if (!this.apifyToken) {
        throw new BrandScanError(
          "BRAND_SCAN_SOURCE_FAILED",
          400,
          error instanceof Error ? error.message : "Não foi possível ler o site informado.",
        );
      }
    }

    if (!this.apifyToken) {
      throw new BrandScanError(
        "BRAND_SCAN_SOURCE_FAILED",
        422,
        "O site retornou pouco conteúdo público. Tente outra página da empresa.",
      );
    }
    return this.extractWebsiteWithApify(sourceUrl);
  }

  private async extractWebsiteWithApify(sourceUrl: string): Promise<SourceBundle> {
    const items = await this.runActor(this.websiteActorId, {
      startUrls: [{ url: sourceUrl }],
      maxCrawlPages: 5,
    });
    const pages = items.slice(0, 5).map((item) => {
      const metadata = asRecord(item.metadata);
      const url = cleanText(item.url ?? item.loadedUrl ?? metadata.url, 1000) || sourceUrl;
      const title = cleanText(item.title ?? metadata.title, 300) || new URL(url).hostname;
      const text = cleanText(item.markdown ?? item.text ?? item.content, 20_000);
      return { sourceUrl: url, title, text };
    }).filter((item) => item.text.length > 60);
    return {
      sourceUrl,
      sourceType: "website_apify",
      text: pages.map((page) => `PÁGINA: ${page.title}\nURL: ${page.sourceUrl}\n${page.text}`).join("\n\n").slice(0, 70_000),
      pages: pages.map(({ sourceUrl: url, title }) => ({ sourceUrl: url, title })),
      warnings: ["O site precisou de leitura avançada para capturar o conteúdo público."],
    };
  }

  private async extractInstagram(sourceUrl: string): Promise<SourceBundle> {
    if (!this.apifyToken) {
      throw new BrandScanError(
        "BRAND_SCAN_INSTAGRAM_NOT_CONFIGURED",
        503,
        "A leitura de Instagram precisa da integração Apify configurada. Use o site da empresa por enquanto.",
      );
    }
    const items = await this.runActor(this.instagramActorId, {
      directUrls: [sourceUrl],
      resultsType: "posts",
      resultsLimit: 12,
    });
    const handle = instagramHandleFromUrl(sourceUrl).replace(/^@/, "");
    const lines: string[] = [];
    const pages: Array<{ sourceUrl: string; title: string }> = [];
    for (const item of items.slice(0, 15)) {
      const owner = cleanText(item.ownerFullName ?? item.fullName ?? item.name, 160);
      const username = cleanText(item.ownerUsername ?? item.username, 100) || handle;
      const biography = cleanText(item.biography ?? item.bio, 1200);
      const caption = cleanText(item.caption ?? item.text, 4000);
      const url = cleanText(item.url ?? item.postUrl ?? item.inputUrl, 1000) || sourceUrl;
      if (owner) lines.push(`NOME: ${owner}`);
      if (username) lines.push(`PERFIL: @${username.replace(/^@/, "")}`);
      if (biography) lines.push(`BIO: ${biography}`);
      if (caption) lines.push(`PUBLICAÇÃO: ${caption}`);
      pages.push({ sourceUrl: url, title: caption.slice(0, 100) || `Instagram @${username || handle}` });
    }
    return {
      sourceUrl,
      sourceType: "instagram_apify",
      text: [...new Set(lines)].join("\n").slice(0, 60_000),
      pages: pages.slice(0, 12),
      warnings: ["Conteúdo inferido a partir de informações públicas recentes do Instagram; confirme oferta, público e posicionamento antes de salvar."],
    };
  }

  private async runActor(actorId: string, input: Record<string, unknown>) {
    const url = `${this.apifyBaseUrl}/acts/${actorPath(actorId)}/run-sync-get-dataset-items?clean=true&format=json&token=${encodeURIComponent(this.apifyToken || "")}`;
    const response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
      signal: AbortSignal.timeout(120_000),
    });
    const payload = await response.json().catch(() => ([])) as unknown;
    if (!response.ok) {
      const record = asRecord(payload);
      const error = asRecord(record.error);
      throw new BrandScanError(
        "BRAND_SCAN_APIFY_FAILED",
        502,
        cleanText(error.message, 500) || `A fonte avançada respondeu com código ${response.status}.`,
      );
    }
    if (!Array.isArray(payload)) {
      throw new BrandScanError("BRAND_SCAN_APIFY_INVALID_RESPONSE", 502, "A fonte avançada não devolveu conteúdo utilizável.");
    }
    return payload.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object" && !Array.isArray(item));
  }

  private async infer(source: SourceBundle): Promise<AiInference> {
    const prompt = [
      `FONTE PRINCIPAL: ${source.sourceUrl}`,
      `TIPO DE FONTE: ${source.sourceType}`,
      `PÁGINAS ANALISADAS: ${source.pages.map((page) => page.sourceUrl).join(" | ")}`,
      "",
      "CONTEÚDO PÚBLICO EXTRAÍDO:",
      source.text.slice(0, 65_000),
      "",
      "Monte uma hipótese estratégica útil para onboarding. Deixe vazio tudo que não esteja sustentado e sinalize o que o cliente precisa confirmar.",
    ].join("\n");

    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.openAiApiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: this.openAiTextModel,
        store: false,
        input: [
          { role: "system", content: [{ type: "input_text", text: scanSystemPrompt }] },
          { role: "user", content: [{ type: "input_text", text: prompt }] },
        ],
        text: {
          format: {
            type: "json_schema",
            name: "modo_brand_scan",
            strict: true,
            schema: inferenceJsonSchema,
          },
        },
      }),
      signal: AbortSignal.timeout(90_000),
    });
    const payload = await response.json() as OpenAiResponsePayload;
    if (!response.ok) {
      throw new BrandScanError(
        "BRAND_SCAN_AI_FAILED",
        502,
        payload.error?.message || `A análise estratégica respondeu com código ${response.status}.`,
      );
    }
    const text = extractOutputText(payload);
    if (!text) throw new BrandScanError("BRAND_SCAN_AI_EMPTY", 502, "A análise estratégica não devolveu uma hipótese utilizável.");
    try {
      return AiInferenceSchema.parse(JSON.parse(text));
    } catch {
      throw new BrandScanError("BRAND_SCAN_AI_INVALID", 502, "A análise estratégica retornou dados incompletos. Tente novamente.");
    }
  }
}
