import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import { registerInstagramRoutes } from "./instagram-routes.js";

const organizationId = "org-test";
const brandId = "00000000-0000-4000-8000-000000000001";
const contentRequestId = "00000000-0000-4000-8000-000000000099";
function dependencies() {
  const instagram = {
    getStatus: vi.fn().mockResolvedValue({ provider: "instagram", integrationConfigured: true, connected: true, brandId, instagramUsername: "modo.negocios", expiresAt: new Date(Date.now() + 86_400_000).toISOString(), scopes: ["instagram_business_basic", "instagram_business_content_publish"], message: "Instagram conectado." }),
    createAuthorizationUrl: vi.fn().mockResolvedValue({ authorizationUrl: "https://www.instagram.com/oauth/authorize?state=signed-state" }),
    completeAuthorization: vi.fn().mockResolvedValue("https://modo1.netlify.app/app/settings/integrations?instagram=connected"),
    disconnect: vi.fn().mockResolvedValue({ disconnected: true }),
    handleDeauthorize: vi.fn().mockResolvedValue({ deauthorized: true }),
    handleDataDeletionRequest: vi.fn().mockResolvedValue({ url: "https://modo1.netlify.app/?instagramDataDeletion=completed&confirmation_code=abc123456", confirmation_code: "abc123456" }),
    refreshTokenIfNeeded: vi.fn().mockResolvedValue(undefined),
    publishPost: vi.fn().mockResolvedValue({ provider: "instagram", contentRequestId, creationId: "creation-123", mediaId: "media-456", instagramUserId: "17841400000000001", instagramUsername: "modo.negocios", permalink: "https://www.instagram.com/p/POSTTESTE/", publishedAt: new Date().toISOString() }),
  };
  const auth = {
    authenticate: vi.fn().mockResolvedValue({ user: { id: "user-test" }, organization: { id: organizationId } }),
    listBrands: vi.fn().mockResolvedValue([{ id: brandId, name: "Marca teste" }]),
  };
  const content = {
    getForOrganization: vi.fn().mockResolvedValue({
      id: contentRequestId, organizationId, brandId, contentType: "static_post", objective: "conversao", brief: "Conteúdo de teste para publicação", channel: "Instagram", status: "approved",
      output: { hook: "Gancho", title: "Título", caption: "Legenda aprovada", cta: "Saiba mais", hashtags: ["#Modo", "#Instagram"], imageStatus: "generated", imageUrl: "https://modo-api-3m10.onrender.com/api/v1/public/content-assets/image-token" },
    }),
  };
  const assets = {
    getForRequestByToken: vi.fn().mockResolvedValue({ mimeType: "image/png", data: Buffer.from("image") }),
    getLatestForRequest: vi.fn().mockResolvedValue(null),
  };
  return { instagram, auth, content, assets };
}
let app: FastifyInstance | undefined;
afterEach(async () => { await app?.close(); app = undefined; vi.restoreAllMocks() });

describe("rotas do Instagram", () => {
  it("protege status e cria a URL de Business Login", async () => {
    const deps = dependencies();
    app = Fastify();
    await registerInstagramRoutes(app, deps as never);
    await app.ready();
    expect((await app.inject({ method: "GET", url: "/api/v1/instagram/status" })).statusCode).toBe(401);
    const response = await app.inject({ method: "POST", url: "/api/v1/instagram/connect", headers: { authorization: "Bearer session-token" }, payload: { brandId } });
    expect(response.statusCode).toBe(200);
    expect(response.json().authorizationUrl).toContain("www.instagram.com/oauth/authorize");
    expect(deps.instagram.createAuthorizationUrl).toHaveBeenCalledWith(organizationId, brandId);
  });

  it("mantém callback, desautorização e exclusão de dados públicos", async () => {
    const deps = dependencies();
    app = Fastify();
    await registerInstagramRoutes(app, deps as never);
    await app.ready();
    const callback = await app.inject({ method: "GET", url: "/api/v1/instagram/callback?state=signed-state&code=valid-code" });
    expect(callback.statusCode).toBe(302);
    expect(callback.headers.location).toContain("instagram=connected");
    const deauthorize = await app.inject({ method: "POST", url: "/api/v1/instagram/deauthorize", headers: { "content-type": "application/x-www-form-urlencoded" }, payload: "signed_request=signature.payload" });
    expect(deauthorize.statusCode).toBe(200);
    expect(deps.instagram.handleDeauthorize).toHaveBeenCalledWith("signature.payload");
    const deletion = await app.inject({ method: "POST", url: "/api/v1/instagram/data-deletion", headers: { "content-type": "application/x-www-form-urlencoded" }, payload: "signed_request=signature.payload" });
    expect(deletion.statusCode).toBe(200);
    expect(deletion.json()).toMatchObject({ confirmation_code: "abc123456" });
  });

  it("publica somente conteúdo aprovado com imagem gerada", async () => {
    const deps = dependencies();
    app = Fastify();
    await registerInstagramRoutes(app, deps as never);
    await app.ready();
    const response = await app.inject({ method: "POST", url: `/api/v1/content-requests/${contentRequestId}/publish-instagram`, headers: { authorization: "Bearer session-token" } });
    expect(response.statusCode).toBe(201);
    expect(response.json().publication).toMatchObject({ mediaId: "media-456", instagramUserId: "17841400000000001" });
    expect(deps.instagram.refreshTokenIfNeeded).toHaveBeenCalledWith(organizationId);
    expect(deps.instagram.publishPost).toHaveBeenCalledWith(expect.objectContaining({ accountId: organizationId, contentRequestId, imageUrl: expect.stringContaining("image-token"), caption: expect.stringContaining("#Modo") }));
  });
});
