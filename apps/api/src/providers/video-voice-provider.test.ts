import { afterEach, describe, expect, it, vi } from "vitest";
import { OpenAiVideoVoiceProvider } from "./video-voice-provider.js";

describe("OpenAiVideoVoiceProvider", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("gera MP3 com instruções de português brasileiro", async () => {
    const audio = Buffer.from([0x49, 0x44, 0x33, 0x04, 0x00, 0x00]);
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(audio, { status: 200, headers: { "content-type": "audio/mpeg" } }),
    );
    const provider = new OpenAiVideoVoiceProvider("test-key", "gpt-4o-mini-tts", "coral");

    const result = await provider.synthesize({
      text: "A MODO transforma estratégia em execução. Este é o CTA.",
      targetDurationSeconds: 30,
      language: "pt-BR",
    });

    expect(result.provider).toBe("openai");
    expect(result.mimeType).toBe("audio/mpeg");
    expect(result.data.equals(audio)).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe("https://api.openai.com/v1/audio/speech");
    expect((init as RequestInit).headers).toMatchObject({
      authorization: "Bearer test-key",
      "content-type": "application/json",
    });
    const body = JSON.parse(String((init as RequestInit).body));
    expect(body).toMatchObject({
      model: "gpt-4o-mini-tts",
      voice: "coral",
      response_format: "mp3",
    });
    expect(body.instructions).toContain("português brasileiro");
    expect(body.instructions).toContain("30 segundos");
  });

  it("propaga a mensagem segura do provider em caso de falha", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ error: { message: "quota temporariamente indisponível" } }), {
        status: 429,
        headers: { "content-type": "application/json" },
      }),
    );
    const provider = new OpenAiVideoVoiceProvider("test-key");

    await expect(provider.synthesize({
      text: "Teste de locução.",
      targetDurationSeconds: 15,
      language: "pt-BR",
    })).rejects.toThrow("quota temporariamente indisponível");
  });
});
