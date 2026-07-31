import { InstagramConnectRequestSchema } from "@modo/contracts/instagram";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { AuthError, type AuthService } from "../services/auth-service.js";
import type { ContentAssetService } from "../services/content-asset-service.js";
import { ContentError, type ContentService } from "../services/content-service.js";
import { InstagramError, type InstagramService } from "../services/instagram-service.js";

interface Options { auth: AuthService; content: ContentService; assets: ContentAssetService; instagram: InstagramService }
function bearerToken(request: FastifyRequest) {
  const value = request.headers.authorization;
  if (!value?.startsWith("Bearer ")) throw new AuthError("UNAUTHORIZED", 401, "Faça login para continuar.");
  return value.slice(7).trim();
}
function publicTokenFromUrl(value: string | null | undefined) {
  if (!value) return "";
  try { return new URL(value).pathname.split("/").filter(Boolean).at(-1) || "" } catch { return "" }
}
function buildCaption(output: { caption: string; cta: string; hashtags: string[] }) {
  const parts = [output.caption.trim(), output.cta.trim(), output.hashtags.join(" ").trim()].filter(Boolean);
  const unique: string[] = [];
  for (const part of parts) if (!unique.some((current) => current.toLowerCase() === part.toLowerCase())) unique.push(part);
  return unique.join("\n\n").slice(0, 2200);
}
function signedRequestFromBody(body: unknown) {
  if (typeof body === "string") return String(new URLSearchParams(body).get("signed_request") || "");
  if (body && typeof body === "object") return String((body as { signed_request?: unknown }).signed_request || "");
  return "";
}

export async function registerInstagramRoutes(app: FastifyInstance, options: Options) {
  await app.register(async (scope) => {
    if (!scope.hasContentTypeParser("application/x-www-form-urlencoded")) {
      scope.addContentTypeParser("application/x-www-form-urlencoded", { parseAs: "string" }, (_request, body, done) => {
        done(null, Object.fromEntries(new URLSearchParams(String(body))));
      });
    }
    scope.setErrorHandler((error, _request, reply) => {
      if (error instanceof InstagramError || error instanceof AuthError || error instanceof ContentError) {
        return reply.code(error.statusCode).send({ code: error.code, message: error.message });
      }
      const message = error instanceof Error ? error.message : "Não foi possível concluir a operação no Instagram.";
      const validation = error instanceof Error && error.name === "ZodError";
      return reply.code(validation ? 400 : 500).send({ code: validation ? "INVALID_REQUEST" : "INSTAGRAM_INTERNAL_ERROR", message: validation ? message : "Não foi possível concluir a operação no Instagram." });
    });

    scope.get("/api/v1/instagram/status", async (request) => {
      const context = await options.auth.authenticate(bearerToken(request));
      return options.instagram.getStatus(context.organization.id);
    });
    scope.post("/api/v1/instagram/connect", async (request) => {
      const context = await options.auth.authenticate(bearerToken(request));
      const input = InstagramConnectRequestSchema.parse(request.body || {});
      if (input.brandId) {
        const brand = (await options.auth.listBrands(context.organization.id)).find((item) => item.id === input.brandId);
        if (!brand) throw new AuthError("BRAND_NOT_FOUND", 404, "Marca não encontrada nesta organização.");
      }
      return options.instagram.createAuthorizationUrl(context.organization.id, input.brandId);
    });
    scope.get("/api/v1/instagram/callback", async (request, reply) => {
      const query = request.query as { state?: string; code?: string; error?: string; error_description?: string };
      const target = await options.instagram.completeAuthorization({ state: query.state, code: query.code, error: query.error, errorDescription: query.error_description });
      return reply.redirect(target);
    });
    scope.post("/api/v1/instagram/disconnect", async (request) => {
      const context = await options.auth.authenticate(bearerToken(request));
      return options.instagram.disconnect(context.organization.id);
    });
    scope.post("/api/v1/instagram/deauthorize", async (request) => {
      const signedRequest = signedRequestFromBody(request.body);
      if (!signedRequest) throw new InstagramError("INSTAGRAM_SIGNED_REQUEST_MISSING", 400, "A Meta não enviou o campo signed_request.");
      return options.instagram.handleDeauthorize(signedRequest);
    });
    scope.post("/api/v1/instagram/data-deletion", async (request) => {
      const signedRequest = signedRequestFromBody(request.body);
      if (!signedRequest) throw new InstagramError("INSTAGRAM_SIGNED_REQUEST_MISSING", 400, "A Meta não enviou o campo signed_request.");
      return options.instagram.handleDataDeletionRequest(signedRequest);
    });
    scope.post("/api/v1/content-requests/:id/publish-instagram", { config: { rateLimit: { max: 6, timeWindow: "10 minutes" } } }, async (request, reply) => {
      const context = await options.auth.authenticate(bearerToken(request));
      const id = (request.params as { id: string }).id;
      const content = await options.content.getForOrganization(id, context.organization.id);
      if (content.status !== "approved" || !content.output) throw new InstagramError("CONTENT_NOT_APPROVED", 409, "Apenas conteúdos aprovados podem ser publicados no Instagram.");
      if (content.output.imageStatus !== "generated" || !content.output.imageUrl) throw new InstagramError("IMAGE_NOT_APPROVED", 409, "A imagem precisa estar concluída e aprovada antes da publicação no Instagram.");
      const token = publicTokenFromUrl(content.output.imageUrl);
      const asset = (token ? await options.assets.getForRequestByToken(context.organization.id, id, token) : null) || await options.assets.getLatestForRequest(context.organization.id, id);
      if (!asset) throw new InstagramError("CONTENT_ASSET_NOT_FOUND", 404, "A imagem aprovada não foi encontrada. Gere uma nova versão antes de publicar.");
      if (!asset.mimeType.startsWith("image/")) throw new InstagramError("INSTAGRAM_UNSUPPORTED_ASSET", 409, "O ativo aprovado não é uma imagem compatível com o Instagram.");
      await options.instagram.refreshTokenIfNeeded(context.organization.id);
      const publication = await options.instagram.publishPost({ accountId: context.organization.id, contentRequestId: id, imageUrl: content.output.imageUrl, caption: buildCaption(content.output) });
      return reply.code(201).send({ publication });
    });
  });
}
