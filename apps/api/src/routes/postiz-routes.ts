import {
  PostizClaimRequestSchema,
  PostizConnectRequestSchema,
  PostizPublishRequestSchema,
} from "@modo/contracts/postiz";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { createHash, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { AuthError, type AuthService } from "../services/auth-service.js";
import type { ContentService } from "../services/content-service.js";
import { CreativeIntelligenceService } from "../services/creative-intelligence-service.js";
import { DistributionQualityService } from "../services/distribution-quality-service.js";
import { PostizAnalyticsScheduler } from "../services/postiz-analytics-scheduler.js";
import { PostizLearningBridge } from "../services/postiz-learning-bridge.js";
import { PostizError, PostizService } from "../services/postiz-service.js";

interface Options {
  auth: AuthService;
  content: ContentService;
  apiKey?: string;
  baseUrl?: string;
  databaseUrl?: string;
  databaseSsl?: boolean;
  cronSecret?: string;
}

function bearerToken(request: FastifyRequest) {
  const value = request.headers.authorization;
  if (!value?.startsWith("Bearer ")) {
    throw new AuthError("UNAUTHORIZED", 401, "Faça login para continuar.");
  }
  return value.slice(7).trim();
}

function secureSecretMatch(candidate: string, expected?: string) {
  if (!expected || !candidate) return false;
  const left = createHash("sha256").update(candidate).digest();
  const right = createHash("sha256").update(expected).digest();
  return timingSafeEqual(left, right);
}

async function requireBrand(auth: AuthService, request: FastifyRequest, brandId: string) {
  const context = await auth.authenticate(bearerToken(request));
  const brands = await auth.listBrands(context.organization.id);
  const brand = brands.find((item) => item.id === brandId);
  if (!brand) throw new AuthError("BRAND_NOT_FOUND", 404, "Marca não encontrada nesta organização.");
  return { context, brand };
}

async function postizResponse<T>(reply: FastifyReply, operation: () => Promise<T>) {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof PostizError) {
      return reply.code(error.statusCode).send({ code: error.code, message: error.message });
    }
    throw error;
  }
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
  const quality = new DistributionQualityService();
  const scheduler = new PostizAnalyticsScheduler({
    databaseUrl: options.databaseUrl,
    databaseSsl: options.databaseSsl,
    postiz: service,
  });

  await Promise.all([service.initialize(), creative.initialize()]);
  app.addHook("onClose", async () => {
    await Promise.all([service.close(), creative.close(), learning.close(), scheduler.close()]);
  });

  async function qualityReport(accountId: string, contentRequestId: string) {
    const contentRequest = await options.content.getForOrganization(contentRequestId, accountId);
    const profile = await creative.getProfile(accountId, contentRequest.brandId);
    return quality.evaluate(contentRequest, profile);
  }

  async function recordPerformanceSignal(input: {
    accountId: string;
    brandId: string;
    contentRequestId: string;
    publicationId: string;
    signal: "performed_well" | "performed_poorly" | "neutral";
    score: number;
    normalized: Record<string, number>;
  }) {
    if (input.signal === "neutral") return;
    const alreadyLearned = await learning.performanceSignalAlreadyRecorded(
      input.accountId,
      input.contentRequestId,
      input.publicationId,
      input.signal,
    );
    if (alreadyLearned) return;
    const recommendationId = await learning.recommendationIdForContent(
      input.accountId,
      input.brandId,
      input.contentRequestId,
    );
    await creative.recordFeedback(input.accountId, input.brandId, {
      ...(recommendationId ? { recommendationId } : {}),
      contentRequestId: input.contentRequestId,
      signal: input.signal,
      score: input.score,
      notes: `postiz_publication:${input.publicationId}`,
      metrics: input.normalized,
    });
  }

  app.get("/api/v1/distribution/provider-health", async () => {
    let host = "invalid";
    try {
      host = new URL(service.baseUrl).host;
    } catch {
      // Mantém resposta segura mesmo em ambiente inválido.
    }
    return {
      status: "ok",
      provider: "postiz",
      configured: service.configured,
      mode: host === "api.postiz.com" ? "cloud" : "self_hosted",
      host,
      storage: service.storage,
      qualityGate: "enabled",
      analyticsAutomation: options.cronSecret ? "configured" : "not_configured",
    };
  });

  app.post(
    "/api/v1/internal/distribution/analytics/refresh-due",
    { config: { rateLimit: { max: 12, timeWindow: "1 hour" } } },
    async (request, reply) => {
      const candidate = String(
        request.headers["x-modo-distribution-secret"] || request.headers.authorization || "",
      ).replace(/^Bearer\s+/i, "");
      if (!secureSecretMatch(candidate, options.cronSecret)) {
        return reply.code(401).send({ code: "INVALID_DISTRIBUTION_SECRET", message: "Acesso negado." });
      }
      if (!service.configured) {
        return reply.code(503).send({
          code: "POSTIZ_NOT_CONFIGURED",
          message: "Configure o provider Postiz antes de atualizar analytics.",
        });
      }

      const limit = z.coerce.number().int().min(1).max(100).default(50).parse(
        (request.body as { limit?: unknown })?.limit ?? 50,
      );
      const batch = await scheduler.refreshDue(limit);
      for (const item of batch.results) {
        if (
          item.ok &&
          item.brandId &&
          item.contentRequestId &&
          item.learningSignal &&
          typeof item.score === "number"
        ) {
          await recordPerformanceSignal({
            accountId: item.accountId,
            brandId: item.brandId,
            contentRequestId: item.contentRequestId,
            publicationId: item.publicationId,
            signal: item.learningSignal,
            score: item.score,
            normalized: item.normalized || {},
          });
        }
      }
      return {
        processed: batch.processed,
        refreshed: batch.refreshed,
        failed: batch.failed,
      };
    },
  );

  app.get("/api/v1/distribution/status", async (request, reply) => {
    const context = await options.auth.authenticate(bearerToken(request));
    const brandIdRaw = (request.query as { brandId?: string })?.brandId;
    const brandId = brandIdRaw ? z.string().uuid().parse(brandIdRaw) : undefined;
    if (brandId) await requireBrand(options.auth, request, brandId);
    return postizResponse(reply, () => service.connectionStatus(context.organization.id, brandId));
  });

  app.get("/api/v1/distribution/integrations", async (request, reply) => {
    const context = await options.auth.authenticate(bearerToken(request));
    const brandIdRaw = (request.query as { brandId?: string })?.brandId;
    const brandId = brandIdRaw ? z.string().uuid().parse(brandIdRaw) : undefined;
    if (brandId) await requireBrand(options.auth, request, brandId);
    return postizResponse(reply, async () => ({
      integrations: await service.listConnections(context.organization.id, brandId),
    }));
  });

  app.get("/api/v1/content-requests/:id/distribution/quality", async (request) => {
    const context = await options.auth.authenticate(bearerToken(request));
    const id = z.string().uuid().parse((request.params as { id: string }).id);
    return qualityReport(context.organization.id, id);
  });

  app.post(
    "/api/v1/distribution/connections",
    { config: { rateLimit: { max: 12, timeWindow: "10 minutes" } } },
    async (request, reply) => {
      const input = PostizConnectRequestSchema.parse(request.body);
      const { context } = await requireBrand(options.auth, request, input.brandId);
      const result = await postizResponse(reply, () =>
        service.startConnection(context.organization.id, input.brandId, input.platform),
      );
      if (reply.sent) return result;
      return reply.code(201).send(result);
    },
  );

  app.post("/api/v1/distribution/connections/claim", async (request, reply) => {
    const context = await options.auth.authenticate(bearerToken(request));
    const input = PostizClaimRequestSchema.parse(request.body);
    return postizResponse(reply, () => service.claimConnection(context.organization.id, input.pendingId));
  });

  app.delete("/api/v1/distribution/integrations/:id", async (request, reply) => {
    const context = await options.auth.authenticate(bearerToken(request));
    const id = z.string().min(1).max(240).parse((request.params as { id: string }).id);
    return postizResponse(reply, () => service.removeConnection(context.organization.id, id));
  });

  app.post(
    "/api/v1/content-requests/:id/distribute",
    { config: { rateLimit: { max: 20, timeWindow: "10 minutes" } } },
    async (request, reply) => {
      const context = await options.auth.authenticate(bearerToken(request));
      const id = z.string().uuid().parse((request.params as { id: string }).id);
      const contentRequest = await options.content.getForOrganization(id, context.organization.id);
      const input = PostizPublishRequestSchema.parse(request.body);
      const result = await postizResponse(reply, async () => {
        const report = await qualityReport(context.organization.id, id);
        if (!report.publishAllowed) {
          throw new PostizError(
            "MODO_QUALITY_GATE_BLOCKED",
            409,
            report.blockers[0] || "A peça foi bloqueada pelo Quality Gate da MODO.",
          );
        }
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
          score: report.score,
          notes: `quality_gate:${report.status}`,
          metrics: { channels: publications.length, qualityScore: report.score },
        });
        return { publications, quality: report };
      });
      if (reply.sent) return result;
      return reply.code(201).send(result);
    },
  );

  app.get("/api/v1/content-requests/:id/publications", async (request, reply) => {
    const context = await options.auth.authenticate(bearerToken(request));
    const id = z.string().uuid().parse((request.params as { id: string }).id);
    await options.content.getForOrganization(id, context.organization.id);
    return postizResponse(reply, async () => ({
      publications: await service.syncPublications(context.organization.id, id),
    }));
  });

  app.post("/api/v1/publications/:id/analytics/refresh", async (request, reply) => {
    const context = await options.auth.authenticate(bearerToken(request));
    const id = z.string().uuid().parse((request.params as { id: string }).id);
    const days = z.coerce.number().int().min(1).max(365).default(30).parse(
      (request.body as { days?: unknown })?.days ?? 30,
    );
    return postizResponse(reply, async () => {
      const result = await service.refreshAnalytics(context.organization.id, id, days);
      await recordPerformanceSignal({
        accountId: context.organization.id,
        brandId: result.publication.brandId,
        contentRequestId: result.publication.contentRequestId,
        publicationId: result.publication.id,
        signal: result.summary.learningSignal,
        score: result.summary.score,
        normalized: result.summary.normalized,
      });
      return result;
    });
  });

  app.get("/api/v1/brands/:brandId/distribution/insights", async (request, reply) => {
    const brandId = z.string().uuid().parse((request.params as { brandId: string }).brandId);
    const { context } = await requireBrand(options.auth, request, brandId);
    return postizResponse(reply, () => service.brandInsights(context.organization.id, brandId));
  });

  return service;
}
