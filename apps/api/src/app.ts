import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import {
  BrandCreateRequestSchema,
  DiagnosticCreateRequestSchema,
  LeadCreateRequestSchema,
  LoginRequestSchema,
  RegisterRequestSchema,
  contentCreditCost,
  planEntitlements,
} from "@modo/contracts";
import {
  ContentGenerationCallbackSchema,
  ContentRequestCreateSchema,
  ContentRevisionRequestSchema,
} from "@modo/contracts/content";
import { WooviCheckoutRequestSchema } from "@modo/contracts/payment";
import Fastify, { type FastifyRequest } from "fastify";
import { randomUUID } from "node:crypto";
import type { DiagnosticProvider } from "./providers/diagnostic-provider.js";
import { registerCreativeIntelligenceRoutes } from "./routes/creative-intelligence-routes.js";
import { registerPlatformAdminRoutes } from "./routes/platform-admin-routes.js";
import { registerSourceRoutes } from "./routes/source-routes.js";
import { registerStudioRoutes } from "./routes/studio-routes.js";
import { assertPublicHttpUrl } from "./security/public-url.js";
import { AuthError, AuthService } from "./services/auth-service.js";
import { BillingError, BillingService } from "./services/billing-service.js";
import {
  ContentAutomationError,
  ContentAutomationService,
} from "./services/content-automation-service.js";
import { ContentError, ContentService } from "./services/content-service.js";
import { CreativeIntelligenceError } from "./services/creative-intelligence-service.js";
import { DiagnosticService } from "./services/diagnostic-service.js";
import { LeadService } from "./services/lead-service.js";
import { PaymentError, PaymentService } from "./services/payment-service.js";
import { PlatformAdminError, PlatformAdminService } from "./services/platform-admin-service.js";

export interface CreateAppOptions {
  provider: DiagnosticProvider;
  allowedOrigins?: string[];
  logger?: boolean;
  databaseUrl?: string;
  databaseSsl?: boolean;
  sessionDays?: number;
  enableDemoBilling?: boolean;
  paymentsProvider?: "disabled" | "woovi";
  wooviAppId?: string;
  wooviWebhookAuthorization?: string;
  contentProvider?: "demo" | "n8n";
  contentWebhookUrl?: string;
  contentSecret?: string;
  publicApiUrl?: string;
  contentDemoDelayMs?: number;
}

function bearerToken(request: FastifyRequest) {
  const value = request.headers.authorization;
  if (!value?.startsWith("Bearer ")) {
    throw new AuthError("UNAUTHORIZED", 401, "Faça login para continuar.");
  }
  return value.slice(7).trim();
}

function callbackSecret(request: FastifyRequest) {
  return String(
    request.headers["x-modo-content-secret"] || request.headers.authorization || "",
  ).replace(/^Bearer\s+/i, "");
}

export async function createApp(options: CreateAppOptions) {
  const app = Fastify({ logger: options.logger ?? false });
  const diagnostics = new DiagnosticService(options.provider);
  const leads = new LeadService();
  const billing = new BillingService({
    databaseUrl: options.databaseUrl,
    databaseSsl: options.databaseSsl,
  });
  const auth = new AuthService({
    databaseUrl: options.databaseUrl,
    databaseSsl: options.databaseSsl,
    sessionDays: options.sessionDays,
  });
  const content = new ContentService({
    databaseUrl: options.databaseUrl,
    databaseSsl: options.databaseSsl,
  });
  const admin = new PlatformAdminService({
    databaseUrl: options.databaseUrl,
    databaseSsl: options.databaseSsl,
    email: process.env.PLATFORM_ADMIN_EMAIL,
    password: process.env.PLATFORM_ADMIN_PASSWORD,
    name: process.env.PLATFORM_ADMIN_NAME,
    sessionHours: Number(process.env.PLATFORM_ADMIN_SESSION_HOURS || 12),
    publicWebUrl: process.env.PUBLIC_WEB_URL,
  });
  const automation = new ContentAutomationService({
    provider: options.contentProvider,
    webhookUrl: options.contentWebhookUrl,
    secret: options.contentSecret,
    publicApiUrl: options.publicApiUrl,
    demoDelayMs: options.contentDemoDelayMs,
    content,
  });
  const payments = new PaymentService({
    appId: options.paymentsProvider === "woovi" ? options.wooviAppId : undefined,
    webhookAuthorization:
      options.paymentsProvider === "woovi" ? options.wooviWebhookAuthorization : undefined,
    databaseUrl: options.databaseUrl,
    databaseSsl: options.databaseSsl,
    discounts: admin,
  });

  await billing.initialize();
  await auth.initialize();
  await content.initialize();
  await payments.initialize();
  await admin.initialize();
  app.addHook("onClose", async () => {
    await Promise.all([billing.close(), auth.close(), content.close(), payments.close(), admin.close()]);
  });

  const allowed = options.allowedOrigins ?? ["http://localhost:5173"];
  await app.register(helmet, { contentSecurityPolicy: false });
  await app.register(cors, {
    origin(origin, callback) {
      if (!origin || allowed.includes("*") || allowed.includes(origin)) {
        return callback(null, true);
      }
      callback(new Error("Origem não permitida."), false);
    },
  });
  await app.register(rateLimit, { max: 80, timeWindow: "1 minute" });
  await registerCreativeIntelligenceRoutes(app, {
    auth,
    databaseUrl: options.databaseUrl,
    databaseSsl: options.databaseSsl,
  });
  await registerPlatformAdminRoutes(app, {
    auth,
    billing,
    admin,
    databaseUrl: options.databaseUrl,
    databaseSsl: options.databaseSsl,
  });
  await registerSourceRoutes(app, auth);
  await registerStudioRoutes(app, {
    auth,
    content,
    databaseUrl: options.databaseUrl,
    databaseSsl: options.databaseSsl,
  });

  app.get("/health", async () => ({
    status: "ok",
    service: "modo-api",
    version: "0.12.0",
    billingStorage: billing.storage,
    accountStorage: auth.storage,
    contentStorage: content.storage,
    contentProvider: automation.mode,
    creativeIntelligence: "enabled",
    quickStart: "enabled",
    studio: "enabled",
    weeklyAgenda: "enabled",
    platformAdmin: admin.enabled ? "enabled" : "disabled",
    paymentsProvider: payments.enabled ? "woovi" : "disabled",
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
      const session = await auth.register(RegisterRequestSchema.parse(request.body));
      await billing.createOrUpdateDemoSubscription(session.organization.id, "trial");
      return reply.code(201).send(session);
    },
  );
  app.post(
    "/api/v1/auth/login",
    { config: { rateLimit: { max: 12, timeWindow: "15 minutes" } } },
    async (request) => auth.login(LoginRequestSchema.parse(request.body)),
  );
  app.get("/api/v1/auth/me", async (request) => auth.authenticate(bearerToken(request)));
  app.post("/api/v1/auth/logout", async (request, reply) => {
    await auth.logout(bearerToken(request));
    return reply.code(204).send();
  });

  app.get("/api/v1/dashboard", async (request) => {
    const context = await auth.authenticate(bearerToken(request));
    const [usage, brands] = await Promise.all([
      billing.getUsage(context.organization.id),
      auth.listBrands(context.organization.id),
    ]);
    return { ...context, usage, brands };
  });

  app.get("/api/v1/brands", async (request) => {
    const context = await auth.authenticate(bearerToken(request));
    return { brands: await auth.listBrands(context.organization.id) };
  });
  app.post("/api/v1/brands", async (request, reply) => {
    const context = await auth.authenticate(bearerToken(request));
    const input = BrandCreateRequestSchema.parse(request.body);
    if (input.websiteUrl) assertPublicHttpUrl(input.websiteUrl);
    const [brands, usage] = await Promise.all([
      auth.listBrands(context.organization.id),
      billing.getUsage(context.organization.id),
    ]);
    if (brands.length >= usage.entitlements.maxBrands) {
      throw new BillingError(
        "BRAND_LIMIT_REACHED",
        409,
        "O limite de marcas do seu plano foi atingido.",
      );
    }
    return reply.code(201).send(await auth.createBrand(context.organization.id, input));
  });

  app.get("/api/v1/content-requests", async (request) => {
    const context = await auth.authenticate(bearerToken(request));
    return { requests: await content.list(context.organization.id) };
  });

  app.get("/api/v1/content-requests/:id", async (request) => {
    const context = await auth.authenticate(bearerToken(request));
    return content.getForOrganization(
      (request.params as { id: string }).id,
      context.organization.id,
    );
  });

  app.post(
    "/api/v1/content-requests",
    { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const context = await auth.authenticate(bearerToken(request));
      const input = ContentRequestCreateSchema.parse(request.body);
      const brands = await auth.listBrands(context.organization.id);
      const brand = brands.find((item) => item.id === input.brandId);
      if (!brand) {
        throw new AuthError("BRAND_NOT_FOUND", 404, "Marca não encontrada nesta organização.");
      }

      const id = randomUUID();
      const credits = contentCreditCost[input.contentType];
      const usage = await billing.consume(context.organization.id, {
        contentType: input.contentType,
        referenceId: `content_request:${id}`,
        metadata: {
          brandId: input.brandId,
          objective: input.objective,
          channel: input.channel,
        },
      });
      const created = await content.create(
        id,
        context.organization.id,
        input,
        credits,
        usage.entitlements.includedRevisionCycles,
      );
      void automation.dispatch(created, brand).catch((error) => {
        request.log.error({ error, contentRequestId: id }, "Falha no disparo de conteúdo");
      });
      return reply.code(201).send({ request: created, usage });
    },
  );

  app.post("/api/v1/content-requests/:id/approve", async (request) => {
    const context = await auth.authenticate(bearerToken(request));
    return content.approve((request.params as { id: string }).id, context.organization.id);
  });

  app.post("/api/v1/content-requests/:id/revisions", async (request, reply) => {
    const context = await auth.authenticate(bearerToken(request));
    const id = (request.params as { id: string }).id;
    const input = ContentRevisionRequestSchema.parse(request.body);
    const revised = await content.requestRevision(id, context.organization.id, input.instructions);
    const brands = await auth.listBrands(context.organization.id);
    const brand = brands.find((item) => item.id === revised.brandId);
    if (!brand) throw new AuthError("BRAND_NOT_FOUND", 404, "Marca não encontrada.");
    void automation.dispatch(revised, brand).catch((error) => {
      request.log.error({ error, contentRequestId: id }, "Falha no disparo da revisão");
    });
    return reply.code(202).send(revised);
  });

  app.post("/api/v1/content-requests/:id/retry", async (request, reply) => {
    const context = await auth.authenticate(bearerToken(request));
    const id = (request.params as { id: string }).id;
    const queued = await content.retry(id, context.organization.id);
    const brands = await auth.listBrands(context.organization.id);
    const brand = brands.find((item) => item.id === queued.brandId);
    if (!brand) throw new AuthError("BRAND_NOT_FOUND", 404, "Marca não encontrada.");
    void automation.dispatch(queued, brand).catch((error) => {
      request.log.error({ error, contentRequestId: id }, "Falha no reenvio de conteúdo");
    });
    return reply.code(202).send(queued);
  });

  app.post(
    "/api/v1/internal/content-requests/:id/result",
    { config: { rateLimit: { max: 120, timeWindow: "1 minute" } } },
    async (request, reply) => {
      automation.validateCallbackSecret(callbackSecret(request));
      const id = (request.params as { id: string }).id;
      const callback = ContentGenerationCallbackSchema.parse(request.body);
      if (callback.status === "completed") {
        await content.complete(id, callback.output, callback.providerRunId);
      } else {
        await content.fail(id, callback.error, callback.providerRunId);
      }
      return reply.code(200).send({ received: true });
    },
  );

  app.post(
    "/api/v1/payments/checkout",
    { config: { rateLimit: { max: 6, timeWindow: "15 minutes" } } },
    async (request, reply) => {
      const context = await auth.authenticate(bearerToken(request));
      const input = WooviCheckoutRequestSchema.parse(request.body);
      if (input.customer.email.toLowerCase() !== context.user.email.toLowerCase()) {
        throw new PaymentError(
          "PAYER_EMAIL_MISMATCH",
          400,
          "Use o mesmo e-mail da sua conta MODO.",
        );
      }
      return reply
        .code(201)
        .send(await payments.createCheckout(context.organization.id, input));
    },
  );

  app.post("/api/v1/payments/cancel", async (request) => {
    const context = await auth.authenticate(bearerToken(request));
    const result = await payments.cancelLatest(context.organization.id);
    const usage = await billing.setStatus(context.organization.id, "canceled");
    return { ...result, usage };
  });

  app.post("/api/v1/payments/woovi/webhook", async (request, reply) => {
    const body = request.body as Record<string, unknown>;
    const isRegistrationTest = Boolean(
      body.event &&
        body.data_criacao &&
        !body.globalID &&
        !body.paymentSubscriptionGlobalID,
    );

    if (isRegistrationTest) return reply.code(200).send();

    const authorization = String(
      request.headers["x-openpix-authorization"] || request.headers.authorization || "",
    );
    payments.validateWebhookAuthorization(authorization);
    const lifecycle = await payments.processWebhook(body);

    try {
      if (lifecycle?.action === "paid") {
        await billing.applyPaidCycle(lifecycle.accountId, lifecycle.plan, lifecycle.eventKey);
      } else if (lifecycle?.action === "retrying") {
        await billing.setStatus(lifecycle.accountId, "retrying");
      } else if (lifecycle?.action === "suspend") {
        await billing.setStatus(lifecycle.accountId, "suspended");
      } else if (lifecycle?.action === "cancel") {
        await billing.setStatus(lifecycle.accountId, "canceled");
      }
    } catch (error) {
      if (lifecycle) await payments.releaseEvent(lifecycle.eventKey);
      throw error;
    }

    if (lifecycle) {
      request.log.info(
        {
          accountId: lifecycle.accountId,
          plan: lifecycle.plan,
          action: lifecycle.action,
        },
        "Ciclo de assinatura MODO atualizado via Woovi",
      );
    }
    return reply.code(200).send();
  });

  app.post(
    "/api/v1/diagnostics",
    { config: { rateLimit: { max: 8, timeWindow: "10 minutes" } } },
    async (request, reply) => {
      const input = DiagnosticCreateRequestSchema.parse(request.body);
      assertPublicHttpUrl(input.websiteUrl);
      const job = diagnostics.create(input);
      return reply.code(202).send({
        id: job.id,
        status: job.status,
        pollUrl: `/api/v1/diagnostics/${job.id}`,
      });
    },
  );
  app.get("/api/v1/diagnostics/:id", async (request, reply) => {
    const job = diagnostics.get((request.params as { id: string }).id);
    return (
      job ??
      reply.code(404).send({
        code: "DIAGNOSTIC_NOT_FOUND",
        message: "Diagnóstico não encontrado.",
      })
    );
  });
  app.post(
    "/api/v1/leads",
    { config: { rateLimit: { max: 10, timeWindow: "10 minutes" } } },
    async (request, reply) => {
      const input = LeadCreateRequestSchema.parse(request.body);
      if (!diagnostics.get(input.diagnosticId)) {
        return reply.code(404).send({
          code: "DIAGNOSTIC_NOT_FOUND",
          message: "Diagnóstico não encontrado.",
        });
      }
      const lead = leads.create(input);
      request.log.info({ leadId: lead.id }, "Lead capturado");
      return reply.code(201).send({ id: lead.id, status: "captured" });
    },
  );

  app.setErrorHandler((error, _request, reply) => {
    if (
      error instanceof BillingError ||
      error instanceof AuthError ||
      error instanceof PaymentError ||
      error instanceof ContentError ||
      error instanceof ContentAutomationError ||
      error instanceof CreativeIntelligenceError
    ) {
      return reply.code(error.statusCode).send({ code: error.code, message: error.message });
    }
    const message = error instanceof Error ? error.message : "Ocorreu um erro inesperado.";
    const name = error instanceof Error ? error.name : "UnknownError";
    const validation =
      name === "ZodError" || message.includes("URL") || message.includes("Endereços");
    return reply.code(validation ? 400 : 500).send({
      code: validation ? "INVALID_REQUEST" : "INTERNAL_ERROR",
      message: validation ? message : "Ocorreu um erro inesperado.",
    });
  });

  return app;
}
