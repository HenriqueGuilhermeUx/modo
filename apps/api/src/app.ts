import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import {
  BillingAccountIdSchema,
  CreditConsumeRequestSchema,
  DemoSubscriptionCreateRequestSchema,
  DiagnosticCreateRequestSchema,
  LeadCreateRequestSchema,
  planEntitlements,
} from "@modo/contracts";
import Fastify from "fastify";
import type { DiagnosticProvider } from "./providers/diagnostic-provider.js";
import { assertPublicHttpUrl } from "./security/public-url.js";
import { BillingError, BillingService } from "./services/billing-service.js";
import { DiagnosticService } from "./services/diagnostic-service.js";
import { LeadService } from "./services/lead-service.js";

export interface CreateAppOptions {
  provider: DiagnosticProvider;
  allowedOrigins?: string[];
  logger?: boolean;
  databaseUrl?: string;
  databaseSsl?: boolean;
}

export async function createApp(options: CreateAppOptions) {
  const app = Fastify({ logger: options.logger ?? false });
  const diagnosticService = new DiagnosticService(options.provider);
  const leadService = new LeadService();
  const billingService = new BillingService({
    databaseUrl: options.databaseUrl,
    databaseSsl: options.databaseSsl,
  });
  const allowedOrigins = options.allowedOrigins ?? ["http://localhost:5173"];

  await billingService.initialize();
  app.addHook("onClose", async () => billingService.close());

  await app.register(helmet, { contentSecurityPolicy: false });
  await app.register(cors, {
    origin(origin, callback) {
      if (!origin || allowedOrigins.includes("*") || allowedOrigins.includes(origin)) {
        return callback(null, true);
      }
      callback(new Error("Origem não permitida."), false);
    },
  });
  await app.register(rateLimit, { max: 80, timeWindow: "1 minute" });

  app.get("/health", async () => ({
    status: "ok",
    service: "modo-api",
    version: "0.2.0",
    billingStorage: billingService.storage,
  }));

  app.get("/api/v1/plans", async () => ({ plans: planEntitlements }));

  app.post(
    "/api/v1/diagnostics",
    { config: { rateLimit: { max: 8, timeWindow: "10 minutes" } } },
    async (request, reply) => {
      const input = DiagnosticCreateRequestSchema.parse(request.body);
      assertPublicHttpUrl(input.websiteUrl);
      const job = diagnosticService.create(input);
      return reply.code(202).send({
        id: job.id,
        status: job.status,
        pollUrl: `/api/v1/diagnostics/${job.id}`,
      });
    },
  );

  app.get("/api/v1/diagnostics/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const job = diagnosticService.get(id);
    if (!job) {
      return reply
        .code(404)
        .send({ code: "DIAGNOSTIC_NOT_FOUND", message: "Diagnóstico não encontrado." });
    }
    return job;
  });

  app.post(
    "/api/v1/leads",
    { config: { rateLimit: { max: 10, timeWindow: "10 minutes" } } },
    async (request, reply) => {
      const input = LeadCreateRequestSchema.parse(request.body);
      if (!diagnosticService.get(input.diagnosticId)) {
        return reply
          .code(404)
          .send({ code: "DIAGNOSTIC_NOT_FOUND", message: "Diagnóstico não encontrado." });
      }
      const lead = leadService.create(input);
      request.log.info({ leadId: lead.id }, "Lead capturado");
      return reply.code(201).send({ id: lead.id, status: "captured" });
    },
  );

  app.post(
    "/api/v1/billing/demo/subscriptions",
    { config: { rateLimit: { max: 12, timeWindow: "10 minutes" } } },
    async (request, reply) => {
      const input = DemoSubscriptionCreateRequestSchema.parse(request.body);
      const usage = await billingService.createOrUpdateDemoSubscription(input.accountId, input.plan);
      return reply.code(201).send(usage);
    },
  );

  app.get("/api/v1/billing/accounts/:accountId/usage", async (request) => {
    const accountId = BillingAccountIdSchema.parse(
      (request.params as { accountId: string }).accountId,
    );
    return billingService.getUsage(accountId);
  });

  app.post(
    "/api/v1/billing/accounts/:accountId/consume",
    { config: { rateLimit: { max: 40, timeWindow: "1 minute" } } },
    async (request) => {
      const accountId = BillingAccountIdSchema.parse(
        (request.params as { accountId: string }).accountId,
      );
      const input = CreditConsumeRequestSchema.parse(request.body);
      return billingService.consume(accountId, input);
    },
  );

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof BillingError) {
      return reply.code(error.statusCode).send({ code: error.code, message: error.message });
    }

    const errorMessage = error instanceof Error ? error.message : "Ocorreu um erro inesperado.";
    const errorName = error instanceof Error ? error.name : "UnknownError";
    const isValidation =
      errorName === "ZodError" ||
      errorMessage.includes("URL") ||
      errorMessage.includes("Endereços");
    const statusCode = isValidation ? 400 : 500;
    return reply.code(statusCode).send({
      code: statusCode === 400 ? "INVALID_REQUEST" : "INTERNAL_ERROR",
      message: isValidation ? errorMessage : "Ocorreu um erro inesperado.",
    });
  });

  return app;
}
