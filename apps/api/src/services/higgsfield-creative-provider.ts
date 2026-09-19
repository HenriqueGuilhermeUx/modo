import type { CreativeBrief, CreativeProvider, CreativeProviderJob } from "./creative-engine-service.js";

interface Options {
  apiKey?: string;
  apiKeyId?: string;
  apiKeySecret?: string;
  baseUrl?: string;
  imageModel?: string;
  videoModel?: string;
}

export class HiggsfieldCreativeProvider implements CreativeProvider {
  readonly name = "higgsfield";
  readonly supports = ["video"] as const;
  readonly configured: boolean;
  private readonly apiKey?: string;
  private readonly apiKeyId?: string;
  private readonly apiKeySecret?: string;
  private readonly baseUrl: string;
  private readonly imageModel: string;
  private readonly videoModel: string;

  constructor(options: Options = {}) {
    this.apiKey = options.apiKey;
    this.apiKeyId = options.apiKeyId;
    this.apiKeySecret = options.apiKeySecret;
    this.baseUrl = (options.baseUrl || "https://api.higgsfield.ai").replace(/\/$/, "");
    this.imageModel = options.imageModel || "ideogram/v4.0";
    this.videoModel = options.videoModel || "bytedance/seedance-2.0/text-to-video";
    this.configured = Boolean(this.apiKey || (this.apiKeyId && this.apiKeySecret));
  }

  private async request(path: string, init?: RequestInit) {
    const credential = this.apiKey || (this.apiKeyId && this.apiKeySecret ? `${this.apiKeyId}:${this.apiKeySecret}` : undefined);
    if (!credential) throw new Error("Credenciais Higgsfield não configuradas.");
    const response = await fetch(`${this.baseUrl}${path}`, {
      ...init,
      headers: {
        Authorization: `Key ${credential}`,
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
    const body = await this.request(`/${model}`, {
      method: "POST",
      body: JSON.stringify({
        prompt: input.prompt,
        ...(input.kind === "video" ? {
          duration: input.durationSeconds || 5,
          resolution: "720p",
          generate_audio: true,
          aspect_ratio: input.format === "vertical" ? "9:16" : "16:9",
        } : {
          aspect_ratio: input.format === "vertical" ? "9:16" : "1:1",
          rendering_speed: "DEFAULT",
        }),
      }),
    });
    return this.normalize(body);
  }

  async getJob(providerJobId: string): Promise<CreativeProviderJob> {
    return this.normalize(await this.request(`/requests/${encodeURIComponent(providerJobId)}/status`));
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
    const outputs = Array.isArray(body?.images) ? body.images : body?.video ? [body.video] : Array.isArray(body?.outputs) ? body.outputs : body?.output ? [body.output] : [];
    return {
      provider: this.name,
      providerJobId: String(body?.request_id || body?.id || body?.job_id || ""),
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
