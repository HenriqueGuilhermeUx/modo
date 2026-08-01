import { afterEach, describe, expect, it, vi } from "vitest";
import { MetaService } from "./meta-service.js";

function jsonResponse(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("MetaService", () => {
  it("mantém a integração desativada sem credenciais", async () => {
    const service = new MetaService({});

    await expect(service.getStatus("org-meta-off")).resolves.toMatchObject({
      provider: "instagram",
      integrationConfigured: false,
      connected: false,
      readOnly: true,
    });
  });

  it("gera autorização limitada a leitura para conta profissional", async () => {
    const service = new MetaService({
      clientId: "meta-client",
      clientSecret: "meta-secret",
      redirectUri: "https://api.example.com/api/v1/meta/callback",
      encryptionSecret: "meta-encryption-secret-with-enough-entropy",
      scopes: "instagram_business_basic instagram_business_manage_insights",
    });

    const result = await service.createAuthorizationUrl("org-meta-auth");
    const url = new URL(result.authorizationUrl);

    expect(url.origin).toBe("https://www.instagram.com");
    expect(url.searchParams.get("client_id")).toBe("meta-client");
    expect(url.searchParams.get("redirect_uri")).toBe(
      "https://api.example.com/api/v1/meta/callback",
    );
    expect(url.searchParams.get("scope")).toBe(
      "instagram_business_basic,instagram_business_manage_insights",
    );
    expect(url.searchParams.get("state")).toBeTruthy();
  });

  it("conecta, protege o token e carrega perfil, métricas e mídias", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({
        access_token: "short-lived-token",
        user_id: "17841400000000000",
        permissions: ["instagram_business_basic", "instagram_business_manage_insights"],
      }))
      .mockResolvedValueOnce(jsonResponse({
        access_token: "long-lived-token",
        expires_in: 5_184_000,
      }))
      .mockResolvedValueOnce(jsonResponse({
        id: "17841400000000000",
        username: "modo_teste",
        name: "MODO Teste",
        account_type: "BUSINESS",
        profile_picture_url: "https://images.example.com/profile.jpg",
        followers_count: 1250,
        follows_count: 180,
        media_count: 84,
      }))
      .mockResolvedValueOnce(jsonResponse({
        id: "17841400000000000",
        username: "modo_teste",
        name: "MODO Teste",
        account_type: "BUSINESS",
        profile_picture_url: "https://images.example.com/profile.jpg",
        followers_count: 1250,
        follows_count: 180,
        media_count: 84,
        biography: "Presença digital com direção.",
        website: "https://modo.example.com",
      }))
      .mockResolvedValueOnce(jsonResponse({
        data: [
          {
            name: "reach",
            title: "Reach",
            period: "day",
            values: [{ value: 412, end_time: "2026-08-01T00:00:00+0000" }],
          },
        ],
      }))
      .mockResolvedValueOnce(jsonResponse({
        data: [
          {
            id: "media-1",
            caption: "Conteúdo de teste",
            media_type: "IMAGE",
            media_url: "https://images.example.com/post.jpg",
            permalink: "https://www.instagram.com/p/teste/",
            timestamp: "2026-07-31T12:00:00+0000",
            like_count: 35,
            comments_count: 4,
          },
        ],
      }));
    vi.stubGlobal("fetch", fetchMock);

    const service = new MetaService({
      clientId: "meta-client",
      clientSecret: "meta-secret",
      redirectUri: "https://api.example.com/api/v1/meta/callback",
      encryptionSecret: "meta-encryption-secret-with-enough-entropy",
      scopes: "instagram_business_basic instagram_business_manage_insights",
      apiVersion: "v25.0",
      webUrl: "https://modo.example.com",
    });

    const authorization = await service.createAuthorizationUrl("org-meta-connected");
    const state = new URL(authorization.authorizationUrl).searchParams.get("state")!;
    const redirect = await service.completeAuthorization({ state, code: "authorization-code" });

    expect(redirect).toBe("https://modo.example.com/app/meta?meta=connected");
    await expect(service.getStatus("org-meta-connected")).resolves.toMatchObject({
      integrationConfigured: true,
      connected: true,
      username: "modo_teste",
      canReadProfile: true,
      canReadInsights: true,
      readOnly: true,
    });

    await expect(service.getOverview("org-meta-connected")).resolves.toMatchObject({
      profile: {
        id: "17841400000000000",
        username: "modo_teste",
        followersCount: 1250,
      },
      metrics: [{ name: "reach", value: 412 }],
      recentMedia: [{ id: "media-1", likeCount: 35, commentsCount: 4 }],
      warnings: [],
    });
    expect(fetchMock).toHaveBeenCalledTimes(6);
  });

  it("mantém a visão utilizável quando insights ou mídias não estão disponíveis", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({
        access_token: "short-token",
        user_id: "17841400000000001",
        permissions: ["instagram_business_basic", "instagram_business_manage_insights"],
      }))
      .mockResolvedValueOnce(jsonResponse({ access_token: "long-token", expires_in: 5_184_000 }))
      .mockResolvedValueOnce(jsonResponse({
        id: "17841400000000001",
        username: "modo_degraded",
        account_type: "CREATOR",
      }))
      .mockResolvedValueOnce(jsonResponse({
        id: "17841400000000001",
        username: "modo_degraded",
        account_type: "CREATOR",
      }))
      .mockResolvedValueOnce(jsonResponse({ error: { message: "Métrica indisponível" } }, 400))
      .mockResolvedValueOnce(jsonResponse({ error: { message: "Mídia indisponível" } }, 400));
    vi.stubGlobal("fetch", fetchMock);

    const service = new MetaService({
      clientId: "meta-client",
      clientSecret: "meta-secret",
      redirectUri: "https://api.example.com/api/v1/meta/callback",
      encryptionSecret: "meta-encryption-secret-with-enough-entropy",
      webUrl: "https://modo.example.com",
    });
    const authorization = await service.createAuthorizationUrl("org-meta-degraded");
    const state = new URL(authorization.authorizationUrl).searchParams.get("state")!;
    await service.completeAuthorization({ state, code: "authorization-code" });

    const overview = await service.getOverview("org-meta-degraded");
    expect(overview.profile.username).toBe("modo_degraded");
    expect(overview.metrics).toEqual([]);
    expect(overview.recentMedia).toEqual([]);
    expect(overview.warnings).toHaveLength(2);
  });
});
