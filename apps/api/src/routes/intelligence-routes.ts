import {
  IntelligenceCallbackSchema,
  IntelligenceMissionCreateSchema,
  intelligencePlaybookCatalog,
} from "@modo/contracts/intelligence";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { AuthError, type AuthService } from "../services/auth-service.js";
import { IntelligenceError, type IntelligenceService } from "../services/intelligence-service.js";

function bearerToken(request: FastifyRequest) {
  const value = request.headers.authorization;
  if (!value?.startsWith("Bearer ")) {
    throw new AuthError("UNAUTHORIZED", 401, "Faça login para continuar.");
  }
  return value.slice(7).trim();
}

function callbackSecret(request: FastifyRequest) {
  return String(
    request.headers["x-modo-intelligence-secret"] || request.headers.authorization || "",
  ).replace(/^Bearer\s+/i, "");
}

export async function registerIntelligenceRoutes(
  app: FastifyInstance,
  auth: AuthService,
  intelligence: IntelligenceService,
) {
  app.get("/api/v1/intelligence/playbooks", async (request) => {
    await auth.authenticate(bearerToken(request));
    return {
      provider: intelligence.mode,
      configured: intelligence.configuredPlaybooks(),
      playbooks: intelligencePlaybookCatalog,
    };
  });

  app.get("/api/v1/intelligence/missions", async (request) => {
    const context = await auth.authenticate(bearerToken(request));
    return { missions: await intelligence.list(context.organization.id) };
  });

  app.post(
    "/api/v1/intelligence/missions",
    { config: { rateLimit: { max: 12, timeWindow: "30 minutes" } } },
    async (request, reply) => {
      const context = await auth.authenticate(bearerToken(request));
      const input = IntelligenceMissionCreateSchema.parse(request.body);
      const brands = await auth.listBrands(context.organization.id);
      const brand = brands.find((item) => item.id === input.brandId);
      if (!brand) {
        throw new IntelligenceError(
          "INTELLIGENCE_BRAND_NOT_FOUND",
          404,
          "Marca não encontrada nesta organização.",
        );
      }
      const mission = await intelligence.create(
        context.organization.id,
        context.user.id,
        input,
        {
          id: brand.id,
          name: brand.name,
          niche: brand.niche,
          websiteUrl: brand.websiteUrl || "",
          instagramHandle: brand.instagramHandle || "",
        },
      );
      return reply.code(201).send(mission);
    },
  );

  app.get("/api/v1/intelligence/missions/:id", async (request) => {
    const context = await auth.authenticate(bearerToken(request));
    const id = z.string().uuid().parse((request.params as { id: string }).id);
    return intelligence.get(id, context.organization.id);
  });

  app.get("/api/v1/intelligence/missions/:id/results", async (request) => {
    const context = await auth.authenticate(bearerToken(request));
    const id = z.string().uuid().parse((request.params as { id: string }).id);
    const limit = z.coerce.number().int().min(1).max(500).default(100).parse(
      (request.query as { limit?: string }).limit,
    );
    return intelligence.results(id, context.organization.id, limit);
  });

  app.post("/api/v1/intelligence/missions/:id/retry", async (request) => {
    const context = await auth.authenticate(bearerToken(request));
    const id = z.string().uuid().parse((request.params as { id: string }).id);
    const mission = await intelligence.get(id, context.organization.id, false);
    const brands = await auth.listBrands(context.organization.id);
    const brand = brands.find((item) => item.id === mission.brandId);
    if (!brand) {
      throw new IntelligenceError(
        "INTELLIGENCE_BRAND_NOT_FOUND",
        404,
        "Marca vinculada à missão não foi encontrada.",
      );
    }
    return intelligence.retry(id, context.organization.id, {
      id: brand.id,
      name: brand.name,
      niche: brand.niche,
      websiteUrl: brand.websiteUrl || "",
      instagramHandle: brand.instagramHandle || "",
    });
  });

  app.post(
    "/api/v1/internal/intelligence/missions/:id/result",
    { config: { rateLimit: { max: 120, timeWindow: "1 minute" } } },
    async (request, reply) => {
      intelligence.validateCallbackSecret(callbackSecret(request));
      const id = z.string().uuid().parse((request.params as { id: string }).id);
      const callback = IntelligenceCallbackSchema.parse(request.body);
      await intelligence.applyCallback(id, callback);
      return reply.code(200).send({ received: true });
    },
  );
}
