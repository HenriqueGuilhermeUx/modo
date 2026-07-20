import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import {
  BillingAccountIdSchema,
  BrandCreateRequestSchema,
  CreditConsumeRequestSchema,
  DemoSubscriptionCreateRequestSchema,
  DiagnosticCreateRequestSchema,
  LeadCreateRequestSchema,
  LoginRequestSchema,
  RegisterRequestSchema,
  planEntitlements,
} from "@modo/contracts";
import Fastify, { type FastifyRequest } from "fastify";
import type { DiagnosticProvider } from "./providers/diagnostic-provider.js";
import { assertPublicHttpUrl } from "./security/public-url.js";
import { AuthError, AuthService } from "./services/auth-service.js";
import { BillingError, BillingService } from "./services/billing-service.js";
import { DiagnosticService } from "./services/diagnostic-service.js";
import { LeadService } from "./services/lead-service.js";

export interface CreateAppOptions {
  provider: DiagnosticProvider;
  allowedOrigins?: string[];
  logger?: boolean;
  databaseUrl?: string;
  databaseSsl?: boolean;
  sessionDays?: number;
  enableDemoBilling?: boolean;
}

function bearerToken(request: FastifyRequest) {
  const authorization = request.headers.authorization;
  if (!authorization?.startsWith("Bearer ")) {
    throw new AuthError("UNAUTHORIZED", 401, "Faça login para continuar.");
  }
  return authorization.slice("Bearer ".length).trim();
}

export async function createApp(options: CreateAppOptions) {
  const app = Fastify({ logger: options.logger ?? false });
  const diagnosticService = new DiagnosticService(options.provider);
  const leadService = new LeadService();
  const billingService = new BillingService({
    databaseUrl: options.databaseUrl,
    databaseSsl: options.databaseSsl,
  });
  const authService = new AuthService({
    databaseUrl: options.databaseUrl,
    databaseSsl: options.databaseSsl,
    sessionDays: options.sessionDays,
  });
  const allowedOrigins = options.allowedOrigins ?? ["http://localhost:5173"];

  await billingService.initialize();
  await authService.initialize();
  app.addHook("onClose", async () => {
    await Promise.all([billingService.close(), authService.close()]);
  });

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
    version: "0.3.0",
    billingStorage: billingService.storage,
    accountStorage: authService.storage,
  }));

  app.get("/api/v1/plans", async () => ({
    plans: {
      start: planEntitlements.start,
      presenca: planEntitlements.presenca,
      pro: planEntitlements.pro,
      business: planEntitlements.business,
    },
  }));

  app.post(
    "/api/v1/auth/register",
    { config: { rateLimit: { max: 8, timeWindow: "15 minutes" } } },
    async (request, reply) => {
      const input = RegisterRequestSchema.parse(request.body);
      const session = await authService.register(input);
      await billingService.createOrUpdateDemoSubscription(session.organization.id, "trial");
      return reply.code(201).send(session);
    },
  );

  app.post(
    "/api/v1/auth/login",
    { config: { rateLimit: { max: 12, timeWindow: "15 minutes" } } },
    async (request) => authService.login(LoginRequestSchema.parse(request.body)),
  );

  app.get("/api/v1/auth/me", async (request) => {
    return authService.authenticate(bearerToken(request));
  });

  app.post("/api/v1/auth/logout", async (request, reply) => {
    await authService.logout(bearerToken(request));
    return reply.code(204).send();
  });

  app.get("/api/v1/dashboard", async (request) => {
    const context = await authService.authenticate(bearerToken(request));
    const [usage, brands] = await Promise.all([
      billingService.getUsage(context.organization.id),
      authService.listBrands(context.organization.id),
    ]);
    return { ...context, usage, brands };
  });

  app.get("/api/v1/brands", async (request) => {
    const context = await authService.authenticate(bearerToken(request));
    return { brands: await authService.listBrands(context.organization.id) };
  });

  app.post("/api/v1/brands", async (request, reply) => {
    const context = await authService.authenticate(bearerToken(request));
    const input = BrandCreateRequestSchema.parse(request.body);
    if (input.websiteUrl) assertPublicHttpUrl(input.websiteUrl);
    const [brands, usage] = await Promise.all([
      authService.listBrands(context.organization.id),
      billingService.getUsage(context.organization.id),
    ]);
    if (brands.length >= usage.entitlements.maxBrands) {
      throw new BillingError(
        "BRAND_LIMIT_REACHED",
        409,
        "O limite de marcas do seu plano foi atingido.",
      );
    }
    const brand = await authService.createBrand(context.organization.id, input);
    return reply.code(201).send(brand);
  });

  app.post(
    "/api/v1/content/consume",
    { config: { rateLimit: { max: 40, timeWindow: "1 minute" } } },
    async (request) => {
      const context = await authService.authenticate(bearerToken(request));
      const input = CreditConsumeRequestSchema.parse(request.body);
      return billingService.consume(context.organization.id, input);
    },
  );

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

  if (options.enableDemoBilling) {
    app.post("/api/v1/billing/demo/subscriptions", async (request, reply) => {
      const input = DemoSubscriptionCreateRequestSchema.parse(request.body);
      const usage = await billingService.createOrUpdateDemoSubscription(input.accountId, input.plan);
      return reply.code(201).send(usage);
    });

    app.get("/api/v1/billing/accounts/:accountId/usage", async (request) => {
      const accountId = BillingAccountIdSchema.parse(
        (request.params as { accountId: string }).accountId,
      );
      return billingService.getUsage(accountId);
    });

    app.post("/api/v1/billing/accounts/:accountId/consume", async (request) => {
      const accountId = BillingAccountIdSchema.parse(
        (request.params as { accountId: string }).accountId,
      );
      return billingService.consume(accountId, CreditConsumeRequestSchema.parse(request.body));
    });
  }

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof BillingError || error instanceof AuthError) {
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
