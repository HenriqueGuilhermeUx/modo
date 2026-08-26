export type VideoVoiceProviderName = "openai";

export interface VideoVoiceSynthesisInput {
  text: string;
  targetDurationSeconds: number;
  language: "pt-BR";
}

export interface VideoVoiceSynthesisResult {
  provider: VideoVoiceProviderName;
  mimeType: "audio/mpeg";
  data: Buffer;
}

export interface VideoVoiceProvider {
  readonly name: VideoVoiceProviderName;
  synthesize(input: VideoVoiceSynthesisInput): Promise<VideoVoiceSynthesisResult>;
}

function safeText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function speechInput(text: string) {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (normalized.length <= 4096) return normalized;
  const clipped = normalized.slice(0, 4096);
  const lastSentence = Math.max(clipped.lastIndexOf(". "), clipped.lastIndexOf("! "), clipped.lastIndexOf("? "));
  return (lastSentence >= 1200 ? clipped.slice(0, lastSentence + 1) : clipped).trim();
}

export class OpenAiVideoVoiceProvider implements VideoVoiceProvider {
  readonly name = "openai" as const;

  constructor(
    private readonly apiKey: string,
    private readonly model = "gpt-4o-mini-tts",
    private readonly voice = "coral",
  ) {}

  async synthesize(input: VideoVoiceSynthesisInput): Promise<VideoVoiceSynthesisResult> {
    const narration = speechInput(input.text);
    if (!narration) throw new Error("O roteiro não possui texto de locução para narrar.");

    const response = await fetch("https://api.openai.com/v1/audio/speech", {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: this.model,
        voice: this.voice,
        input: narration,
        response_format: "mp3",
        instructions: [
          "Fale em português brasileiro natural e claro.",
          "Tom confiante, humano e profissional, sem soar como locução publicitária exagerada.",
          `Busque concluir a narração em aproximadamente ${Math.max(5, Math.round(input.targetDurationSeconds))} segundos.`,
          "Respeite pausas curtas entre ideias e dê ênfase leve ao gancho e ao CTA.",
        ].join(" "),
      }),
      signal: AbortSignal.timeout(60_000),
    });

    if (!response.ok) {
      const payload = await response.json().catch(() => ({})) as any;
      throw new Error(safeText(payload.error?.message) || `O provider de voz rejeitou a narração (${response.status}).`);
    }

    const data = Buffer.from(await response.arrayBuffer());
    if (!data.length) throw new Error("O provider de voz retornou um áudio vazio.");
    return { provider: this.name, mimeType: "audio/mpeg", data };
  }
}
