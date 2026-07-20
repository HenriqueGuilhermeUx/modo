import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import { BrandCreateRequestSchema, DiagnosticCreateRequestSchema, LeadCreateRequestSchema, LoginRequestSchema, RegisterRequestSchema, contentCreditCost, planEntitlements } from "@modo/contracts";
import { ContentRequestCreateSchema } from "@modo/contracts/content";
import { WooviCheckoutRequestSchema } from "@modo/contracts/payment";
import Fastify, { type FastifyRequest } from "fastify";
import { randomUUID } from "node:crypto";
import type { DiagnosticProvider } from "./providers/diagnostic-provider.js";
import { assertPublicHttpUrl } from "./security/public-url.js";
import { AuthError, AuthService } from "./services/auth-service.js";
import { BillingError, BillingService } from "./services/billing-service.js";
import { ContentService } from "./services/content-service.js";
import { DiagnosticService } from "./services/diagnostic-service.js";
import { LeadService } from "./services/lead-service.js";
import { PaymentError, PaymentService } from "./services/payment-service.js";

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
}

function bearerToken(request: FastifyRequest) {
  const value = request.headers.authorization;
  if (!value?.startsWith("Bearer ")) {
    throw new AuthError("UNAUTHORIZED", 401, "Faça login para continuar.");
  }
  return value.slice(7).trim();
}

export async function createApp(options: CreateAppOptions) {
  const app = Fastify({ logger: options.logger ?? false });
  const diagnostics = new DiagnosticService(options.provider);
  const leads = new LeadService();
  const billing = new BillingService({ databaseUrl: options.databaseUrl, databaseSsl: options.databaseSsl });
  const auth = new AuthService({ databaseUrl: options.databaseUrl, databaseSsl: options.databaseSsl, sessionDays: options.sessionDays });
  const content = new ContentService({ databaseUrl: options.databaseUrl, databaseSsl: options.databaseSsl });
  const payments = new PaymentService({
    appId: options.paymentsProvider === "woovi" ? options.wooviAppId : undefined,
    webhookAuthorization: options.paymentsProvider === "woovi" ? options.wooviWebhookAuthorization : undefined,
    databaseUrl: options.databaseUrl,
    databaseSsl: options.databaseSsl,
  });

  await billing.initialize();
  await auth.initialize();
  await content.initialize();
  await payments.initialize();
  app.addHook("onClose", async () => {
    await Promise.all([billing.close(), auth.close(), content.close(), payments.close()]);
  });

  const allowed = options.allowedOrigins ?? ["http://localhost:5173"];
  await app.register(helmet, { contentSecurityPolicy: false });
  await app.register(cors, {
    origin(origin, callback) {
      if (!origin || allowed.includes("*") || allowed.includes(origin)) return callback(null, true);
      callback(new Error("Origem não permitida."), false);
    },
  });
  await app.register(rateLimit, { max: 80, timeWindow: "1 minute" });

  app.get("/health", async () => ({
    status: "ok",
    service: "modo-api",
    version: "0.5.0",
    billingStorage: billing.storage,
    accountStorage: auth.storage,
    contentStorage: content.storage,
    paymentsProvider: payments.enabled ? "woovi" : "disabled",
  }));

  app.get("/api/v1/plans", async () => ({ plans: {
    start: planEntitlements.start,
    presenca: planEntitlements.presenca,
    pro: planEntitlements.pro,
    business: planEntitlements.business,
  } }));

  app.post("/api/v1/auth/register", { config: { rateLimit: { max: 8, timeWindow: "15 minutes" } } }, async (request, reply) => {
    const session = await auth.register(RegisterRequestSchema.parse(request.body));
    await billing.createOrUpdateDemoSubscription(session.organization.id, "trial");
    return reply.code(201).send(session);
  });
  app.post("/api/v1/auth/login", { config: { rateLimit: { max: 12, timeWindow: "15 minutes" } } }, async (request) => auth.login(LoginRequestSchema.parse(request.body)));
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
      throw new BillingError("BRAND_LIMIT_REACHED", 409, "O limite de marcas do seu plano foi atingido.");
    }
    return reply.code(201).send(await auth.createBrand(context.organization.id, input));
  });

  app.get("/api/v1/content-requests", async (request) => {
    const context = await auth.authenticate(bearerToken(request));
    return { requests: await content.list(context.organization.id) };
  });
  app.post("/api/v1/content-requests", { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } }, async (request, reply) => {
    const context = await auth.authenticate(bearerToken(request));
    const input = ContentRequestCreateSchema.parse(request.body);
    const brands = await auth.listBrands(context.organization.id);
    if (!brands.some((brand) => brand.id === input.brandId)) {
      throw new AuthError("BRAND_NOT_FOUND", 404, "Marca não encontrada nesta organização.");
    }
    const id = randomUUID();
    const credits = contentCreditCost[input.contentType];
    const usage = await billing.consume(context.organization.id, {
      contentType: input.contentType,
      referenceId: `content_request:${id}`,
      metadata: { brandId: input.brandId, objective: input.objective, channel: input.channel },
    });
    const created = await content.create(id, context.organization.id, input, credits);
    return reply.code(201).send({ request: created, usage });
  });

  app.post("/api/v1/payments/checkout", { config: { rateLimit: { max: 6, timeWindow: "15 minutes" } } }, async (request, reply) => {
    const context = await auth.authenticate(bearerToken(request));
    const input = WooviCheckoutRequestSchema.parse(request.body);
    if (input.customer.email.toLowerCase() !== context.user.email.toLowerCase()) {
      throw new PaymentError("PAYER_EMAIL_MISMATCH", 400, "Use o mesmo e-mail da sua conta MODO.");
    }
    return reply.code(201).send(await payments.createCheckout(context.organization.id, input));
  });

  app.post("/api/v1/payments/woovi/webhook", async (request, reply) => {
    const authorization = String(
      request.headers["x-openpix-authorization"] || request.headers.authorization || "",
    );
    payments.validateWebhookAuthorization(authorization);
    const activation = await payments.processWebhook(request.body as Record<string, unknown>);
    if (activation) {
      await billing.createOrUpdateDemoSubscription(activation.accountId, activation.plan);
      request.log.info({ accountId: activation.accountId, plan: activation.plan }, "Plano MODO ativado via Woovi");
    }
    return reply.code(202).send({ received: true, activated: Boolean(activation) });
  });

  app.post("/api/v1/diagnostics", { config: { rateLimit: { max: 8, timeWindow: "10 minutes" } } }, async (request, reply) => {
    const input = DiagnosticCreateRequestSchema.parse(request.body);
    assertPublicHttpUrl(input.websiteUrl);
    const job = diagnostics.create(input);
    return reply.code(202).send({ id: job.id, status: job.status, pollUrl: `/api/v1/diagnostics/${job.id}` });
  });
  app.get("/api/v1/diagnostics/:id", async (request, reply) => {
    const job = diagnostics.get((request.params as { id: string }).id);
    return job ?? reply.code(404).send({ code: "DIAGNOSTIC_NOT_FOUND", message: "Diagnóstico não encontrado." });
  });
  app.post("/api/v1/leads", { config: { rateLimit: { max: 10, timeWindow: "10 minutes" } } }, async (request, reply) => {
    const input = LeadCreateRequestSchema.parse(request.body);
    if (!diagnostics.get(input.diagnosticId)) {
      return reply.code(404).send({ code: "DIAGNOSTIC_NOT_FOUND", message: "Diagnóstico não encontrado." });
    }
    const lead = leads.create(input);
    request.log.info({ leadId: lead.id }, "Lead capturado");
    return reply.code(201).send({ id: lead.id, status: "captured" });
  });

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof BillingError || error instanceof AuthError || error instanceof PaymentError) {
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

  return app;
}
