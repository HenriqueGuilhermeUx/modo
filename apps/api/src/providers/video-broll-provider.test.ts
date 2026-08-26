import { describe, expect, it, vi } from "vitest";
import { PexelsVideoBrollProvider } from "./video-broll-provider.js";

describe("PexelsVideoBrollProvider", () => {
  it("busca vídeo vertical em pt-BR, escolhe MP4 e preserva crédito", async () => {
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.startsWith("https://api.pexels.com/v1/videos/search")) {
        return new Response(JSON.stringify({
          videos: [
            {
              id: 42,
              url: "https://www.pexels.com/video/42/",
              user: { name: "Ana Criadora", url: "https://www.pexels.com/@ana" },
              video_files: [
                { file_type: "video/mp4", width: 1920, height: 1080, link: "https://cdn.example.com/landscape.mp4" },
                { file_type: "video/mp4", width: 720, height: 1280, link: "https://cdn.example.com/portrait.mp4" },
              ],
            },
          ],
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      return new Response(Buffer.from("fake-mp4"), {
        status: 200,
        headers: { "content-type": "video/mp4", "content-length": "8" },
      });
    });

    const provider = new PexelsVideoBrollProvider("pexels-key", fetchImpl as typeof fetch);
    const asset = await provider.fetchClip({ query: "equipe trabalhando", sceneIndex: 2, revision: 0 });

    const searchUrl = new URL(String(fetchImpl.mock.calls[0][0]));
    expect(searchUrl.pathname).toBe("/v1/videos/search");
    expect(searchUrl.searchParams.get("orientation")).toBe("portrait");
    expect(searchUrl.searchParams.get("locale")).toBe("pt-BR");
    expect(searchUrl.searchParams.get("query")).toBe("equipe trabalhando");
    expect(fetchImpl.mock.calls[0][1]).toMatchObject({ headers: { Authorization: "pexels-key" } });
    expect(String(fetchImpl.mock.calls[1][0])).toBe("https://cdn.example.com/portrait.mp4");
    expect(asset).toMatchObject({
      provider: "pexels",
      mimeType: "video/mp4",
      credit: {
        provider: "pexels",
        authorName: "Ana Criadora",
        authorUrl: "https://www.pexels.com/@ana",
        sourceUrl: "https://www.pexels.com/video/42/",
      },
    });
    expect(asset.data.toString()).toBe("fake-mp4");
  });

  it("recusa download acima do limite configurado", async () => {
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.startsWith("https://api.pexels.com/v1/videos/search")) {
        return new Response(JSON.stringify({
          videos: [{
            id: 1,
            url: "https://www.pexels.com/video/1/",
            user: { name: "Pexels", url: "https://www.pexels.com" },
            video_files: [{ file_type: "video/mp4", width: 720, height: 1280, link: "https://cdn.example.com/clip.mp4" }],
          }],
        }), { status: 200 });
      }
      return new Response(Buffer.from("123456789"), {
        status: 200,
        headers: { "content-type": "video/mp4", "content-length": "9" },
      });
    });

    const provider = new PexelsVideoBrollProvider("key", fetchImpl as typeof fetch, 4);
    await expect(provider.fetchClip({ query: "cidade", sceneIndex: 1, revision: 0 }))
      .rejects.toThrow("excede o limite");
  });
});
