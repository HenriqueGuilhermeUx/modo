import {
  BrandFoundationUpsertSchema,
  ChannelMapUpsertSchema,
  HumanSupportRequestCreateSchema,
  RevenueMapUpsertSchema,
  SpecialistApplicationCreateSchema,
} from "@modo/contracts/strategy-network";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { AuthError } from "../services/auth-service.js";
import { BillingError } from "../services/billing-service.js";
import { ContentAutomationError } from "../services/content-automation-service.js";
import { ContentError } from "../services/content-service.js";
import { CreativeIntelligenceError } from "../services/creative-intelligence-service.js";
import { PaymentError } from "../services/payment-service.js";
import { PlatformAdminError } from "../services/platform-admin-service.js";
import {
  StrategyNetworkError,
  StrategyNetworkService,
} from "../services/strategy-network-service.js";

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
}

export async function registerStrategyNetworkRoutes(app: FastifyInstance, options: Options) {
  const service = new StrategyNetworkService(options);
  await service.initialize();
  app.addHook("onClose", async () => service.close());

  app.get("/api/v1/strategy-network/status", async (request) => {
    const context = await service.authenticate(bearerToken(request));
    return {
      enabled: true,
      storage: service.storage,
      organizationId: context.organizationId,
      modules: ["brand_foundation", "channel_map", "revenue_map", "human_support", "specialist_network"],
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
      return reply.code(201).send(await service.createSupportRequest(context, input));
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
