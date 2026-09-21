import { randomUUID } from "node:crypto";

export type CreativeMediaKind = "image" | "video";
export type CreativeJobStatus = "queued" | "processing" | "ready" | "failed";

export interface CreativeBrief {
  brandId: string;
  kind: CreativeMediaKind;
  objective: string;
  audience?: string;
  channel?: string;
  format?: string;
  prompt: string;
  negativePrompt?: string;
  durationSeconds?: number;
}

export interface CreativeAsset {
  url: string;
  mimeType?: string;
  width?: number;
  height?: number;
  durationSeconds?: number;
}

export interface CreativeProviderJob {
  provider: string;
  providerJobId: string;
  status: CreativeJobStatus;
  assets: CreativeAsset[];
  error?: string;
  raw?: unknown;
}

export interface CreativeProvider {
  readonly name: string;
  readonly configured: boolean;
  readonly supports?: readonly CreativeMediaKind[];
  submit(input: CreativeBrief): Promise<CreativeProviderJob>;
  getJob(providerJobId: string): Promise<CreativeProviderJob>;
}

export class CreativeEngineError extends Error {
  constructor(public readonly code: string, public readonly statusCode: number, message: string) {
    super(message);
    this.name = "CreativeEngineError";
  }
}

export function enrichCreativePrompt(input: CreativeBrief) {
  const parts=[`Objetivo: ${input.objective}.`,input.audience?`Público: ${input.audience}.`:"",input.channel?`Canal: ${input.channel}.`:"",input.format?`Formato: ${input.format}.`:"",`Pedido do cliente: ${input.prompt}`].filter(Boolean);
  if(input.kind==="video")parts.push("Crie uma peça publicitária clara, visualmente consistente, com abertura forte, progressão objetiva e encerramento adequado ao canal. Não invente alegações, preços, depoimentos ou dados não fornecidos.");
  else parts.push("Crie uma peça visual clara, profissional e coerente com o objetivo. Não invente alegações, preços, depoimentos ou dados não fornecidos.");
  return parts.join("\n");
}

export class CreativeEngineService {
  constructor(private readonly providers: CreativeProvider[]) {}

  capabilities() {
    return this.providers.map((provider) => ({
      provider: provider.name,
      configured: provider.configured,
    }));
  }

  provider(name?: string, kind?: CreativeMediaKind) {
    const available = name
      ? this.providers.find((item) => item.name === name)
      : this.providers.find((item) => item.configured && (!kind || item.supports?.includes(kind)));
    if (!available) throw new CreativeEngineError("CREATIVE_PROVIDER_NOT_FOUND", 503, "Nenhum motor criativo configurado.");
    if (!available.configured) throw new CreativeEngineError("CREATIVE_PROVIDER_NOT_CONFIGURED", 503, `O motor criativo ${available.name} ainda não está configurado.`);
    return available;
  }

  async generate(input: CreativeBrief, providerName?: string) {
    const provider = this.provider(providerName, input.kind);
    const enriched={...input,prompt:enrichCreativePrompt(input)};
    const job = await provider.submit(enriched);
    return { id: randomUUID(), ...job };
  }

  async status(providerName: string, providerJobId: string) {
    return this.provider(providerName).getJob(providerJobId);
  }
}
