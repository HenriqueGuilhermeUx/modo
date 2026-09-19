import type { CreativeBrief, CreativeProvider, CreativeProviderJob } from "./creative-engine-service.js";

interface Options { apiKey?: string; model?: string; }

export class OpenAiImageCreativeProvider implements CreativeProvider {
  readonly name = "openai";
  readonly supports = ["image"] as const;
  readonly configured: boolean;
  private readonly apiKey?: string;
  private readonly model: string;

  constructor(options: Options = {}) {
    this.apiKey = options.apiKey;
    this.model = options.model || "gpt-image-1";
    this.configured = Boolean(this.apiKey);
  }

  async submit(input: CreativeBrief): Promise<CreativeProviderJob> {
    if (!this.apiKey) throw new Error("OPENAI_API_KEY não configurada.");
    const response = await fetch("https://api.openai.com/v1/images/generations", {
      method: "POST",
      headers: { Authorization: `Bearer ${this.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: this.model, prompt: input.prompt, n: 1, size: input.format === "vertical" ? "1024x1536" : "1024x1024" }),
    });
    const text = await response.text();
    let body:any={}; try { body=text?JSON.parse(text):{}; } catch { body={message:text}; }
    if (!response.ok) throw new Error(body?.error?.message || body?.message || `OpenAI image HTTP ${response.status}`);
    const first=body?.data?.[0]||{};
    const url=first.url || (first.b64_json ? `data:image/png;base64,${first.b64_json}` : undefined);
    if (!url) throw new Error("OpenAI não retornou imagem.");
    return { provider:this.name, providerJobId:`openai-${Date.now()}`, status:"ready", assets:[{url,mimeType:"image/png"}] };
  }

  async getJob(_providerJobId:string):Promise<CreativeProviderJob> {
    throw new Error("Gerações OpenAI de imagem são síncronas e não usam polling.");
  }
}
