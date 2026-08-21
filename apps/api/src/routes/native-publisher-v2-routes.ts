import {
  NativePublicationCreateSchema,
  NativeProviderConnectSchema,
  NativePublisherProviderSchema,
} from "@modo/contracts/native-publisher";
import type { FastifyInstance, FastifyRequest } from "fastify";
import pg, { type Pool } from "pg";
import { z } from "zod";
import { AuthError, AuthService } from "../services/auth-service.js";
import { ContentAssetService } from "../services/content-asset-service.js";
import { ContentService } from "../services/content-service.js";
import { CreativeIntelligenceService } from "../services/creative-intelligence-service.js";
import { DistributionQualityService } from "../services/distribution-quality-service.js";
import { NativePublisherV2Error, NativePublisherV2Service } from "../services/native-publisher-v2-service.js";

const { Pool: PgPool } = pg;

interface Options {
  databaseUrl?: string;
  databaseSsl?: boolean;
  publicApiUrl?: string;
  publicWebUrl?: string;
  instagramEncryptionSecret?: string;
  instagramGraphBaseUrl?: string;
  instagramApiVersion?: string;
  facebookAppId?: string;
  facebookAppSecret?: string;
  facebookRedirectUri?: string;
  facebookApiVersion?: string;
  threadsAppId?: string;
  threadsAppSecret?: string;
  threadsRedirectUri?: string;
  threadsScopes?: string;
  linkedinEncryptionSecret?: string;
  linkedinApiVersion?: string;
}

function bearerToken(request: FastifyRequest) {
  const value = request.headers.authorization;
  if (!value?.startsWith("Bearer ")) throw new AuthError("UNAUTHORIZED", 401, "Faça login para continuar.");
  return value.slice(7).trim();
}

export async function registerNativePublisherV2Routes(app: FastifyInstance, options: Options) {
  const auth = new AuthService({ databaseUrl: options.databaseUrl, databaseSsl: options.databaseSsl });
  const content = new ContentService({ databaseUrl: options.databaseUrl, databaseSsl: options.databaseSsl });
  const assets = new ContentAssetService({ databaseUrl: options.databaseUrl, databaseSsl: options.databaseSsl, publicApiUrl: options.publicApiUrl });
  const creative = new CreativeIntelligenceService({ databaseUrl: options.databaseUrl, databaseSsl: options.databaseSsl });
  const quality = new DistributionQualityService();
  const publisher = new NativePublisherV2Service(options);
  const learningPool: Pool | undefined = options.databaseUrl
    ? new PgPool({ connectionString: options.databaseUrl, ssl: options.databaseSsl ? { rejectUnauthorized: false } : undefined, max: 2 })
    : undefined;

  await Promise.all([auth.initialize(), content.initialize(), assets.initialize(), creative.initialize(), publisher.initialize()]);
  if (learningPool) {
    await learningPool.query(`
      CREATE TABLE IF NOT EXISTS modo_native_social_learning_events (
        snapshot_id UUID PRIMARY KEY REFERENCES modo_native_social_analytics(id) ON DELETE CASCADE,
        organization_id TEXT NOT NULL,
        brand_id TEXT NOT NULL,
        publication_id UUID NOT NULL,
        signal TEXT NOT NULL,
        recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
  }

  const learningTimer = setInterval(() => void processLearningQueue().catch(() => undefined), 5 * 60_000);
  learningTimer.unref?.();
  app.addHook("onClose", async () => {
    clearInterval(learningTimer);
    await Promise.all([auth.close(), content.close(), assets.close(), creative.close(), publisher.close(), learningPool?.end()]);
  });

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof NativePublisherV2Error || error instanceof AuthError) {
      return reply.code(error.statusCode).send({ code: error.code, message: error.message });
    }
    request.log.error({ error }, "Publisher V2 error");
    return reply.code(500).send({ code: "PUBLISHER_V2_INTERNAL_ERROR", message: "Não foi possível concluir a operação no Publisher." });
  });

  async function context(request: FastifyRequest) {
    return auth.authenticate(bearerToken(request));
  }

  async function requireBrand(request: FastifyRequest, brandId: string) {
    const current = await context(request);
    const brands = await auth.listBrands(current.organization.id);
    const brand = brands.find((item) => item.id === brandId);
    if (!brand) throw new AuthError("BRAND_NOT_FOUND", 404, "Marca não encontrada nesta organização.");
    return { current, brand };
  }

  async function qualityFor(organizationId: string, brandId: string, contentRequestId: string) {
    const request = await content.getForOrganization(contentRequestId, organizationId);
    if (request.brandId !== brandId) throw new AuthError("CONTENT_BRAND_MISMATCH", 409, "O conteúdo pertence a outra marca.");
    const profile = await creative.getProfile(organizationId, brandId);
    return { request, report: quality.evaluate(request, profile) };
  }

  async function applyLearningSnapshot(organizationId: string, publicationId: string, snapshot: { id: string; learningSignal: "performed_well" | "performed_poorly" | "neutral"; score: number; metrics: Record<string, number> }) {
    if (!learningPool || snapshot.learningSignal === "neutral") return;
    const publication = await learningPool.query<{ brand_id: string; content_request_id: string }>(
      `SELECT brand_id,content_request_id FROM modo_native_social_publications WHERE id=$1 AND organization_id=$2 LIMIT 1`,
      [publicationId, organizationId],
    );
    const row = publication.rows[0];
    if (!row) return;
    const claimed = await learningPool.query(
      `INSERT INTO modo_native_social_learning_events(snapshot_id,organization_id,brand_id,publication_id,signal)
       VALUES($1,$2,$3,$4,$5) ON CONFLICT(snapshot_id) DO NOTHING RETURNING snapshot_id`,
      [snapshot.id, organizationId, row.brand_id, publicationId, snapshot.learningSignal],
    );
    if (!claimed.rowCount) return;
    await creative.recordFeedback(organizationId, row.brand_id, {
      contentRequestId: row.content_request_id,
      signal: snapshot.learningSignal,
      score: snapshot.score,
      notes: `native_publisher:${publicationId}`,
      metrics: snapshot.metrics,
    });
  }

  async function processLearningQueue() {
    if (!learningPool) return;
    const pending = await learningPool.query<any>(
      `SELECT a.id,a.publication_id,a.score,a.learning_signal,a.metrics,p.organization_id
       FROM modo_native_social_analytics a
       JOIN modo_native_social_publications p ON p.id=a.publication_id
       LEFT JOIN modo_native_social_learning_events e ON e.snapshot_id=a.id
       WHERE e.snapshot_id IS NULL AND a.learning_signal IN ('performed_well','performed_poorly')
       ORDER BY a.collected_at ASC LIMIT 50`,
    );
    for (const row of pending.rows) {
      await applyLearningSnapshot(row.organization_id, row.publication_id, {
        id: row.id,
        learningSignal: row.learning_signal,
        score: Number(row.score),
        metrics: row.metrics || {},
      }).catch(() => undefined);
    }
  }

  app.get("/api/v2/publisher/health", async () => ({
    status: "ok",
    provider: "modo_native_v2",
    storage: publisher.storage,
    providers: publisher.providers,
    capabilities: {
      multiBrand: true,
      scheduling: true,
      retries: true,
      idempotency: true,
      analytics: true,
      learning: true,
      qualityGate: true,
      calendar: true,
    },
    callbacks: {
      facebook: options.facebookRedirectUri || null,
      threads: options.threadsRedirectUri || null,
    },
  }));

  app.get("/api/v2/publisher/connections", async (request) => {
    const current = await context(request);
    const brandId = z.string().uuid().optional().parse((request.query as { brandId?: string })?.brandId);
    if (brandId) await requireBrand(request, brandId);
    return { connections: await publisher.listConnections(current.organization.id, brandId) };
  });

  app.post("/api/v2/publisher/connections/instagram/import", async (request, reply) => {
    const { brandId } = NativeProviderConnectSchema.parse(request.body);
    const { current } = await requireBrand(request, brandId);
    const connection = await publisher.importLegacyInstagram(current.organization.id, brandId);
    return reply.code(201).send({ connection });
  });

  app.post("/api/v2/publisher/connections/linkedin/import", async (request, reply) => {
    const { brandId } = NativeProviderConnectSchema.parse(request.body);
    const { current } = await requireBrand(request, brandId);
    const connection = await publisher.importLegacyLinkedIn(current.organization.id, brandId);
    return reply.code(201).send({ connection });
  });

  app.post("/api/v2/publisher/connect/facebook", async (request) => {
    const { brandId } = NativeProviderConnectSchema.parse(request.body);
    const { current } = await requireBrand(request, brandId);
    return publisher.createFacebookAuthorizationUrl(current.organization.id, brandId);
  });

  app.get("/api/v2/publisher/oauth/facebook/callback", async (request, reply) => {
    const query = request.query as { state?: string; code?: string; error?: string };
    try {
      await publisher.completeFacebookAuthorization(query);
      return reply.redirect(`${options.publicWebUrl || "http://localhost:5173"}/app/settings/integrations?facebook=connected`);
    } catch (error) {
      const message = encodeURIComponent(error instanceof Error ? error.message.slice(0, 300) : "Autorização não concluída.");
      return reply.redirect(`${options.publicWebUrl || "http://localhost:5173"}/app/settings/integrations?facebook=error&message=${message}`);
    }
  });

  app.post("/api/v2/publisher/connect/threads", async (request) => {
    const { brandId } = NativeProviderConnectSchema.parse(request.body);
    const { current } = await requireBrand(request, brandId);
    return publisher.createThreadsAuthorizationUrl(current.organization.id, brandId);
  });

  app.get("/api/v2/publisher/oauth/threads/callback", async (request, reply) => {
    const query = request.query as { state?: string; code?: string; error?: string };
    try {
      await publisher.completeThreadsAuthorization(query);
      return reply.redirect(`${options.publicWebUrl || "http://localhost:5173"}/app/settings/integrations?threads=connected`);
    } catch (error) {
      const message = encodeURIComponent(error instanceof Error ? error.message.slice(0, 300) : "Autorização não concluída.");
      return reply.redirect(`${options.publicWebUrl || "http://localhost:5173"}/app/settings/integrations?threads=error&message=${message}`);
    }
  });

  app.get("/api/v2/publisher/quality/:contentRequestId", async (request) => {
    const current = await context(request);
    const contentRequestId = z.string().uuid().parse((request.params as { contentRequestId: string }).contentRequestId);
    const requestRecord = await content.getForOrganization(contentRequestId, current.organization.id);
    const profile = await creative.getProfile(current.organization.id, requestRecord.brandId);
    return quality.evaluate(requestRecord, profile);
  });

  app.post("/api/v2/publisher/publications", { config: { rateLimit: { max: 20, timeWindow: "10 minutes" } } }, async (request, reply) => {
    const input = NativePublicationCreateSchema.parse(request.body);
    const { current } = await requireBrand(request, input.brandId);
    const { request: contentRequest, report } = await qualityFor(current.organization.id, input.brandId, input.contentRequestId);
    if (!report.publishAllowed) throw new NativePublisherV2Error("QUALITY_GATE_BLOCKED", 409, report.blockers[0] || "A peça foi bloqueada pelo Quality Gate.");
    const imageUrl = contentRequest.output
      ? await assets.getPublicUrlForRequest(current.organization.id, contentRequest.id, contentRequest.output.imageUrl)
      : null;
    const publication = await publisher.createPublication({
      organizationId: current.organization.id,
      brandId: input.brandId,
      content: contentRequest,
      provider: input.provider,
      connectionId: input.connectionId,
      mode: input.mode,
      scheduledFor: input.scheduledFor,
      idempotencyKey: input.idempotencyKey,
      qualityScore: report.score,
      imageUrl,
    });
    if (publication.status === "published") {
      await creative.recordFeedback(current.organization.id, input.brandId, {
        contentRequestId: contentRequest.id,
        signal: "published",
        score: report.score,
        notes: `native_publisher:${publication.id}`,
        metrics: { qualityScore: report.score },
      });
    }
    return reply.code(201).send({ publication, quality: report });
  });

  app.get("/api/v2/publisher/publications", async (request) => {
    const current = await context(request);
    const brandId = z.string().uuid().optional().parse((request.query as { brandId?: string })?.brandId);
    if (brandId) await requireBrand(request, brandId);
    return { publications: await publisher.listPublications(current.organization.id, brandId) };
  });

  app.post("/api/v2/publisher/publications/:id/cancel", async (request) => {
    const current = await context(request);
    const id = z.string().uuid().parse((request.params as { id: string }).id);
    return { publication: await publisher.cancelPublication(current.organization.id, id) };
  });

  app.post("/api/v2/publisher/publications/:id/retry", async (request) => {
    const current = await context(request);
    const id = z.string().uuid().parse((request.params as { id: string }).id);
    return { publication: await publisher.retryPublication(current.organization.id, id) };
  });

  app.post("/api/v2/publisher/publications/:id/analytics/refresh", async (request) => {
    const current = await context(request);
    const id = z.string().uuid().parse((request.params as { id: string }).id);
    const snapshot = await publisher.refreshAnalytics(current.organization.id, id);
    await applyLearningSnapshot(current.organization.id, id, snapshot);
    return { snapshot };
  });

  app.get("/api/v2/publisher/publications/:id/analytics", async (request) => {
    const current = await context(request);
    const id = z.string().uuid().parse((request.params as { id: string }).id);
    return { snapshots: await publisher.analyticsForPublication(current.organization.id, id) };
  });

  app.get("/api/v2/publisher/brands/:brandId/insights", async (request) => {
    const brandId = z.string().uuid().parse((request.params as { brandId: string }).brandId);
    const { current } = await requireBrand(request, brandId);
    const days = z.coerce.number().int().min(7).max(365).default(30).parse((request.query as { days?: unknown })?.days ?? 30);
    return publisher.brandInsight(current.organization.id, brandId, days);
  });

  app.get("/api/v2/publisher/brands/:brandId/calendar", async (request) => {
    const brandId = z.string().uuid().parse((request.params as { brandId: string }).brandId);
    const { current } = await requireBrand(request, brandId);
    const query = request.query as { from?: string; to?: string };
    const now = new Date();
    const from = query.from ? new Date(query.from) : new Date(now.getTime() - 7 * 24 * 60 * 60_000);
    const to = query.to ? new Date(query.to) : new Date(now.getTime() + 30 * 24 * 60 * 60_000);
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || from >= to) throw new NativePublisherV2Error("INVALID_CALENDAR_RANGE", 400, "Intervalo do calendário inválido.");
    return { items: await publisher.calendar(current.organization.id, brandId, from, to) };
  });
}