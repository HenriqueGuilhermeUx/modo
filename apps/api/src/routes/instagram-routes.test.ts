import { createHmac } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../app.js";
import { DemoDiagnosticProvider } from "../providers/demo-diagnostic-provider.js";

function signedRequest(payload: Record<string, unknown>) {
  const encoded = Buffer.from(JSON.stringify({ algorithm: "HMAC-SHA256", ...payload }), "utf8")
    .toString("base64url");
  const signature = createHmac("sha256", "instagram-route-secret")
    .update(encoded)
    .digest("base64url");
  return `${signature}.${encoded}`;
}

async function register(app: FastifyInstance) {
  const response = await app.inject({
    method: "POST",
    url: "/api/v1/auth/register",
    payload: {
      name: "Revisor de rota",
      email: "instagram-routes@example.com",
      password: "ModoInstagram123",
      organizationName: "Organização Instagram",
    },
  });
  expect(response.statusCode).toBe(201);
  return response.json() as {
    token: string;
    organization: { id: string };
  };
}

describe("rotas do Instagram", () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    app = await createApp({
      provider: new DemoDiagnosticProvider(0),
      diagnosticProviderName: "demo",
      logger: false,
      allowedOrigins: ["http://localhost:5173"],
      publicApiUrl: "https://api.example.com",
      publicWebUrl: "https://modo.example.com",
      instagramClientId: "instagram-route-client",
      instagramClientSecret: "instagram-route-secret",
      instagramRedirectUri: "https://api.example.com/api/v1/instagram/callback",
      instagramEncryptionSecret: "instagram-route-encryption-secret",
      instagramScopes: "instagram_business_basic,instagram_business_content_publish,instagram_business_manage_insights,instagram_business_manage_comments",
      instagramApiVersion: "v21.0",
      instagramGraphBaseUrl: "https://graph.instagram.com",
    });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  it("protege status e conexão com autenticação", async () => {
    const unauthorized = await app.inject({ method: "GET", url: "/api/v1/instagram/status" });
    expect(unauthorized.statusCode).toBe(401);

    const session = await register(app);
    const status = await app.inject({
      method: "GET",
      url: "/api/v1/instagram/status",
      headers: { authorization: `Bearer ${session.token}` },
    });
    expect(status.statusCode).toBe(200);
    expect(status.json()).toMatchObject({
      provider: "instagram",
      integrationConfigured: true,
      connected: false,
    });
  });

  it("cria a autorização para uma marca pertencente à organização", async () => {
    const session = await register(app);
    const brandResponse = await app.inject({
      method: "POST",
      url: "/api/v1/brands",
      headers: { authorization: `Bearer ${session.token}` },
      payload: {
        name: "Marca Instagram",
        websiteUrl: "https://example.com",
        instagramHandle: "@marca_instagram",
        niche: "servicos_profissionais",
      },
    });
    expect(brandResponse.statusCode).toBe(201);
    const brand = brandResponse.json() as { id: string };

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/instagram/connect",
      headers: { authorization: `Bearer ${session.token}` },
      payload: { brandId: brand.id },
    });
    expect(response.statusCode).toBe(200);
    const authorizationUrl = new URL(response.json().authorizationUrl);
    expect(authorizationUrl.origin).toBe("https://www.instagram.com");
    expect(authorizationUrl.searchParams.get("scope")).toContain(
      "instagram_business_content_publish",
    );
    expect(authorizationUrl.searchParams.get("state")?.split(".")).toHaveLength(2);
  });

  it("aceita os callbacks públicos x-www-form-urlencoded da Meta", async () => {
    const deauthorize = await app.inject({
      method: "POST",
      url: "/api/v1/instagram/deauthorize",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      payload: new URLSearchParams({
        signed_request: signedRequest({ user_id: "17841400000000111" }),
      }).toString(),
    });
    expect(deauthorize.statusCode).toBe(200);
    expect(deauthorize.json()).toEqual({ deauthorized: true });

    const deletion = await app.inject({
      method: "POST",
      url: "/api/v1/instagram/data-deletion",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      payload: new URLSearchParams({
        signed_request: signedRequest({ user_id: "17841400000000112" }),
      }).toString(),
    });
    expect(deletion.statusCode).toBe(200);
    expect(deletion.json()).toMatchObject({
      url: expect.stringContaining("/exclusao-de-dados"),
      confirmation_code: expect.any(String),
    });
  });

  it("registra a publicação e exige conteúdo existente e aprovado", async () => {
    const session = await register(app);
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/content-requests/00000000-0000-4000-8000-000000000099/publish-instagram",
      headers: { authorization: `Bearer ${session.token}` },
      payload: {},
    });
    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({ code: "CONTENT_NOT_FOUND" });
  });

  it("expõe o provedor real no health check", async () => {
    const response = await app.inject({ method: "GET", url: "/health" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      diagnosticProvider: "demo",
      instagramIntegration: "configured",
    });
  });
});
