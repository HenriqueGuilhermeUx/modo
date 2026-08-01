import { createHmac, randomBytes } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../app.js";
import { DemoDiagnosticProvider } from "../providers/demo-diagnostic-provider.js";

const TEST_CLIENT_SECRET = randomBytes(32).toString("hex");
const TEST_ENCRYPTION_SECRET = randomBytes(32).toString("hex");

function signedRequest(payload: Record<string, unknown>) {
  const encoded = Buffer.from(JSON.stringify({ algorithm: "HMAC-SHA256", ...payload }), "utf8")
    .toString("base64url");
  const signature = createHmac("sha256", TEST_CLIENT_SECRET)
    .update(encoded)
    .digest("base64url");
  return `${signature}.${encoded}`;
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
      instagramClientSecret: TEST_CLIENT_SECRET,
      instagramRedirectUri: "https://api.example.com/api/v1/instagram/callback",
      instagramEncryptionSecret: TEST_ENCRYPTION_SECRET,
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
    const status = await app.inject({ method: "GET", url: "/api/v1/instagram/status" });
    expect(status.statusCode).toBe(401);

    const connect = await app.inject({
      method: "POST",
      url: "/api/v1/instagram/connect",
      payload: {},
    });
    expect(connect.statusCode).toBe(401);
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

  it("protege a rota de publicação com autenticação", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/content-requests/00000000-0000-4000-8000-000000000099/publish-instagram",
      payload: {},
    });
    expect(response.statusCode).toBe(401);
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
