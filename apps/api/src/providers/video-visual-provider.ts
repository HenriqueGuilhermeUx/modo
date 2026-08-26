export type VideoVisualProviderName = "openai";

export interface VideoVisualSynthesisInput {
  brandName: string;
  headline: string;
  visualDirection: string;
  sceneIndex: number;
  revision: number;
}

export interface VideoVisualSynthesisResult {
  provider: VideoVisualProviderName;
  mimeType: "image/png" | "image/jpeg" | "image/webp";
  data: Buffer;
}

export interface VideoVisualProvider {
  readonly name: VideoVisualProviderName;
  generate(input: VideoVisualSynthesisInput): Promise<VideoVisualSynthesisResult>;
}

function safeText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function scenePrompt(input: VideoVisualSynthesisInput) {
  return [
    "Create a premium vertical 9:16 editorial background image for a short-form social video.",
    `Brand context: ${input.brandName || "MODO"}.`,
    `Scene ${input.sceneIndex} concept: ${input.visualDirection}.`,
    `Headline context: ${input.headline}.`,
    "Make the scene visually specific, cinematic and believable instead of generic stock imagery.",
    "Prefer authentic Brazilian business, creator or everyday contexts when people or places are relevant.",
    "Keep the lower 30% reasonably uncluttered because captions and UI overlays will be added later.",
    "Do not render readable text, logos, watermarks, social-media UI, subtitles or typography inside the image.",
    "Use strong subject separation, mobile-first composition and enough contrast for white overlay text.",
    input.revision > 0
      ? `This is variation ${input.revision + 1}; change composition, camera angle and visual treatment while preserving the scene meaning.`
      : "Create the strongest first visual interpretation of the scene.",
  ].join(" ");
}

export class OpenAiVideoVisualProvider implements VideoVisualProvider {
  readonly name = "openai" as const;

  constructor(
    private readonly apiKey: string,
    private readonly model = "gpt-image-2",
    private readonly quality: "low" | "medium" | "high" = "low",
  ) {}

  async generate(input: VideoVisualSynthesisInput): Promise<VideoVisualSynthesisResult> {
    const response = await fetch("https://api.openai.com/v1/images/generations", {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: this.model,
        prompt: scenePrompt(input),
        size: "1024x1536",
        quality: this.quality,
        output_format: "png",
      }),
      signal: AbortSignal.timeout(120_000),
    });

    const payload = await response.json().catch(() => ({})) as any;
    if (!response.ok) {
      throw new Error(
        safeText(payload.error?.message) || `O provider visual rejeitou a geração da cena (${response.status}).`,
      );
    }

    const encoded = safeText(payload.data?.[0]?.b64_json);
    if (!encoded) throw new Error("O provider visual não retornou a imagem da cena.");
    const data = Buffer.from(encoded, "base64");
    if (!data.length) throw new Error("O provider visual retornou uma imagem vazia.");
    return { provider: this.name, mimeType: "image/png", data };
  }
}
