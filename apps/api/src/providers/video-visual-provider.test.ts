import { afterEach, describe, expect, it, vi } from "vitest";
import { OpenAiVideoVisualProvider } from "./video-visual-provider.js";

describe("OpenAiVideoVisualProvider", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("gera imagem vertical editorial sem texto embutido", async () => {
    const image = Buffer.from("modo-scene-image");
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({
        data: [{ b64_json: image.toString("base64") }],
      }), { status: 200, headers: { "content-type": "application/json" } }),
    );
    const provider = new OpenAiVideoVisualProvider("test-key", "gpt-image-2", "low");

    const result = await provider.generate({
      brandName: "MODO",
      headline: "Marketing com direção",
      visualDirection: "Empresária brasileira organizando o plano de marketing em uma mesa.",
      sceneIndex: 2,
      revision: 1,
    });

    expect(result.provider).toBe("openai");
    expect(result.mimeType).toBe("image/png");
    expect(result.data.equals(image)).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe("https://api.openai.com/v1/images/generations");
    expect((init as RequestInit).headers).toMatchObject({
      authorization: "Bearer test-key",
      "content-type": "application/json",
    });
    const body = JSON.parse(String((init as RequestInit).body));
    expect(body).toMatchObject({
      model: "gpt-image-2",
      size: "1024x1536",
      quality: "low",
      output_format: "png",
    });
    expect(body.prompt).toContain("lower 30%");
    expect(body.prompt).toContain("Do not render readable text");
    expect(body.prompt).toContain("variation 2");
  });

  it("propaga erro do provider sem inventar uma imagem", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ error: { message: "image generation unavailable" } }), {
        status: 503,
        headers: { "content-type": "application/json" },
      }),
    );
    const provider = new OpenAiVideoVisualProvider("test-key");

    await expect(provider.generate({
      brandName: "MODO",
      headline: "Cena",
      visualDirection: "Cena editorial",
      sceneIndex: 1,
      revision: 0,
    })).rejects.toThrow("image generation unavailable");
  });
});
