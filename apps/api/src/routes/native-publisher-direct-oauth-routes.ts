import { NativeProviderConnectSchema } from "@modo/contracts/native-publisher";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { AuthError, AuthService } from "../services/auth-service.js";
import { NativePublisherDirectOAuthService } from "../services/native-publisher-direct-oauth-service.js";

interface Options {
  databaseUrl?: string;
  databaseSsl?: boolean;
  publicWebUrl?: string;
  instagramClientId?: string;
  instagramClientSecret?: string;
  instagramRedirectUri?: string;
  instagramEncryptionSecret?: string;
  instagramScopes?: string;
  instagramGraphBaseUrl?: string;
  instagramApiVersion?: string;
  linkedinClientId?: string;
  linkedinClientSecret?: string;
  linkedinRedirectUri?: string;
  linkedinEncryptionSecret?: string;
  linkedinScopes?: string;
}

function bearerToken(request: FastifyRequest) {
  const value = request.headers.authorization;
  if (!value?.startsWith("Bearer ")) {
    throw new AuthError("UNAUTHORIZED", 401, "Faça login para continuar.");
  }
  return value.slice(7).trim();
}

export async function registerNativePublisherDirectOAuthRoutes(
  app: FastifyInstance,
  options: Options,
) {
  const auth = new AuthService({
    databaseUrl: options.databaseUrl,
    databaseSsl: options.databaseSsl,
  });
  const oauth = new NativePublisherDirectOAuthService(options);
  await auth.initialize();

  app.addHook("onClose", async () => {
    await Promise.all([auth.close(), oauth.close()]);
  });

  async function requireBrand(request: FastifyRequest, brandId: string) {
    const current = await auth.authenticate(bearerToken(request));
    const brands = await auth.listBrands(current.organization.id);
    if (!brands.some((brand) => brand.id === brandId)) {
      throw new AuthError("BRAND_NOT_FOUND", 404, "Marca não encontrada nesta organização.");
    }
    return current;
  }

  app.get("/api/v2/publisher/direct-oauth/health", async () => ({
    status: "ok",
    configured: oauth.configured,
    callbacks: {
      instagram: options.instagramRedirectUri || null,
      linkedin: options.linkedinRedirectUri || null,
    },
  }));

  app.post("/api/v2/publisher/connect/instagram", async (request) => {
    const { brandId } = NativeProviderConnectSchema.parse(request.body);
    const current = await requireBrand(request, brandId);
    return oauth.createInstagramAuthorizationUrl(current.organization.id, brandId);
  });

  app.get("/api/v2/publisher/oauth/instagram/callback", async (request, reply) => {
    const query = request.query as {
      state?: string;
      code?: string;
      error?: string;
      error_description?: string;
    };
    try {
      const connection = await oauth.completeInstagramAuthorization({
        state: query.state,
        code: query.code,
        error: query.error,
        errorDescription: query.error_description,
      });
      return reply.redirect(
        `${options.publicWebUrl || "http://localhost:5173"}/app/publisher?brand=${encodeURIComponent(connection.brandId)}&instagram=connected`,
      );
    } catch (error) {
      const message = encodeURIComponent(
        error instanceof Error ? error.message.slice(0, 300) : "Autorização não concluída.",
      );
      return reply.redirect(
        `${options.publicWebUrl || "http://localhost:5173"}/app/publisher?instagram=error&message=${message}`,
      );
    }
  });

  app.post("/api/v2/publisher/connect/linkedin", async (request) => {
    const { brandId } = NativeProviderConnectSchema.parse(request.body);
    const current = await requireBrand(request, brandId);
    return oauth.createLinkedInAuthorizationUrl(current.organization.id, brandId);
  });

  app.get("/api/v2/publisher/oauth/linkedin/callback", async (request, reply) => {
    const query = request.query as {
      state?: string;
      code?: string;
      error?: string;
      error_description?: string;
    };
    try {
      const connection = await oauth.completeLinkedInAuthorization({
        state: query.state,
        code: query.code,
        error: query.error,
        errorDescription: query.error_description,
      });
      return reply.redirect(
        `${options.publicWebUrl || "http://localhost:5173"}/app/publisher?brand=${encodeURIComponent(connection.brandId)}&linkedin=connected`,
      );
    } catch (error) {
      const message = encodeURIComponent(
        error instanceof Error ? error.message.slice(0, 300) : "Autorização não concluída.",
      );
      return reply.redirect(
        `${options.publicWebUrl || "http://localhost:5173"}/app/publisher?linkedin=error&message=${message}`,
      );
    }
  });
}
