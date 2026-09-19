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
  readonly supports?: CreativeMediaKind[];
  submit(input: CreativeBrief): Promise<CreativeProviderJob>;
  getJob(providerJobId: string): Promise<CreativeProviderJob>;
}

export class CreativeEngineError extends Error {
  constructor(public readonly code: string, public readonly statusCode: number, message: string) {
    super(message);
    this.name = "CreativeEngineError";
  }
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
    const job = await provider.submit(input);
    return { id: randomUUID(), ...job };
  }

  async status(providerName: string, providerJobId: string) {
    return this.provider(providerName).getJob(providerJobId);
  }
}
