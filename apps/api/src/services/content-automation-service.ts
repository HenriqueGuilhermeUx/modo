import type { Brand } from "@modo/contracts";
import type { ContentRequest, GeneratedContent } from "@modo/contracts/content";
import { timingSafeEqual } from "node:crypto";
import { ContentService } from "./content-service.js";

interface ContentAutomationOptions {
  provider?: "demo" | "n8n";
  webhookUrl?: string;
  secret?: string;
  publicApiUrl?: string;
  demoDelayMs?: number;
  content: ContentService;
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

export class ContentAutomationService {
  private readonly provider: "demo" | "n8n";
  private readonly webhookUrl?: string;
  private readonly secret: string;
  private readonly publicApiUrl: string;
  private readonly demoDelayMs: number;
  private readonly content: ContentService;

  constructor(options: ContentAutomationOptions) {
    this.provider = options.provider ?? "demo";
    this.webhookUrl = options.webhookUrl;
    this.secret = options.secret ?? "";
    this.publicApiUrl = (options.publicApiUrl ?? "http://localhost:4000").replace(/\/$/, "");
    this.demoDelayMs = options.demoDelayMs ?? 1800;
    this.content = options.content;
  }

  get mode() {
    return this.provider;
  }

  async dispatch(request: ContentRequest, brand: Brand) {
    const processing = await this.content.markProcessing(request.id);
    if (this.provider === "demo") {
      const timer = setTimeout(() => {
        void this.content
          .complete(processing.id, this.buildDemoOutput(processing, brand), `demo:${processing.id}`)
          .catch(() => undefined);
      }, this.demoDelayMs);
      timer.unref?.();
      return processing;
    }

    if (!this.webhookUrl || !this.secret) {
      await this.content.fail(request.id, "A automação n8n ainda não está configurada.");
      throw new ContentAutomationError(
        "CONTENT_AUTOMATION_NOT_CONFIGURED",
        503,
        "A automação de conteúdo ainda não está configurada.",
      );
    }

    try {
      const response = await fetch(this.webhookUrl, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-modo-content-secret": this.secret,
        },
        body: JSON.stringify({
          request: processing,
          brand,
          callbackUrl: `${this.publicApiUrl}/api/v1/internal/content-requests/${processing.id}/result`,
        }),
        signal: AbortSignal.timeout(12_000),
      });
      if (!response.ok) {
        const detail = await response.text().catch(() => "");
        throw new Error(`n8n respondeu ${response.status}${detail ? `: ${detail.slice(0, 300)}` : ""}`);
      }
      return processing;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Falha ao acionar o n8n.";
      await this.content.fail(request.id, message);
      throw new ContentAutomationError(
        "CONTENT_DISPATCH_FAILED",
        502,
        "O pedido foi registrado, mas a automação não respondeu. Você pode reenviá-lo sem novo consumo de créditos.",
      );
    }
  }

  validateCallbackSecret(value: string) {
    if (!this.secret) {
      throw new ContentAutomationError(
        "CONTENT_CALLBACK_NOT_CONFIGURED",
        503,
        "Callback de conteúdo não configurado.",
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

  private buildDemoOutput(request: ContentRequest, brand: Brand): GeneratedContent {
    const brandName = brand.name;
    const base = {
      hook: `O que muda quando ${brandName} transforma estratégia em presença?`,
      title: `${brandName}: uma presença que trabalha por um objetivo`,
      caption: `${request.brief}\n\nA proposta deste conteúdo é conectar o objetivo de ${request.objective} a uma mensagem clara, útil e coerente com a marca. O próximo passo é transformar atenção em ação, sem perder autenticidade.`,
      cta: "Converse com a nossa equipe e descubra o próximo passo.",
      hashtags: ["#PresencaDigital", "#EstrategiaDeConteudo", `#${brandName.replace(/\W/g, "")}`],
      visualDirection: `Composição limpa, hierarquia forte e linguagem visual alinhada à marca ${brandName}. Priorizar contraste, respiro e um elemento central que represente ${request.objective}.`,
      slides: [] as GeneratedContent["slides"],
      script: [] as GeneratedContent["script"],
      storyFrames: [] as GeneratedContent["storyFrames"],
      adaptationNotes: [`Canal principal: ${request.channel}.`, "Manter a mensagem central ao adaptar o formato."],
    };

    if (request.contentType === "carousel") {
      base.slides = [
        { title: base.hook, body: "Uma pergunta direta para interromper o padrão e gerar interesse." },
        { title: "O desafio", body: request.brief },
        { title: "A mudança", body: "Organizar mensagem, formato e chamada para ação em uma narrativa única." },
        { title: "O resultado", body: "Mais clareza para o público e mais consistência para a marca." },
        { title: "Próximo passo", body: base.cta },
      ];
    } else if (request.contentType === "short_video_script") {
      base.script = [
        { scene: "Abertura", visual: "Plano próximo, texto grande na tela.", voiceover: base.hook },
        { scene: "Problema", visual: "Cortes rápidos mostrando o contexto do público.", voiceover: request.brief },
        { scene: "Virada", visual: "Mudança de ritmo e entrada da marca.", voiceover: `É aqui que ${brandName} organiza a solução.` },
        { scene: "Fechamento", visual: "Marca e chamada para ação.", voiceover: base.cta },
      ];
    } else if (request.contentType === "story") {
      base.storyFrames = [
        { headline: base.hook, body: "Abra a sequência com uma pergunta.", interaction: "Enquete: sim / ainda não" },
        { headline: "O ponto central", body: request.brief, interaction: "" },
        { headline: "Vamos avançar?", body: base.cta, interaction: "Caixa de perguntas" },
      ];
    }

    return base;
  }
}
