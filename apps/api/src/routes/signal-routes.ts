import { PerformanceSignalCreateSchema } from "@modo/contracts/signal";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { AuthError, type AuthService } from "../services/auth-service.js";
import type { ContentService } from "../services/content-service.js";
import { SignalError, SignalService } from "../services/signal-service.js";

interface Options {
  auth: AuthService;
  content: ContentService;
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

export async function registerSignalRoutes(app: FastifyInstance, options: Options) {
  await app.register(async (scope) => {
    const service = new SignalService({
      databaseUrl: options.databaseUrl,
      databaseSsl: options.databaseSsl,
    });
    await service.initialize();
    scope.addHook("onClose", async () => service.close());

    scope.setErrorHandler((error, _request, reply) => {
      if (error instanceof SignalError || error instanceof AuthError) {
        return reply.code(error.statusCode).send({ code: error.code, message: error.message });
      }
      const message = error instanceof Error ? error.message : "Não foi possível registrar o desempenho.";
      const validation = error instanceof Error && error.name === "ZodError";
      return reply.code(validation ? 400 : 500).send({
        code: validation ? "INVALID_REQUEST" : "SIGNAL_INTERNAL_ERROR",
        message: validation ? message : "Não foi possível registrar o desempenho.",
      });
    });

    scope.get("/api/v1/signal/summary/:brandId", async (request) => {
      const context = await options.auth.authenticate(bearerToken(request));
      const brandId = z.string().uuid().parse((request.params as { brandId: string }).brandId);
      const brands = await options.auth.listBrands(context.organization.id);
      if (!brands.some((item) => item.id === brandId)) {
        throw new AuthError("BRAND_NOT_FOUND", 404, "Marca não encontrada nesta organização.");
      }
      return service.summary(context.organization.id, brandId);
    });

    scope.post("/api/v1/signal", async (request, reply) => {
      const context = await options.auth.authenticate(bearerToken(request));
      const input = PerformanceSignalCreateSchema.parse(request.body);
      const content = await options.content.getForOrganization(
        input.contentRequestId,
        context.organization.id,
      );
      if (content.brandId !== input.brandId) {
        throw new SignalError(
          "SIGNAL_BRAND_MISMATCH",
          400,
          "O conteúdo não pertence à marca informada.",
        );
      }
      return reply.code(201).send(await service.record(context.organization.id, input));
    });
  });
}
