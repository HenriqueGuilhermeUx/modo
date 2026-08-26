import { afterEach, describe, expect, it, vi } from "vitest";
import { NativePublisherV2Service } from "./native-publisher-v2-service.js";

describe("NativePublisherV2Service", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("mantém providers desligados sem credenciais", () => {
    const service = new NativePublisherV2Service({});
    expect(service.storage).toBe("memory");
    expect(service.providers).toEqual({
      instagram: false,
      facebook: false,
      threads: false,
      linkedin: false,
    });
  });

  it("detecta os quatro conectores nativos configurados", () => {
    const service = new NativePublisherV2Service({
      instagramEncryptionSecret: "instagram-secret",
      facebookAppId: "facebook-id",
      facebookAppSecret: "facebook-secret",
      facebookRedirectUri: "https://example.com/facebook/callback",
      threadsAppId: "threads-id",
      threadsAppSecret: "threads-secret",
      threadsRedirectUri: "https://example.com/threads/callback",
      linkedinEncryptionSecret: "linkedin-secret",
    });
    expect(service.providers).toEqual({
      instagram: true,
      facebook: true,
      threads: true,
      linkedin: true,
    });
  });

  it("normaliza escopos do Threads", () => {
    const service = new NativePublisherV2Service({
      threadsScopes: "threads_basic, threads_content_publish threads_manage_insights",
    });
    expect(service.threadsScopes).toEqual([
      "threads_basic",
      "threads_content_publish",
      "threads_manage_insights",
    ]);
  });

  it("publica vídeo do Facebook pelo fluxo de Reels start, upload e finish", async () => {
    const service = new NativePublisherV2Service({ facebookApiVersion: "v25.0" });
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({
        video_id: "video-123",
        upload_url: "https://rupload.facebook.com/video-upload/v25.0/video-123",
      }), { status: 200, headers: { "content-type": "application/json" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }));

    const result = await (service as any).publishFacebook(
      { provider_account_id: "page-456" },
      "page-token",
      "Legenda do Reel",
      "video",
      "https://cdn.example.com/modo-video.mp4",
    );

    expect(result).toEqual({ postId: "video-123", permalink: null });
    expect(fetchMock).toHaveBeenCalledTimes(3);

    const [startUrl, startInit] = fetchMock.mock.calls[0];
    expect(String(startUrl)).toBe("https://graph.facebook.com/v25.0/page-456/video_reels");
    expect(String((startInit as RequestInit).body)).toContain("upload_phase=start");

    const [uploadUrl, uploadInit] = fetchMock.mock.calls[1];
    expect(String(uploadUrl)).toBe("https://rupload.facebook.com/video-upload/v25.0/video-123");
    expect((uploadInit as RequestInit).headers).toMatchObject({
      authorization: "OAuth page-token",
      file_url: "https://cdn.example.com/modo-video.mp4",
    });

    const [, finishInit] = fetchMock.mock.calls[2];
    const finishBody = String((finishInit as RequestInit).body);
    expect(finishBody).toContain("upload_phase=finish");
    expect(finishBody).toContain("video_id=video-123");
    expect(finishBody).toContain("video_state=PUBLISHED");
  });
});
