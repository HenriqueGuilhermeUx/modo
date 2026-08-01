import { createHmac } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { InstagramService } from "./instagram-service.js";

function jsonResponse(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function signedRequest(clientSecret: string, payload: Record<string, unknown>) {
  const encoded = Buffer.from(JSON.stringify({ algorithm: "HMAC-SHA256", ...payload }), "utf8")
    .toString("base64url");
  const signature = createHmac("sha256", clientSecret).update(encoded).digest("base64url");
  return `${signature}.${encoded}`;
}

function configuredService() {
  return new InstagramService({
    clientId: "instagram-client-id",
    clientSecret: "instagram-client-secret",
    redirectUri: "https://api.example.com/api/v1/instagram/callback",
    encryptionSecret: "instagram-token-encryption-secret-with-entropy",
    scopes: "instagram_business_basic,instagram_business_content_publish,instagram_business_manage_insights,instagram_business_manage_comments",
    webUrl: "https://modo.example.com",
    apiVersion: "v21.0",
    graphBaseUrl: "https://graph.instagram.com",
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("InstagramService", () => {
  it("mantém a integração desativada sem credenciais", async () => {
    const service = new InstagramService();

    await expect(service.getStatus("account-off")).resolves.toMatchObject({
      provider: "instagram",
      integrationConfigured: false,
      connected: false,
      canPublish: false,
    });
  });

  it("cria URL do Instagram Business Login com state assinado e escopos de publicação", async () => {
    const service = configuredService();
    const result = await service.createAuthorizationUrl(
      "account-auth",
      "00000000-0000-4000-8000-000000000001",
    );
    const url = new URL(result.authorizationUrl);

    expect(url.origin).toBe("https://www.instagram.com");
    expect(url.pathname).toBe("/oauth/authorize");
    expect(url.searchParams.get("client_id")).toBe("instagram-client-id");
    expect(url.searchParams.get("redirect_uri")).toBe(
      "https://api.example.com/api/v1/instagram/callback",
    );
    expect(url.searchParams.get("scope")).toBe(
      "instagram_business_basic,instagram_business_content_publish,instagram_business_manage_insights,instagram_business_manage_comments",
    );
    expect(url.searchParams.get("state")?.split(".")).toHaveLength(2);
    expect(url.searchParams.get("enable_fb_login")).toBe("0");
  });

  it("obtém o ig-user-id dinamicamente e publica em duas etapas no graph.instagram.com", async () => {
    const requests: Array<{ url: string; method: string; body: string }> = [];
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method || "GET";
      const body = init?.body instanceof URLSearchParams ? init.body.toString() : String(init?.body || "");
      requests.push({ url, method, body });

      if (url === "https://api.instagram.com/oauth/access_token") {
        return jsonResponse({
          access_token: "short-lived-token",
          user_id: "short-response-user-id-must-not-be-hardcoded",
          permissions: [
            "instagram_business_basic",
            "instagram_business_content_publish",
            "instagram_business_manage_insights",
            "instagram_business_manage_comments",
          ],
        });
      }
      if (url.startsWith("https://graph.instagram.com/access_token?")) {
        return jsonResponse({ access_token: "long-lived-token", expires_in: 5_184_000 });
      }
      if (url.startsWith("https://graph.instagram.com/v21.0/me?")) {
        return jsonResponse({
          id: "17841499999999999",
          username: "modo_publicacao",
          profile_picture_url: "https://cdn.example.com/profile.jpg",
        });
      }
      if (url === "https://graph.instagram.com/v21.0/17841499999999999/media") {
        return jsonResponse({ id: "creation-dynamic-1" });
      }
      if (url.startsWith("https://graph.instagram.com/v21.0/creation-dynamic-1?")) {
        return jsonResponse({ status_code: "FINISHED" });
      }
      if (url === "https://graph.instagram.com/v21.0/17841499999999999/media_publish") {
        return jsonResponse({ id: "instagram-post-1" });
      }
      if (url.startsWith("https://graph.instagram.com/v21.0/instagram-post-1?")) {
        return jsonResponse({
          id: "instagram-post-1",
          permalink: "https://www.instagram.com/p/modo-post-1/",
        });
      }
      return jsonResponse({ error: { message: `Chamada inesperada: ${url}` } }, 500);
    });
    vi.stubGlobal("fetch", fetchMock);

    const service = configuredService();
    const authorization = await service.createAuthorizationUrl(
      "account-publish",
      "00000000-0000-4000-8000-000000000002",
    );
    const state = new URL(authorization.authorizationUrl).searchParams.get("state")!;
    const redirect = await service.completeAuthorization({ state, code: "authorization-code" });

    expect(redirect).toBe(
      "https://modo.example.com/app/settings/integrations?instagram=connected",
    );
    await expect(service.getStatus("account-publish")).resolves.toMatchObject({
      connected: true,
      instagramUserId: "17841499999999999",
      username: "modo_publicacao",
      profilePictureUrl: "https://cdn.example.com/profile.jpg",
      canPublish: true,
    });

    const publication = await service.publishPost({
      accountId: "account-publish",
      contentRequestId: "00000000-0000-4000-8000-000000000010",
      imageUrl: "https://modo-api.example.com/api/v1/public/content-assets/image-token",
      caption: "Legenda aprovada pela MODO.",
    });

    expect(publication).toMatchObject({
      creationId: "creation-dynamic-1",
      postId: "instagram-post-1",
      permalink: "https://www.instagram.com/p/modo-post-1/",
    });
    const createCall = requests.find((request) => request.url.endsWith("/17841499999999999/media"));
    const publishCall = requests.find((request) => request.url.endsWith("/17841499999999999/media_publish"));
    expect(createCall).toMatchObject({ method: "POST" });
    expect(createCall?.body).toContain("image_url=https%3A%2F%2Fmodo-api.example.com");
    expect(createCall?.body).toContain("caption=Legenda+aprovada+pela+MODO");
    expect(publishCall).toMatchObject({ method: "POST" });
    expect(publishCall?.body).toContain("creation_id=creation-dynamic-1");
    expect(requests.every((request) => !request.url.includes("graph.facebook.com"))).toBe(true);
    expect(requests.some((request) => request.url.includes("short-response-user-id-must-not-be-hardcoded/media"))).toBe(false);
  });

  it("renova o token quando faltam menos de cinco dias", async () => {
    vi.setSystemTime(new Date("2026-08-01T12:00:00.000Z"));
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ access_token: "short-token", user_id: "temporary" }))
      .mockResolvedValueOnce(jsonResponse({ access_token: "long-token", expires_in: 60 }))
      .mockResolvedValueOnce(jsonResponse({ id: "17841400000000055", username: "modo_refresh" }))
      .mockResolvedValueOnce(jsonResponse({ access_token: "refreshed-token", expires_in: 5_184_000 }));
    vi.stubGlobal("fetch", fetchMock);

    const service = configuredService();
    const authorization = await service.createAuthorizationUrl("account-refresh");
    const state = new URL(authorization.authorizationUrl).searchParams.get("state")!;
    await service.completeAuthorization({ state, code: "authorization-code" });
    await service.refreshTokenIfNeeded("account-refresh");

    const refreshUrl = String(fetchMock.mock.calls[3]?.[0]);
    expect(refreshUrl).toContain("https://graph.instagram.com/refresh_access_token?");
    expect(refreshUrl).toContain("grant_type=ig_refresh_token");
    vi.useRealTimers();
  });

  it("valida signed_request e remove a conexão após desautorização", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ access_token: "short-token", user_id: "temporary" }))
      .mockResolvedValueOnce(jsonResponse({ access_token: "long-token", expires_in: 5_184_000 }))
      .mockResolvedValueOnce(jsonResponse({ id: "17841400000000077", username: "modo_delete" }));
    vi.stubGlobal("fetch", fetchMock);

    const service = configuredService();
    const authorization = await service.createAuthorizationUrl("account-delete");
    const state = new URL(authorization.authorizationUrl).searchParams.get("state")!;
    await service.completeAuthorization({ state, code: "authorization-code" });

    const request = signedRequest("instagram-client-secret", {
      user_id: "17841400000000077",
      issued_at: 1_775_000_000,
    });
    await expect(service.handleDeauthorize(request)).resolves.toEqual({ deauthorized: true });
    await expect(service.getStatus("account-delete")).resolves.toMatchObject({ connected: false });
  });

  it("responde à exclusão de dados com URL e confirmation_code", async () => {
    const service = configuredService();
    const request = signedRequest("instagram-client-secret", {
      user_id: "17841400000000088",
      issued_at: 1_775_000_000,
    });

    const result = await service.handleDataDeletionRequest(request);
    expect(result.confirmation_code.length).toBeGreaterThanOrEqual(8);
    expect(result.url).toContain("https://modo.example.com/exclusao-de-dados");
    expect(result.url).toContain(`confirmation_code=${result.confirmation_code}`);
  });
});
