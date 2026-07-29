import type { Brand } from "@modo/contracts";
import type { ContentRequest, GeneratedContent } from "@modo/contracts/content";
import { timingSafeEqual } from "node:crypto";
import { ContentAssetService } from "./content-asset-service.js";
import { ContentService } from "./content-service.js";
import {
  formatCreativeContext,
  loadCreativeGenerationContext,
} from "./creative-context.js";
import { OpenAiContentProvider } from "./openai-content-provider.js";

export type ContentProviderMode = "native" | "openai";

interface ContentAutomationOptions {
  provider?: ContentProviderMode;
  secret?: string;
  content: ContentService;
  assets: ContentAssetService;
  openAiApiKey?: string;
  openAiTextModel?: string;
  openAiImageModel?: string;
}

export class ContentAutomationError extends Error {
  constructor(
    public readonly code: string,
    public readonly statusCode: number,
    message: string,
  ) {
    super(message);
    this.name = "ContentAutomationError";
  }
}

function cleanBrandHashtag(brandName: string) {
  return brandName.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\W/g, "");
}

export class ContentAutomationService {
  private readonly provider: ContentProviderMode;
  private readonly secret: string;
  private readonly content: ContentService;
  private readonly openAi?: OpenAiContentProvider;

  constructor(options: ContentAutomationOptions) {
    this.provider = options.provider === "openai" && options.openAiApiKey ? "openai" : "native";
    this.secret = options.secret ?? "";
    this.content = options.content;
    if (this.provider === "openai" && options.openAiApiKey) {
      this.openAi = new OpenAiContentProvider({
        apiKey: options.openAiApiKey,
        textModel: options.openAiTextModel,
        imageModel: options.openAiImageModel,
        assets: options.assets,
      });
    }
  }

  get mode() {
    return this.provider;
  }

  get imageMode() {
    return this.openAi ? "generated" : "waiting_for_openai_key";
  }

  async dispatch(request: ContentRequest, brand: Brand) {
    const processing = await this.content.markProcessing(request.id);

    if (this.openAi) {
      try {
        const generated = await this.openAi.generate(processing, brand);
        return this.content.complete(processing.id, generated.output, generated.providerRunId);
      } catch {
        const fallback = await this.buildNativeOutput(processing, brand, true);
        return this.content.complete(
          processing.id,
          fallback,
          `fallback:openai:${processing.id}`,
        );
      }
    }

    return this.content.complete(
      processing.id,
      await this.buildNativeOutput(processing, brand, false),
      `native:${processing.id}`,
    );
  }

  validateCallbackSecret(value: string) {
    if (!this.secret) {
      throw new ContentAutomationError(
        "CONTENT_CALLBACK_DISABLED",
        410,
        "O callback legado de conteúdo está desativado.",
      );
    }
    const received = Buffer.from(value || "", "utf8");
    const expected = Buffer.from(this.secret, "utf8");
    if (received.length !== expected.length || !timingSafeEqual(received, expected)) {
      throw new ContentAutomationError(
        "INVALID_CONTENT_CALLBACK_SECRET",
        401,
        "Callback de conteúdo não autorizado.",
      );
    }
  }

  private async buildNativeOutput(
    request: ContentRequest,
    brand: Brand,
    imageFailed: boolean,
  ): Promise<GeneratedContent> {
    const context = await loadCreativeGenerationContext(request.organizationId, request.brandId);
    const formattedContext = formatCreativeContext(context);
    const brandName = brand.name;
    const tag = cleanBrandHashtag(brandName);
    const objectiveLabels: Record<ContentRequest["objective"], string> = {
      autoridade: "demonstrar conhecimento e construir confiança",
      demanda: "gerar interesse e novas oportunidades",
      relacionamento: "aproximar a marca das pessoas",
      conversao: "apresentar a oferta com clareza e incentivar o próximo passo",
      educacao: "explicar o tema de forma simples e útil",
    };
    const objective = objectiveLabels[request.objective];
    const hook = `${brandName}: uma forma mais simples de avançar com ${request.brief.split("\n")[0].slice(0, 110)}`;
    const title = request.objective === "conversao"
      ? `Conheça a proposta da ${brandName}`
      : `${brandName}: clareza antes da próxima decisão`;
    const contextNote = formattedContext
      ? `\n\nA direção considera o contexto já aprendido pela MODO sobre prioridades, provas disponíveis, dúvidas recorrentes e restrições da marca.`
      : "";
    const caption = `${request.brief}\n\nEsta peça foi estruturada para ${objective}, com linguagem adequada a ${request.channel}. O foco é tornar a proposta compreensível, reduzir dúvidas e conduzir a uma ação segura, sem promessas exageradas.${contextNote}`;
    const cta = request.objective === "conversao"
      ? "Conheça a proposta e veja como funciona."
      : "Converse com a marca e descubra o próximo passo.";
    const visualDirection = `Criar uma composição publicitária específica para ${brandName}, no segmento ${brand.niche}, representando a oferta descrita no briefing. Usar contraste, hierarquia clara, espaço para título e CTA e apenas provas reais disponíveis. Evitar imagens genéricas de banco, promessas visuais exageradas e elementos que não pertençam ao contexto do cliente.`;
    const base: GeneratedContent = {
      hook,
      title,
      caption,
      cta,
      hashtags: ["#EstrategiaDigital", "#ConteudoComDirecao", ...(tag ? [`#${tag}`] : [])],
      visualDirection,
      slides: [],
      script: [],
      storyFrames: [],
      adaptationNotes: [
        `Canal principal: ${request.channel}.`,
        "Revisar fatos, condições comerciais e conformidade antes de publicar.",
        imageFailed
          ? "A copy ficou pronta, mas a geração visual externa não respondeu. Gere novamente a imagem no Studio após revisar o briefing."
          : "A geração de imagem será ativada quando a chave do provedor visual estiver configurada.",
      ],
      imagePrompt: `${visualDirection} Cena central coerente com ${brandName} e com o briefing: ${request.brief}. Sem texto, logotipo, números ou marca-d'água; reservar área limpa para sobreposição da mensagem.`,
      imageAlt: `Imagem publicitária para ${brandName} relacionada a ${request.brief.slice(0, 180)}.`,
      imageUrl: null,
      imageStatus: imageFailed ? "failed" : "not_requested",
      visualAssets: [],
    };

    if (request.contentType === "carousel") {
      base.slides = [
        { title: hook, body: "Abrir com uma ideia concreta que interrompa o padrão e seja reconhecível pelo público." },
        { title: "O que está em jogo", body: request.brief },
        { title: "Como olhar para isso", body: "Organizar a decisão em critérios claros, sem jargão e sem promessas que a marca não possa comprovar." },
        { title: "A proposta da marca", body: `${brandName} apresenta a solução com foco em clareza, confiança e utilidade prática.` },
        { title: "Próximo passo", body: cta },
      ];
    } else if (request.contentType === "short_video_script") {
      base.script = [
        { scene: "Abertura", visual: "Plano próximo e situação real do público.", voiceover: hook },
        { scene: "Problema", visual: "Mostrar o contexto descrito no briefing sem dramatização artificial.", voiceover: request.brief },
        { scene: "Solução", visual: `Demonstrar como ${brandName} organiza a proposta.`, voiceover: `${brandName} torna o próximo passo mais claro e prático.` },
        { scene: "Fechamento", visual: "Oferta e chamada para ação na tela.", voiceover: cta },
      ];
    } else if (request.contentType === "story") {
      base.storyFrames = [
        { headline: hook, body: "Apresente o problema em linguagem cotidiana.", interaction: "Enquete: quero entender / já conheço" },
        { headline: "O ponto principal", body: request.brief, interaction: "" },
        { headline: "Próximo passo", body: cta, interaction: "Caixa de perguntas" },
      ];
    }

    return base;
  }
}
