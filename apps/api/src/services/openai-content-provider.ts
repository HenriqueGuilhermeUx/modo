import type { Brand } from "@modo/contracts";
import {
  GeneratedContentSchema,
  type ContentRequest,
  type ContentVisualAsset,
  type GeneratedContent,
} from "@modo/contracts/content";
import { nicheTemplates, type NicheTemplate } from "@modo/contracts/niche-templates";
import { ContentAssetService } from "./content-asset-service.js";
import {
  formatCreativeContext,
  loadCreativeGenerationContext,
} from "./creative-context.js";

interface OpenAiContentProviderOptions {
  apiKey: string;
  textModel?: string;
  imageModel?: string;
  assets: ContentAssetService;
}

type OpenAiResponsePayload = {
  id?: string;
  output_text?: string;
  output?: Array<{
    content?: Array<{ type?: string; text?: string }>;
  }>;
  error?: { message?: string };
};

type OpenAiImagePayload = {
  data?: Array<{ b64_json?: string }>;
  error?: { message?: string };
};

type VisualSpec = {
  kind: ContentVisualAsset["kind"];
  index: number;
  label: string;
  imagePrompt: string;
  imageAlt: string;
};

const contentJsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    hook: { type: "string" },
    title: { type: "string" },
    caption: { type: "string" },
    cta: { type: "string" },
    hashtags: { type: "array", items: { type: "string" }, maxItems: 15 },
    visualDirection: { type: "string" },
    slides: {
      type: "array",
      maxItems: 12,
      items: {
        type: "object",
        additionalProperties: false,
        properties: { title: { type: "string" }, body: { type: "string" } },
        required: ["title", "body"],
      },
    },
    script: {
      type: "array",
      maxItems: 12,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          scene: { type: "string" },
          visual: { type: "string" },
          voiceover: { type: "string" },
        },
        required: ["scene", "visual", "voiceover"],
      },
    },
    storyFrames: {
      type: "array",
      maxItems: 10,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          headline: { type: "string" },
          body: { type: "string" },
          interaction: { type: "string" },
        },
        required: ["headline", "body", "interaction"],
      },
    },
    adaptationNotes: { type: "array", items: { type: "string" }, maxItems: 10 },
    imagePrompt: { type: "string" },
    imageAlt: { type: "string" },
  },
  required: [
    "hook",
    "title",
    "caption",
    "cta",
    "hashtags",
    "visualDirection",
    "slides",
    "script",
    "storyFrames",
    "adaptationNotes",
    "imagePrompt",
    "imageAlt",
  ],
} as const;

const systemPrompt = `Você é o Diretor de Criação da MODO, uma agência inteligente brasileira.
Crie conteúdo publicitário útil, específico e pronto para revisão humana.
Regras obrigatórias:
- escreva em português do Brasil;
- use apenas fatos presentes no briefing ou no contexto da marca;
- não invente números, depoimentos, prêmios, clientes, garantias ou resultados;
- não faça promessas exageradas;
- respeite temas proibidos e restrições informadas;
- adapte linguagem, formato e CTA ao canal e ao objetivo;
- para serviços financeiros, cripto, saúde, jurídico ou outros setores sensíveis, use linguagem informativa e responsável;
- trate o modelo do segmento apenas como repertório de direção; briefing, fatos, restrições, Base Estratégica, memória e aprendizados reais da marca têm prioridade;
- o prompt visual deve descrever uma imagem publicitária forte, coerente com a marca e sem texto, logotipo ou marca-d'água; deixe área limpa para sobreposição do título no Studio;
- preencha somente a estrutura correspondente ao formato solicitado;
- entregue exatamente o JSON solicitado.`;

function extractOutputText(payload: OpenAiResponsePayload) {
  if (payload.output_text?.trim()) return payload.output_text.trim();
  for (const item of payload.output || []) {
    for (const content of item.content || []) {
      if (content.type === "output_text" && content.text?.trim()) return content.text.trim();
    }
  }
  return "";
}

function sizeFor(request: ContentRequest) {
  if (["story", "short_video_script"].includes(request.contentType)) return "1024x1536";
  return "1024x1024";
}

function formatInstruction(request: ContentRequest) {
  switch (request.contentType) {
    case "carousel":
      return "FORMATO OBRIGATÓRIO: crie entre 5 e 7 slides. Preencha slides. Deixe script e storyFrames vazios.";
    case "story":
      return "FORMATO OBRIGATÓRIO: crie exatamente 3 frames de Stories. Preencha storyFrames. Deixe slides e script vazios.";
    case "short_video_script":
      return "FORMATO OBRIGATÓRIO: crie entre 4 e 6 cenas. Preencha script. Deixe slides e storyFrames vazios.";
    case "static_post":
    case "channel_adaptation":
    default:
      return "FORMATO OBRIGATÓRIO: entregue uma única peça principal. Deixe slides, script e storyFrames vazios.";
  }
}

function formatNicheTemplate(template: NicheTemplate) {
  return [
    "Use apenas como repertório de direção, nunca como obrigação ou fonte de fatos.",
    `Pilares recorrentes: ${template.contentPillars.join("; ")}`,
    `Ângulos possíveis: ${template.commonAngles.join("; ")}`,
    `Calibração de tom: ${template.toneGuidance}`,
    `Termos a evitar: ${template.wordsToAvoid.join("; ")}`,
    `Ganchos de referência — adapte, não copie mecanicamente: ${template.provenHooks.join(" | ")}`,
  ].join("\n");
}

function normalizeForFormat(request: ContentRequest, raw: GeneratedContent): GeneratedContent {
  const base = { ...raw, visualAssets: [] as ContentVisualAsset[] };
  if (request.contentType === "carousel") {
    const slides = base.slides.length > 0 ? base.slides.slice(0, 7) : [
      { title: base.hook, body: "Apresente o problema ou oportunidade central." },
      { title: "O que muda", body: base.caption.slice(0, 600) },
      { title: "Como funciona", body: base.visualDirection.slice(0, 600) },
      { title: "Próximo passo", body: base.cta },
    ];
    return GeneratedContentSchema.parse({ ...base, slides, script: [], storyFrames: [] });
  }
  if (request.contentType === "story") {
    const storyFrames = base.storyFrames.length > 0 ? base.storyFrames.slice(0, 3) : [
      { headline: base.hook, body: base.caption.slice(0, 420), interaction: "" },
      { headline: base.title, body: base.visualDirection.slice(0, 420), interaction: "" },
      { headline: "Próximo passo", body: base.cta, interaction: "" },
    ];
    return GeneratedContentSchema.parse({ ...base, slides: [], script: [], storyFrames });
  }
  if (request.contentType === "short_video_script") {
    return GeneratedContentSchema.parse({ ...base, slides: [], storyFrames: [] });
  }
  return GeneratedContentSchema.parse({ ...base, slides: [], script: [], storyFrames: [] });
}

function visualSpecsFor(request: ContentRequest, generated: GeneratedContent, brand: Brand): VisualSpec[] {
  if (request.contentType === "carousel") {
    return generated.slides.map((slide, index) => ({
      kind: "carousel_slide" as const,
      index: index + 1,
      label: slide.title,
      imagePrompt: [
        generated.visualDirection,
        `Criar a imagem de fundo do slide ${index + 1} de uma sequência visual consistente para ${brand.name}.`,
        `Mensagem do slide: ${slide.title}. Contexto: ${slide.body}.`,
        "Manter a mesma direção de fotografia, personagens, iluminação e paleta dos demais slides. Não inserir texto, letras, números, logotipos ou marcas-d'água. Reservar área limpa para título e corpo adicionados pela MODO.",
      ].join(" "),
      imageAlt: `Slide ${index + 1} do carrossel de ${brand.name}: ${slide.title}.`,
    }));
  }
  if (request.contentType === "story") {
    return generated.storyFrames.map((frame, index) => ({
      kind: "story_frame" as const,
      index: index + 1,
      label: frame.headline,
      imagePrompt: [
        generated.visualDirection,
        `Criar o fundo vertical do Story ${index + 1} para ${brand.name}.`,
        `Mensagem do frame: ${frame.headline}. Contexto: ${frame.body}.`,
        "Manter consistência visual entre os três frames. Não inserir texto, letras, números, logotipos ou marcas-d'água. Reservar área segura para título, corpo e interação adicionados pela MODO.",
      ].join(" "),
      imageAlt: `Story ${index + 1} de ${brand.name}: ${frame.headline}.`,
    }));
  }
  return [];
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await worker(items[index], index);
    }
  });
  await Promise.all(runners);
  return results;
}

export class OpenAiContentProvider {
  private readonly apiKey: string;
  private readonly textModel: string;
  private readonly imageModel: string;
  private readonly assets: ContentAssetService;

  constructor(options: OpenAiContentProviderOptions) {
    this.apiKey = options.apiKey;
    this.textModel = options.textModel || "gpt-5-mini";
    this.imageModel = options.imageModel || "gpt-image-1";
    this.assets = options.assets;
  }

  private async generateImage(
    request: ContentRequest,
    brand: Brand,
    prompt: string,
    size: string,
  ) {
    const imageResponse = await fetch("https://api.openai.com/v1/images/generations", {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: this.imageModel,
        prompt: `${prompt}\n\nContexto obrigatório: marca ${brand.name}; canal ${request.channel}; objetivo ${request.objective}.`,
        size,
        quality: "medium",
        output_format: "webp",
        n: 1,
      }),
      signal: AbortSignal.timeout(180_000),
    });
    const imagePayload = await imageResponse.json() as OpenAiImagePayload;
    if (!imageResponse.ok) {
      throw new Error(imagePayload.error?.message || `Falha de imagem (${imageResponse.status}).`);
    }
    const base64 = imagePayload.data?.[0]?.b64_json;
    if (!base64) throw new Error("O modelo não devolveu a imagem final.");
    return this.assets.save({
      organizationId: request.organizationId,
      contentRequestId: request.id,
      mimeType: "image/webp",
      data: Buffer.from(base64, "base64"),
    });
  }

  async generate(request: ContentRequest, brand: Brand) {
    const creativeContext = await loadCreativeGenerationContext(
      request.organizationId,
      request.brandId,
    );
    const formattedContext = formatCreativeContext(creativeContext, request.channel);
    const nicheTemplate = nicheTemplates[brand.niche];
    const contextNotes = creativeContext.contextStatus === "degraded"
      ? ["Conteúdo gerado com contexto de marca incompleto — revise com atenção."]
      : creativeContext.contextStatus === "unavailable"
        ? ["A memória estratégica da marca não pôde ser carregada nesta geração — revise com atenção."]
        : [];

    if (creativeContext.contextStatus !== "ok") {
      console.warn("[MODO_CREATIVE_CONTEXT_WARNING]", {
        requestId: request.id,
        organizationId: request.organizationId,
        brandId: request.brandId,
        contextStatus: creativeContext.contextStatus,
        failedQueries: creativeContext.failedQueries,
      });
    }

    const userPrompt = [
      `MARCA: ${brand.name}`,
      `SEGMENTO: ${brand.niche}`,
      brand.websiteUrl ? `SITE: ${brand.websiteUrl}` : "",
      brand.instagramHandle ? `INSTAGRAM: ${brand.instagramHandle}` : "",
      `FORMATO: ${request.contentType}`,
      `CANAL: ${request.channel}`,
      `OBJETIVO: ${request.objective}`,
      `BRIEFING: ${request.brief}`,
      formatInstruction(request),
      formattedContext ? `CONTEXTO REAL APRENDIDO PELA MODO — PRIORIDADE SOBRE O MODELO DO SEGMENTO:\n${formattedContext}` : "",
      `MODELO DO SEGMENTO — SUGESTÕES DE DIREÇÃO:\n${formatNicheTemplate(nicheTemplate)}`,
      "HIERARQUIA OBRIGATÓRIA: fatos e restrições do briefing > Base Estratégica e memória real > mapa do canal e objetivo comercial > modelo genérico do segmento.",
      "Crie uma entrega que possa ser aprovada por um cliente real e usada em campanha. O visual deve representar a oferta, o público e o contexto, não apenas produzir uma imagem genérica bonita.",
    ].filter(Boolean).join("\n\n");

    const textResponse = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: this.textModel,
        store: false,
        input: [
          { role: "system", content: [{ type: "input_text", text: systemPrompt }] },
          { role: "user", content: [{ type: "input_text", text: userPrompt }] },
        ],
        text: {
          format: {
            type: "json_schema",
            name: "modo_generated_content",
            strict: true,
            schema: contentJsonSchema,
          },
        },
      }),
      signal: AbortSignal.timeout(90_000),
    });
    const textPayload = await textResponse.json() as OpenAiResponsePayload;
    if (!textResponse.ok) {
      throw new Error(textPayload.error?.message || `Falha de texto (${textResponse.status}).`);
    }
    const rawText = extractOutputText(textPayload);
    if (!rawText) throw new Error("O modelo não devolveu o conteúdo estruturado.");

    const parsedBase = GeneratedContentSchema.parse({
      ...JSON.parse(rawText),
      imageUrl: null,
      imageStatus: "not_requested",
      visualAssets: [],
    });
    const parsed = GeneratedContentSchema.parse({
      ...parsedBase,
      adaptationNotes: [...parsedBase.adaptationNotes, ...contextNotes].slice(0, 10),
    });
    const generated = normalizeForFormat(request, parsed);
    const specs = visualSpecsFor(request, generated, brand);

    try {
      if (specs.length > 0) {
        const visualAssets = await mapWithConcurrency(specs, 2, async (spec) => {
          try {
            const asset = await this.generateImage(request, brand, spec.imagePrompt, sizeFor(request));
            return {
              ...spec,
              imageUrl: asset.url,
              imageStatus: "generated" as const,
            };
          } catch {
            return {
              ...spec,
              imageUrl: null,
              imageStatus: "failed" as const,
            };
          }
        });
        const firstGenerated = visualAssets.find((asset) => asset.imageStatus === "generated" && asset.imageUrl);
        const failedCount = visualAssets.filter((asset) => asset.imageStatus === "failed").length;
        const output: GeneratedContent = GeneratedContentSchema.parse({
          ...generated,
          imageUrl: firstGenerated?.imageUrl || null,
          imageAlt: firstGenerated?.imageAlt || generated.imageAlt,
          imageStatus: firstGenerated ? "generated" : "failed",
          visualAssets,
          adaptationNotes: failedCount > 0
            ? [...generated.adaptationNotes, `${failedCount} visual(is) complementar(es) não foi(ram) concluído(s) e pode(m) ser regenerado(s).`].slice(0, 10)
            : generated.adaptationNotes,
        });
        return { output, providerRunId: textPayload.id || `openai:${request.id}` };
      }

      const asset = await this.generateImage(
        request,
        brand,
        `${generated.imagePrompt}\nNão inserir texto, letras, números, logotipos ou marcas-d'água. Reservar espaço visual limpo para título e CTA adicionados depois pela MODO.`,
        sizeFor(request),
      );
      const output: GeneratedContent = GeneratedContentSchema.parse({
        ...generated,
        imageUrl: asset.url,
        imageStatus: "generated",
        visualAssets: [],
      });
      return { output, providerRunId: textPayload.id || `openai:${request.id}` };
    } catch {
      const output: GeneratedContent = GeneratedContentSchema.parse({
        ...generated,
        imageUrl: null,
        imageStatus: "failed",
        visualAssets: specs.map((spec) => ({
          ...spec,
          imageUrl: null,
          imageStatus: "failed" as const,
        })),
        adaptationNotes: [
          ...generated.adaptationNotes,
          "A estratégia e a copy foram geradas com IA. A entrega visual não respondeu e pode ser criada novamente sem perder o conteúdo.",
        ].slice(0, 10),
      });
      return { output, providerRunId: textPayload.id || `openai:text-only:${request.id}` };
    }
  }
}
