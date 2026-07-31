import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InstagramService } from "./instagram-service.js";

const options = {
  clientId: "2300668704012703",
  clientSecret: "meta-client-secret",
  redirectUri: "https://modo-api-3m10.onrender.com/api/v1/instagram/callback",
  encryptionSecret: "instagram-encryption-secret-with-enough-entropy",
  scopes: "instagram_business_basic,instagram_business_content_publish,instagram_business_manage_insights,instagram_business_manage_comments",
  apiVersion: "v21.0",
  graphBaseUrl: "https://graph.instagram.com",
  webUrl: "https://modo1.netlify.app",
};
function jsonResponse(payload: unknown, status = 200) { return new Response(JSON.stringify(payload), { status, headers: { "content-type": "application/json" } }) }
function signedRequest(userId: string) {
  const payload = Buffer.from(JSON.stringify({ algorithm: "HMAC-SHA256", user_id: userId, issued_at: Math.floor(Date.now() / 1000) })).toString("base64url");
  return `${createHmac("sha256", options.clientSecret).update(payload).digest("base64url")}.${payload}`;
}

describe("InstagramService", () => {
  const fetchMock = vi.fn<typeof fetch>();
  beforeEach(() => vi.stubGlobal("fetch", fetchMock));
  afterEach(() => { fetchMock.mockReset(); vi.unstubAllGlobals() });
  async function connect(service: InstagramService) {
    const { authorizationUrl } = await service.createAuthorizationUrl("org-test", "00000000-0000-4000-8000-000000000001");
    const state = new URL(authorizationUrl).searchParams.get("state")!;
    fetchMock.mockImplementation(async (input, init) => {
      const url = String(input);
      if (url === "https://api.instagram.com/oauth/access_token") {
        expect(init?.method).toBe("POST");
        const body = init?.body as URLSearchParams;
        expect(body.get("client_id")).toBe(options.clientId);
        expect(body.get("client_secret")).toBe(options.clientSecret);
        return jsonResponse({ access_token: "short-lived-token", user_id: "panel-id-not-used" });
      }
      if (url.startsWith("https://graph.instagram.com/access_token")) return jsonResponse({ access_token: "long-lived-token", token_type: "bearer", expires_in: 5_184_000 });
      if (url.startsWith("https://graph.instagram.com/v21.0/me")) return jsonResponse({ id: "17841400000000001", username: "modo.negocios" });
      throw new Error(`URL inesperada no teste: ${url}`);
    });
    expect(await service.completeAuthorization({ state, code: "valid-code" })).toBe("https://modo1.netlify.app/app/settings/integrations?instagram=connected");
    fetchMock.mockReset();
  }

  it("cria o Business Login com scopes corretos e state assinado", async () => {
    const url = new URL((await new InstagramService(options).createAuthorizationUrl("org-test")).authorizationUrl);
    expect(url.origin).toBe("https://www.instagram.com");
    expect(url.pathname).toBe("/oauth/authorize");
    expect(url.searchParams.get("client_id")).toBe(options.clientId);
    expect(url.searchParams.get("redirect_uri")).toBe(options.redirectUri);
    expect(url.searchParams.get("enable_fb_login")).toBe("0");
    expect(url.searchParams.get("scope")).toBe(options.scopes);
    expect(url.searchParams.get("state")?.split(".")).toHaveLength(2);
  });

  it("usa o ID dinâmico retornado por graph.instagram.com e cifra o token", async () => {
    const service = new InstagramService(options);
    await connect(service);
    expect(await service.getStatus("org-test")).toMatchObject({ connected: true, instagramUsername: "modo.negocios" });
    const connection = (service as unknown as { connections: Map<string, { instagramUserId: string; encryptedAccessToken: string }> }).connections.get("org-test")!;
    expect(connection.instagramUserId).toBe("17841400000000001");
    expect(connection.encryptedAccessToken).not.toContain("long-lived-token");
  });

  it("publica em duas etapas usando graph.instagram.com e o ID salvo", async () => {
    const service = new InstagramService(options);
    await connect(service);
    const requestedUrls: string[] = [];
    fetchMock.mockImplementation(async (input, init) => {
      const url = String(input);
      requestedUrls.push(url);
      expect(url).not.toContain("graph.facebook.com");
      if (url === "https://graph.instagram.com/v21.0/17841400000000001/media") {
        const body = init?.body as URLSearchParams;
        expect(body.get("image_url")).toContain("image-token");
        expect(body.get("caption")).toContain("Legenda aprovada");
        return jsonResponse({ id: "creation-123" });
      }
      if (url.startsWith("https://graph.instagram.com/v21.0/creation-123")) return jsonResponse({ status_code: "FINISHED" });
      if (url === "https://graph.instagram.com/v21.0/17841400000000001/media_publish") {
        expect((init?.body as URLSearchParams).get("creation_id")).toBe("creation-123");
        return jsonResponse({ id: "media-456" });
      }
      if (url.startsWith("https://graph.instagram.com/v21.0/media-456")) return jsonResponse({ id: "media-456", permalink: "https://www.instagram.com/p/POSTTESTE/" });
      throw new Error(`URL inesperada no teste: ${url}`);
    });
    const publication = await service.publishPost({ accountId: "org-test", contentRequestId: "00000000-0000-4000-8000-000000000099", imageUrl: "https://modo-api-3m10.onrender.com/api/v1/public/content-assets/image-token", caption: "Legenda aprovada\n\n#Modo" });
    expect(publication).toMatchObject({ mediaId: "media-456", creationId: "creation-123", instagramUserId: "17841400000000001", permalink: "https://www.instagram.com/p/POSTTESTE/" });
    expect(requestedUrls.some((url) => url.includes("17841400000000001/media"))).toBe(true);
  });

  it("remove a conexão ao receber signed_request válido", async () => {
    const service = new InstagramService(options);
    await connect(service);
    await service.handleDeauthorize(signedRequest("17841400000000001"));
    expect((await service.getStatus("org-test")).connected).toBe(false);
  });

  it("retorna confirmação de exclusão de dados", async () => {
    const service = new InstagramService(options);
    await connect(service);
    const result = await service.handleDataDeletionRequest(signedRequest("17841400000000001"));
    expect(result.confirmation_code.length).toBeGreaterThanOrEqual(8);
    expect(new URL(result.url).searchParams.get("confirmation_code")).toBe(result.confirmation_code);
  });
});
