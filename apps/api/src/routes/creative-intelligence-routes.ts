import {
  CreativeFeedbackSchema,
  CreativeProfileUpsertSchema,
  CreativeRecommendationStatusSchema,
} from "@modo/contracts/creative-intelligence";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { AuthError, type AuthService } from "../services/auth-service.js";
import {
  CreativeIntelligenceError,
  CreativeIntelligenceService,
} from "../services/creative-intelligence-service.js";

interface Options {
  auth: AuthService;
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

async function requireBrand(auth: AuthService, request: FastifyRequest, brandId: string) {
  const context = await auth.authenticate(bearerToken(request));
  const brands = await auth.listBrands(context.organization.id);
  const brand = brands.find((item) => item.id === brandId);
  if (!brand) throw new AuthError("BRAND_NOT_FOUND", 404, "Marca não encontrada nesta organização.");
  return { context, brand };
}

export async function registerCreativeIntelligenceRoutes(
  app: FastifyInstance,
  options: Options,
) {
  const service = new CreativeIntelligenceService({
    databaseUrl: options.databaseUrl,
    databaseSsl: options.databaseSsl,
  });
  await service.initialize();
  app.addHook("onClose", async () => service.close());

  app.get("/api/v1/director/profile/:brandId", async (request) => {
    const brandId = z.string().uuid().parse((request.params as { brandId: string }).brandId);
    const { context } = await requireBrand(options.auth, request, brandId);
    return service.getProfile(context.organization.id, brandId);
  });

  app.put("/api/v1/director/profile/:brandId", async (request) => {
    const brandId = z.string().uuid().parse((request.params as { brandId: string }).brandId);
    const { context } = await requireBrand(options.auth, request, brandId);
    const input = CreativeProfileUpsertSchema.parse({
      ...(request.body as Record<string, unknown>),
      brandId,
    });
    return service.upsertProfile(context.organization.id, input);
  });

  app.get("/api/v1/director/recommendations/:brandId", async (request) => {
    const brandId = z.string().uuid().parse((request.params as { brandId: string }).brandId);
    const { context } = await requireBrand(options.auth, request, brandId);
    return {
      recommendations: await service.listRecommendations(context.organization.id, brandId),
    };
  });

  app.post(
    "/api/v1/director/plan/:brandId",
    { config: { rateLimit: { max: 12, timeWindow: "10 minutes" } } },
    async (request, reply) => {
      const brandId = z.string().uuid().parse((request.params as { brandId: string }).brandId);
      const { context, brand } = await requireBrand(options.auth, request, brandId);
      return reply.code(201).send(await service.generatePlan(context.organization.id, brand));
    },
  );

  app.post("/api/v1/director/recommendations/:id/status", async (request) => {
    const context = await options.auth.authenticate(bearerToken(request));
    const id = z.string().uuid().parse((request.params as { id: string }).id);
    const status = CreativeRecommendationStatusSchema.parse(
      (request.body as { status?: unknown })?.status,
    );
    return service.setRecommendationStatus(context.organization.id, id, status);
  });

  app.post("/api/v1/director/feedback/:brandId", async (request, reply) => {
    const brandId = z.string().uuid().parse((request.params as { brandId: string }).brandId);
    const { context } = await requireBrand(options.auth, request, brandId);
    const feedback = CreativeFeedbackSchema.parse(request.body);
    return reply.code(201).send(
      await service.recordFeedback(context.organization.id, brandId, feedback),
    );
  });

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof CreativeIntelligenceError) {
      return reply.code(error.statusCode).send({ code: error.code, message: error.message });
    }
    return app.errorHandler(error, request, reply);
  });
}
