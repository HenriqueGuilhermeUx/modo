import type { Brand } from "@modo/contracts";
import {
  GeneratedContentSchema,
  type ContentRequest,
  type GeneratedContent,
} from "@modo/contracts/content";
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
- o prompt visual deve descrever uma imagem publicitária forte, coerente com a marca e sem texto, logotipo ou marca-d'água; deixe área limpa para sobreposição do título no Studio;
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

  async generate(request: ContentRequest, brand: Brand) {
    const creativeContext = await loadCreativeGenerationContext(
      request.organizationId,
      request.brandId,
    );
    const formattedContext = formatCreativeContext(creativeContext);
    const userPrompt = [
      `MARCA: ${brand.name}`,
      `SEGMENTO: ${brand.niche}`,
      brand.websiteUrl ? `SITE: ${brand.websiteUrl}` : "",
      brand.instagramHandle ? `INSTAGRAM: ${brand.instagramHandle}` : "",
      `FORMATO: ${request.contentType}`,
      `CANAL: ${request.channel}`,
      `OBJETIVO: ${request.objective}`,
      `BRIEFING: ${request.brief}`,
      formattedContext ? `CONTEXTO APRENDIDO PELA MODO:\n${formattedContext}` : "",
      "Crie uma peça que possa ser aprovada por um cliente real e usada em campanha. O visual deve representar a oferta, o público e o contexto, não apenas produzir uma imagem genérica bonita.",
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

    const generated = GeneratedContentSchema.parse({
      ...JSON.parse(rawText),
      imageUrl: null,
      imageStatus: "not_requested",
    });

    try {
      const imageResponse = await fetch("https://api.openai.com/v1/images/generations", {
        method: "POST",
        headers: {
          authorization: `Bearer ${this.apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: this.imageModel,
          prompt: `${generated.imagePrompt}\n\nContexto obrigatório: marca ${brand.name}; canal ${request.channel}; objetivo ${request.objective}. Não inserir texto, letras, números, logotipos ou marcas-d'água. Reservar espaço visual limpo para título e CTA adicionados depois pela MODO.`,
          size: sizeFor(request),
          quality: "medium",
          output_format: "webp",
          n: 1,
        }),
        signal: AbortSignal.timeout(150_000),
      });
      const imagePayload = await imageResponse.json() as OpenAiImagePayload;
      if (!imageResponse.ok) {
        throw new Error(imagePayload.error?.message || `Falha de imagem (${imageResponse.status}).`);
      }
      const base64 = imagePayload.data?.[0]?.b64_json;
      if (!base64) throw new Error("O modelo não devolveu a imagem final.");

      const asset = await this.assets.save({
        organizationId: request.organizationId,
        contentRequestId: request.id,
        mimeType: "image/webp",
        data: Buffer.from(base64, "base64"),
      });

      const output: GeneratedContent = GeneratedContentSchema.parse({
        ...generated,
        imageUrl: asset.url,
        imageStatus: "generated",
      });
      return { output, providerRunId: textPayload.id || `openai:${request.id}` };
    } catch {
      const output: GeneratedContent = GeneratedContentSchema.parse({
        ...generated,
        imageUrl: null,
        imageStatus: "failed",
        adaptationNotes: [
          ...generated.adaptationNotes,
          "A estratégia e a copy foram geradas com IA. A imagem não respondeu e pode ser criada novamente no Studio sem perder o conteúdo.",
        ].slice(0, 10),
      });
      return { output, providerRunId: textPayload.id || `openai:text-only:${request.id}` };
    }
  }
}
