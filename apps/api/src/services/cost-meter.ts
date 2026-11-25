/**
 * Medidor de custo das chamadas pagas (OpenAI).
 *
 * Cada chamada gera uma linha `[modo-cost] {json}` no log do serviço. Assim o
 * custo real por peça e por Reel pode ser medido nos logs do Render sem criar
 * tabela nova no banco. Some `estimatedUsd` agrupando por `reference`
 * (id do conteúdo ou do projeto de vídeo).
 *
 * Os preços são estimativas de lista (USD) e devem ser revistos quando a
 * OpenAI mudar a tabela. Quando a resposta traz `usage`, o custo é calculado
 * pelos tokens reais; senão, pela tabela por imagem.
 */

export type CostOperation = "text" | "image" | "tts";

export interface CostEvent {
  operation: CostOperation;
  model: string;
  /** Para que serviu a chamada: content, video_scene, video_voice, scan... */
  purpose: string;
  organizationId?: string | null;
  /** Id do conteúdo, projeto de vídeo ou diagnóstico. */
  reference?: string | null;
  ok: boolean;
  error?: string;
  inputTokens?: number;
  outputTokens?: number;
  quality?: string;
  size?: string;
  characters?: number;
}

type TokenUsage = {
  input_tokens?: number;
  output_tokens?: number;
  input_tokens_details?: { text_tokens?: number; image_tokens?: number };
};

/** USD por 1M de tokens [entrada, saída]. */
const TEXT_PRICES: Record<string, [number, number]> = {
  "gpt-5-mini": [0.25, 2],
};

/** gpt-image-2: USD por 1M tokens (texto de entrada, imagem de entrada, imagem de saída). */
const IMAGE_TOKEN_PRICES: Record<string, { textIn: number; imageIn: number; imageOut: number }> = {
  "gpt-image-2": { textIn: 5, imageIn: 8, imageOut: 30 },
};

/** Tabela por imagem (USD) quando a resposta não traz usage. Chave: modelo|qualidade|tamanho. */
const IMAGE_FLAT_PRICES: Record<string, number> = {
  "gpt-image-2|low|1024x1024": 0.006,
  "gpt-image-2|low|1024x1536": 0.005,
  "gpt-image-2|medium|1024x1024": 0.053,
  "gpt-image-2|medium|1024x1536": 0.041,
  "gpt-image-2|high|1024x1024": 0.211,
  "gpt-image-2|high|1024x1536": 0.165,
};

/** gpt-4o-mini-tts: estimativa de USD por minuto de áudio e ritmo de fala em PT-BR. */
const TTS_USD_PER_MINUTE = 0.015;
const TTS_CHARS_PER_SECOND = 15;

/** Remove sufixo de snapshot (ex.: gpt-image-2-2026-04-21 → gpt-image-2). */
export function baseModel(model: string) {
  return model.replace(/-\d{4}-\d{2}-\d{2}$/, "");
}

function round(value: number) {
  return Math.round(value * 1_000_000) / 1_000_000;
}

export function estimateUsd(event: CostEvent): number | null {
  if (!event.ok) return 0;
  const model = baseModel(event.model);
  if (event.operation === "text") {
    const price = TEXT_PRICES[model];
    if (!price || event.inputTokens === undefined || event.outputTokens === undefined) return null;
    return round((event.inputTokens * price[0] + event.outputTokens * price[1]) / 1_000_000);
  }
  if (event.operation === "image") {
    const tokenPrice = IMAGE_TOKEN_PRICES[model];
    if (tokenPrice && event.outputTokens !== undefined) {
      return round(
        ((event.inputTokens ?? 0) * tokenPrice.textIn + event.outputTokens * tokenPrice.imageOut) /
          1_000_000,
      );
    }
    const flat = IMAGE_FLAT_PRICES[`${model}|${event.quality}|${event.size}`];
    return flat ?? null;
  }
  const seconds = (event.characters ?? 0) / TTS_CHARS_PER_SECOND;
  return round((seconds / 60) * TTS_USD_PER_MINUTE);
}

export function usageTokens(usage: TokenUsage | undefined) {
  return {
    inputTokens: usage?.input_tokens,
    outputTokens: usage?.output_tokens,
  };
}

type Sink = (line: string) => void;
let sink: Sink = (line) => console.info(line);

/** Só para testes. */
export function setCostSink(next: Sink) {
  sink = next;
}

export function recordCost(event: CostEvent) {
  try {
    sink(`[modo-cost] ${JSON.stringify({ ...event, estimatedUsd: estimateUsd(event) })}`);
  } catch {
    // Medição nunca pode derrubar a geração.
  }
}
