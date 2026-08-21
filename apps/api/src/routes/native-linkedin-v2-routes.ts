import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { AuthError, AuthService } from "../services/auth-service.js";
import { NativeLinkedInOAuthError, NativeLinkedInOAuthService } from "../services/native-linkedin-oauth-service.js";

interface Options {
  databaseUrl?: string;
  databaseSsl?: boolean;
  publicWebUrl?: string;
  clientId?: string;
  clientSecret?: string;
  redirectUri?: string;
  scopes?: string;
  encryptionSecret?: string;
}

function bearerToken(request: FastifyRequest) {
  const value = request.headers.authorization;
  if (!value?.startsWith("Bearer ")) throw new AuthError("UNAUTHORIZED", 401, "Faça login para continuar.");
  return value.slice(7).trim();
}

export async function registerNativeLinkedInV2Routes(app: FastifyInstance, options: Options) {
  const auth = new AuthService({ databaseUrl: options.databaseUrl, databaseSsl: options.databaseSsl });
  const linkedin = new NativeLinkedInOAuthService({
    databaseUrl: options.databaseUrl,
    databaseSsl: options.databaseSsl,
    clientId: options.clientId,
    clientSecret: options.clientSecret,
    redirectUri: options.redirectUri,
    scopes: options.scopes,
    encryptionSecret: options.encryptionSecret,
  });

  await Promise.all([auth.initialize(), linkedin.initialize()]);
  app.addHook("onClose", async () => Promise.all([auth.close(), linkedin.close()]));

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof NativeLinkedInOAuthError || error instanceof AuthError) {
      return reply.code(error.statusCode).send({ code: error.code, message: error.message });
    }
    if (error instanceof z.ZodError) {
      return reply.code(400).send({ code: "INVALID_REQUEST", message: "Dados inválidos para conectar o LinkedIn." });
    }
    request.log.error({ error }, "Publisher LinkedIn OAuth error");
    return reply.code(500).send({ code: "LINKEDIN_V2_INTERNAL_ERROR", message: "Não foi possível concluir a conexão com o LinkedIn." });
  });

  async function requireBrand(request: FastifyRequest, brandId: string) {
    const current = await auth.authenticate(bearerToken(request));
    const brands = await auth.listBrands(current.organization.id);
    if (!brands.some((brand) => brand.id === brandId)) {
      throw new AuthError("BRAND_NOT_FOUND", 404, "Marca não encontrada nesta organização.");
    }
    return current;
  }

  app.get("/api/v2/publisher/linkedin/health", async () => ({
    status: "ok",
    configured: linkedin.configured,
    callback: options.redirectUri || null,
    directOAuth: true,
  }));

  app.post("/api/v2/publisher/connect/linkedin", async (request) => {
    const brandId = z.object({ brandId: z.string().uuid() }).parse(request.body).brandId;
    const current = await requireBrand(request, brandId);
    return linkedin.createAuthorizationUrl(current.organization.id, brandId);
  });

  app.get("/api/v2/publisher/oauth/linkedin/callback", async (request, reply) => {
    const query = request.query as { state?: string; code?: string; error?: string; error_description?: string };
    try {
      const result = await linkedin.completeAuthorization({
        state: query.state,
        code: query.code,
        error: query.error,
        errorDescription: query.error_description,
      });
      return reply.redirect(`${options.publicWebUrl || "http://localhost:5173"}/app/publisher?brand=${encodeURIComponent(result.brandId)}&linkedin=connected`);
    } catch (error) {
      const message = encodeURIComponent(error instanceof Error ? error.message.slice(0, 300) : "Autorização não concluída.");
      return reply.redirect(`${options.publicWebUrl || "http://localhost:5173"}/app/publisher?linkedin=error&message=${message}`);
    }
  });
}
