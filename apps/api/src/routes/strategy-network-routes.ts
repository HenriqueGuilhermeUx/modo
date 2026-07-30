import {
  BrandFoundationUpsertSchema,
  ChannelMapUpsertSchema,
  HumanSupportRequestCreateSchema,
  RevenueMapUpsertSchema,
  SpecialistApplicationCreateSchema,
  type HumanSupportRequestCreate,
} from "@modo/contracts/strategy-network";
import type { FastifyInstance, FastifyRequest } from "fastify";
import pg, { type Pool } from "pg";
import { AuthError } from "../services/auth-service.js";
import { BillingError } from "../services/billing-service.js";
import { ContentAutomationError } from "../services/content-automation-service.js";
import { ContentError } from "../services/content-service.js";
import { CreativeIntelligenceError } from "../services/creative-intelligence-service.js";
import { HumanSupportNotifier } from "../services/human-support-notifier.js";
import { PaymentError } from "../services/payment-service.js";
import { PlatformAdminError } from "../services/platform-admin-service.js";
import {
  StrategyNetworkError,
  StrategyNetworkService,
} from "../services/strategy-network-service.js";

const { Pool: PgPool } = pg;

function bearerToken(request: FastifyRequest) {
  const value = request.headers.authorization;
  if (!value?.startsWith("Bearer ")) {
    throw new StrategyNetworkError("UNAUTHORIZED", 401, "Faça login para continuar.");
  }
  return value.slice(7).trim();
}

interface Options {
  databaseUrl?: string;
  databaseSsl?: boolean;
  resendApiKey?: string;
  humanSupportEmailFrom?: string;
  humanSupportEmailTo?: string;
  humanSupportNotificationWebhookUrl?: string;
  publicWebUrl?: string;
}

export async function registerStrategyNetworkRoutes(app: FastifyInstance, options: Options) {
  const service = new StrategyNetworkService(options);
  const notifier = new HumanSupportNotifier({
    resendApiKey: options.resendApiKey,
    emailFrom: options.humanSupportEmailFrom,
    emailTo: options.humanSupportEmailTo,
    webhookUrl: options.humanSupportNotificationWebhookUrl,
    publicWebUrl: options.publicWebUrl,
  });
  const eligibilityPool: Pool | undefined = options.databaseUrl
    ? new PgPool({
        connectionString: options.databaseUrl,
        ssl: options.databaseSsl ? { rejectUnauthorized: false } : undefined,
        max: 2,
      })
    : undefined;

  await service.initialize();
  app.addHook("onClose", async () => {
    await Promise.all([service.close(), eligibilityPool?.end()]);
  });

  async function assertCurationEligibility(
    organizationId: string,
    input: HumanSupportRequestCreate,
  ) {
    if (!eligibilityPool) return;

    if (input.contentRequestId) {
      const result = await eligibilityPool.query<{
        brand_id: string;
        status: string;
      }>(
        `SELECT brand_id,status
         FROM modo_content_requests
         WHERE id=$1 AND organization_id=$2
         LIMIT 1`,
        [input.contentRequestId, organizationId],
      );
      const content = result.rows[0];
      if (!content || content.brand_id !== input.brandId) {
        throw new StrategyNetworkError(
          "CONTENT_NOT_FOUND",
          404,
          "Entrega não encontrada nesta marca.",
        );
      }
      if (content.status !== "approved") {
        throw new StrategyNetworkError(
          "CURATION_NOT_AVAILABLE",
          409,
          "A curadoria fica disponível depois que a entrega for aprovada.",
        );
      }
      return;
    }

    const result = await eligibilityPool.query(
      `SELECT 1
       FROM modo_content_requests
       WHERE organization_id=$1 AND brand_id=$2 AND status='approved'
       LIMIT 1`,
      [organizationId, input.brandId],
    );
    if (!result.rowCount) {
      throw new StrategyNetworkError(
        "CURATION_NOT_AVAILABLE",
        409,
        "A curadoria fica disponível depois da primeira entrega aprovada desta marca.",
      );
    }
  }

  app.get("/api/v1/strategy-network/status", async (request) => {
    const context = await service.authenticate(bearerToken(request));
    return {
      enabled: true,
      storage: service.storage,
      organizationId: context.organizationId,
      modules: ["brand_foundation", "channel_map", "revenue_map", "human_support", "specialist_network"],
      humanSupportNotification: notifier.configured ? "configured" : "not_configured",
    };
  });

  app.get("/api/v1/brands/:brandId/foundation", async (request) => {
    const context = await service.authenticate(bearerToken(request));
    const brandId = (request.params as { brandId: string }).brandId;
    return { foundation: await service.getFoundation(context.organizationId, brandId) };
  });

  app.put("/api/v1/brands/:brandId/foundation", async (request) => {
    const context = await service.authenticate(bearerToken(request));
    const brandId = (request.params as { brandId: string }).brandId;
    const input = BrandFoundationUpsertSchema.parse({
      ...(request.body as Record<string, unknown>),
      brandId,
    });
    return service.upsertFoundation(context.organizationId, input);
  });

  app.get("/api/v1/brands/:brandId/channel-map", async (request) => {
    const context = await service.authenticate(bearerToken(request));
    const brandId = (request.params as { brandId: string }).brandId;
    return { channelMap: await service.getChannelMap(context.organizationId, brandId) };
  });

  app.put("/api/v1/brands/:brandId/channel-map", async (request) => {
    const context = await service.authenticate(bearerToken(request));
    const brandId = (request.params as { brandId: string }).brandId;
    const input = ChannelMapUpsertSchema.parse({
      ...(request.body as Record<string, unknown>),
      brandId,
    });
    return service.upsertChannelMap(context.organizationId, input);
  });

  app.get("/api/v1/brands/:brandId/revenue-map", async (request) => {
    const context = await service.authenticate(bearerToken(request));
    const brandId = (request.params as { brandId: string }).brandId;
    return { revenueMap: await service.getRevenueMap(context.organizationId, brandId) };
  });

  app.put("/api/v1/brands/:brandId/revenue-map", async (request) => {
    const context = await service.authenticate(bearerToken(request));
    const brandId = (request.params as { brandId: string }).brandId;
    const input = RevenueMapUpsertSchema.parse({
      ...(request.body as Record<string, unknown>),
      brandId,
    });
    return service.upsertRevenueMap(context.organizationId, input);
  });

  app.get("/api/v1/human-support-requests", async (request) => {
    const context = await service.authenticate(bearerToken(request));
    return { requests: await service.listSupportRequests(context.organizationId) };
  });

  app.post(
    "/api/v1/human-support-requests",
    { config: { rateLimit: { max: 8, timeWindow: "30 minutes" } } },
    async (request, reply) => {
      const context = await service.authenticate(bearerToken(request));
      const input = HumanSupportRequestCreateSchema.parse(request.body);
      await assertCurationEligibility(context.organizationId, input);
      const created = await service.createSupportRequest(context, input);
      await notifier.notifyNewRequest({
        requestId: created.id,
        requesterEmail: context.email,
        brandId: created.brandId,
        contentRequestId: created.contentRequestId,
        supportType: created.type,
        urgency: created.urgency,
        createdAt: created.createdAt,
      }).catch((error) => {
        console.error("[MODO_HUMAN_SUPPORT_NOTIFICATION_FAILED]", {
          requestId: created.id,
          error: error instanceof Error ? error.message : String(error),
        });
      });
      return reply.code(201).send(created);
    },
  );

  app.post(
    "/api/v1/public/specialist-applications",
    { config: { rateLimit: { max: 5, timeWindow: "1 hour" } } },
    async (request, reply) => {
      const input = SpecialistApplicationCreateSchema.parse(request.body);
      return reply.code(201).send(await service.createSpecialistApplication(input));
    },
  );

  app.setErrorHandler((error, _request, reply) => {
    if (
      error instanceof StrategyNetworkError ||
      error instanceof BillingError ||
      error instanceof AuthError ||
      error instanceof PaymentError ||
      error instanceof ContentError ||
      error instanceof ContentAutomationError ||
      error instanceof CreativeIntelligenceError ||
      error instanceof PlatformAdminError
    ) {
      return reply.code(error.statusCode).send({ code: error.code, message: error.message });
    }
    const message = error instanceof Error ? error.message : "Ocorreu um erro inesperado.";
    const name = error instanceof Error ? error.name : "UnknownError";
    const validation = name === "ZodError" || message.includes("URL") || message.includes("Endereços");
    return reply.code(validation ? 400 : 500).send({
      code: validation ? "INVALID_REQUEST" : "INTERNAL_ERROR",
      message: validation ? message : "Ocorreu um erro inesperado.",
    });
  });
}
