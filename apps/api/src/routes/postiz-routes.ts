import {
  PostizClaimRequestSchema,
  PostizConnectRequestSchema,
  PostizPublishRequestSchema,
} from "@modo/contracts/postiz";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { AuthError, type AuthService } from "../services/auth-service.js";
import type { ContentService } from "../services/content-service.js";
import { CreativeIntelligenceService } from "../services/creative-intelligence-service.js";
import { PostizLearningBridge } from "../services/postiz-learning-bridge.js";
import { PostizService } from "../services/postiz-service.js";

interface Options {
  auth: AuthService;
  content: ContentService;
  apiKey?: string;
  baseUrl?: string;
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

export async function registerPostizRoutes(app: FastifyInstance, options: Options) {
  const service = new PostizService({
    apiKey: options.apiKey,
    baseUrl: options.baseUrl,
    databaseUrl: options.databaseUrl,
    databaseSsl: options.databaseSsl,
  });
  const creative = new CreativeIntelligenceService({
    databaseUrl: options.databaseUrl,
    databaseSsl: options.databaseSsl,
  });
  const learning = new PostizLearningBridge({
    databaseUrl: options.databaseUrl,
    databaseSsl: options.databaseSsl,
  });

  await Promise.all([service.initialize(), creative.initialize()]);
  app.addHook("onClose", async () => {
    await Promise.all([service.close(), creative.close(), learning.close()]);
  });

  app.get("/api/v1/distribution/status", async (request) => {
    const context = await options.auth.authenticate(bearerToken(request));
    const brandIdRaw = (request.query as { brandId?: string })?.brandId;
    const brandId = brandIdRaw ? z.string().uuid().parse(brandIdRaw) : undefined;
    if (brandId) await requireBrand(options.auth, request, brandId);
    return service.connectionStatus(context.organization.id, brandId);
  });

  app.get("/api/v1/distribution/integrations", async (request) => {
    const context = await options.auth.authenticate(bearerToken(request));
    const brandIdRaw = (request.query as { brandId?: string })?.brandId;
    const brandId = brandIdRaw ? z.string().uuid().parse(brandIdRaw) : undefined;
    if (brandId) await requireBrand(options.auth, request, brandId);
    return { integrations: await service.listConnections(context.organization.id, brandId) };
  });

  app.post(
    "/api/v1/distribution/connections",
    { config: { rateLimit: { max: 12, timeWindow: "10 minutes" } } },
    async (request, reply) => {
      const input = PostizConnectRequestSchema.parse(request.body);
      const { context } = await requireBrand(options.auth, request, input.brandId);
      return reply
        .code(201)
        .send(await service.startConnection(context.organization.id, input.brandId, input.platform));
    },
  );

  app.post("/api/v1/distribution/connections/claim", async (request) => {
    const context = await options.auth.authenticate(bearerToken(request));
    const input = PostizClaimRequestSchema.parse(request.body);
    return service.claimConnection(context.organization.id, input.pendingId);
  });

  app.delete("/api/v1/distribution/integrations/:id", async (request) => {
    const context = await options.auth.authenticate(bearerToken(request));
    const id = z.string().min(1).max(240).parse((request.params as { id: string }).id);
    return service.removeConnection(context.organization.id, id);
  });

  app.post(
    "/api/v1/content-requests/:id/distribute",
    { config: { rateLimit: { max: 20, timeWindow: "10 minutes" } } },
    async (request, reply) => {
      const context = await options.auth.authenticate(bearerToken(request));
      const id = z.string().uuid().parse((request.params as { id: string }).id);
      const contentRequest = await options.content.getForOrganization(id, context.organization.id);
      const input = PostizPublishRequestSchema.parse(request.body);
      const publications = await service.publish(context.organization.id, contentRequest, input);
      const recommendationId = await learning.recommendationIdForContent(
        context.organization.id,
        contentRequest.brandId,
        contentRequest.id,
      );
      await creative.recordFeedback(context.organization.id, contentRequest.brandId, {
        ...(recommendationId ? { recommendationId } : {}),
        contentRequestId: contentRequest.id,
        signal: "published",
        metrics: { channels: publications.length },
      });
      return reply.code(201).send({ publications });
    },
  );

  app.get("/api/v1/content-requests/:id/publications", async (request) => {
    const context = await options.auth.authenticate(bearerToken(request));
    const id = z.string().uuid().parse((request.params as { id: string }).id);
    await options.content.getForOrganization(id, context.organization.id);
    return { publications: await service.syncPublications(context.organization.id, id) };
  });

  app.post("/api/v1/publications/:id/analytics/refresh", async (request) => {
    const context = await options.auth.authenticate(bearerToken(request));
    const id = z.string().uuid().parse((request.params as { id: string }).id);
    const days = z.coerce
      .number()
      .int()
      .min(1)
      .max(365)
      .default(30)
      .parse((request.body as { days?: unknown })?.days ?? 30);
    const result = await service.refreshAnalytics(context.organization.id, id, days);
    if (result.summary.learningSignal !== "neutral") {
      const recommendationId = await learning.recommendationIdForContent(
        context.organization.id,
        result.publication.brandId,
        result.publication.contentRequestId,
      );
      await creative.recordFeedback(context.organization.id, result.publication.brandId, {
        ...(recommendationId ? { recommendationId } : {}),
        contentRequestId: result.publication.contentRequestId,
        signal: result.summary.learningSignal,
        score: result.summary.score,
        metrics: result.summary.normalized,
      });
    }
    return result;
  });

  app.get("/api/v1/brands/:brandId/distribution/insights", async (request) => {
    const brandId = z.string().uuid().parse((request.params as { brandId: string }).brandId);
    const { context } = await requireBrand(options.auth, request, brandId);
    return service.brandInsights(context.organization.id, brandId);
  });

  return service;
}
