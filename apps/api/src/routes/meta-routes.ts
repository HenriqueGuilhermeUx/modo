import type { FastifyInstance, FastifyRequest } from "fastify";
import { AuthError, type AuthService } from "../services/auth-service.js";
import { MetaError, MetaService } from "../services/meta-service.js";

interface Options {
  auth: AuthService;
  clientId?: string;
  clientSecret?: string;
  redirectUri?: string;
  encryptionSecret?: string;
  scopes?: string;
  apiVersion?: string;
  webUrl?: string;
  databaseUrl?: string;
  databaseSsl?: boolean;
}

function bearerToken(request: FastifyRequest) {
  const value = request.headers.authorization;
  if (!value?.startsWith("Bearer ")) {
    throw new AuthError("UNAUTHORIZED", 401, "Faça login para continuar.");
  }
  return value.slice(7).trim();
}

export async function registerMetaRoutes(app: FastifyInstance, options: Options) {
  await app.register(async (scope) => {
    const service = new MetaService({
      clientId: options.clientId,
      clientSecret: options.clientSecret,
      redirectUri: options.redirectUri,
      encryptionSecret: options.encryptionSecret,
      scopes: options.scopes,
      apiVersion: options.apiVersion,
      webUrl: options.webUrl,
      databaseUrl: options.databaseUrl,
      databaseSsl: options.databaseSsl,
    });
    await service.initialize();
    scope.addHook("onClose", async () => service.close());

    scope.setErrorHandler((error, _request, reply) => {
      if (error instanceof MetaError || error instanceof AuthError) {
        return reply.code(error.statusCode).send({ code: error.code, message: error.message });
      }
      const validation = error instanceof Error && error.name === "ZodError";
      return reply.code(validation ? 400 : 500).send({
        code: validation ? "INVALID_REQUEST" : "META_INTERNAL_ERROR",
        message: validation
          ? error.message
          : "Não foi possível concluir a operação com o Instagram.",
      });
    });

    scope.get("/api/v1/meta/status", async (request) => {
      const context = await options.auth.authenticate(bearerToken(request));
      return service.getStatus(context.organization.id);
    });

    scope.post(
      "/api/v1/meta/connect",
      { config: { rateLimit: { max: 8, timeWindow: "15 minutes" } } },
      async (request) => {
        const context = await options.auth.authenticate(bearerToken(request));
        return service.createAuthorizationUrl(context.organization.id);
      },
    );

    scope.get("/api/v1/meta/callback", async (request, reply) => {
      const query = request.query as {
        state?: string;
        code?: string;
        error?: string;
        error_description?: string;
      };
      const target = await service.completeAuthorization({
        state: query.state,
        code: query.code,
        error: query.error,
        errorDescription: query.error_description,
      });
      return reply.redirect(target);
    });

    scope.post("/api/v1/meta/disconnect", async (request) => {
      const context = await options.auth.authenticate(bearerToken(request));
      return service.disconnect(context.organization.id);
    });

    scope.get(
      "/api/v1/meta/overview",
      { config: { rateLimit: { max: 30, timeWindow: "10 minutes" } } },
      async (request) => {
        const context = await options.auth.authenticate(bearerToken(request));
        return service.getOverview(context.organization.id);
      },
    );
  });
}
