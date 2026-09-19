import type { CreativeBrief, CreativeProvider, CreativeProviderJob } from "./creative-engine-service.js";

interface Options {
  apiKey?: string;
  baseUrl?: string;
  imageModel?: string;
  videoModel?: string;
}

export class HiggsfieldCreativeProvider implements CreativeProvider {
  readonly name = "higgsfield";
  readonly configured: boolean;
  private readonly apiKey?: string;
  private readonly baseUrl: string;
  private readonly imageModel: string;
  private readonly videoModel: string;

  constructor(options: Options = {}) {
    this.apiKey = options.apiKey;
    this.baseUrl = (options.baseUrl || "https://platform.higgsfield.ai").replace(/\/$/, "");
    this.imageModel = options.imageModel || "auto";
    this.videoModel = options.videoModel || "auto";
    this.configured = Boolean(this.apiKey);
  }

  private async request(path: string, init?: RequestInit) {
    if (!this.apiKey) throw new Error("HIGGSFIELD_API_KEY não configurada.");
    const response = await fetch(`${this.baseUrl}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
        ...(init?.headers || {}),
      },
    });
    const text = await response.text();
    let body: any = {};
    try { body = text ? JSON.parse(text) : {}; } catch { body = { message: text }; }
    if (!response.ok) throw new Error(body?.message || body?.error || `Higgsfield HTTP ${response.status}`);
    return body;
  }

  async submit(input: CreativeBrief): Promise<CreativeProviderJob> {
    const model = input.kind === "video" ? this.videoModel : this.imageModel;
    // Provider transport is isolated here so model/API revisions never leak into MODO's domain layer.
    const body = await this.request("/v1/generations", {
      method: "POST",
      body: JSON.stringify({
        model,
        type: input.kind,
        prompt: input.prompt,
        negative_prompt: input.negativePrompt,
        duration: input.durationSeconds,
        metadata: {
          brand_id: input.brandId,
          objective: input.objective,
          audience: input.audience,
          channel: input.channel,
          format: input.format,
        },
      }),
    });
    return this.normalize(body);
  }

  async getJob(providerJobId: string): Promise<CreativeProviderJob> {
    return this.normalize(await this.request(`/v1/generations/${encodeURIComponent(providerJobId)}`));
  }

  private normalize(body: any): CreativeProviderJob {
    const rawStatus = String(body?.status || "queued").toLowerCase();
    const status = rawStatus === "completed" || rawStatus === "succeeded" || rawStatus === "ready"
      ? "ready"
      : rawStatus === "failed" || rawStatus === "error"
        ? "failed"
        : rawStatus === "processing" || rawStatus === "running"
          ? "processing"
          : "queued";
    const outputs = Array.isArray(body?.outputs) ? body.outputs : body?.output ? [body.output] : [];
    return {
      provider: this.name,
      providerJobId: String(body?.id || body?.job_id || body?.request_id || ""),
      status,
      assets: outputs.map((item: any) => typeof item === "string" ? { url: item } : ({
        url: item?.url || item?.src,
        mimeType: item?.mime_type,
        width: item?.width,
        height: item?.height,
        durationSeconds: item?.duration,
      })).filter((item: any) => Boolean(item.url)),
      error: body?.error?.message || body?.error || undefined,
      raw: body,
    };
  }
}
