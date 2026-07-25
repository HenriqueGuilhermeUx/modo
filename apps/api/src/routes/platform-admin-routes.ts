import {
  AdminCreditAdjustmentSchema,
  AdminDiscountCampaignCreateSchema,
  AdminInvitationCreateSchema,
  AdminLoginRequestSchema,
  AdminSubscriptionUpdateSchema,
  InvitationAcceptRequestSchema,
} from "@modo/contracts/admin";
import type { IntelligenceProvider } from "@modo/contracts/intelligence";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import type { AuthService } from "../services/auth-service.js";
import type { BillingService } from "../services/billing-service.js";
import { AdminCreditService } from "../services/admin-credit-service.js";
import { IntelligenceService } from "../services/intelligence-service.js";
import {
  PlatformAdminError,
  type PlatformAdminService,
} from "../services/platform-admin-service.js";
import { registerIntelligenceRoutes } from "./intelligence-routes.js";
import { registerSmartBotsRoutes } from "./smartbots-routes.js";

interface Options {
  auth: AuthService;
  billing: BillingService;
  admin: PlatformAdminService;
  databaseUrl?: string;
  databaseSsl?: boolean;
}

function bearer(request: FastifyRequest) {
  const value = request.headers.authorization;
  if (!value?.startsWith("Bearer ")) {
    throw new PlatformAdminError("ADMIN_UNAUTHORIZED", 401, "Acesso administrativo não autorizado.");
  }
  return value.slice(7).trim();
}

function smartBotsDispatchProvider() {
  const value = String(process.env.SMARTBOTS_DISPATCH_PROVIDER || "queue").trim();
  return value === "direct" || value === "n8n" ? value : "queue";
}

function intelligenceProvider(): IntelligenceProvider {
  const value = String(process.env.INTELLIGENCE_PROVIDER || "queue").trim();
  return value === "apify" || value === "n8n" ? value : "queue";
}

export async function registerPlatformAdminRoutes(
  app: FastifyInstance,
  options: Options,
) {
  const credits = new AdminCreditService({
    databaseUrl: options.databaseUrl,
    databaseSsl: options.databaseSsl,
  });
  const intelligence = new IntelligenceService({
    databaseUrl: options.databaseUrl,
    databaseSsl: options.databaseSsl,
    provider: intelligenceProvider(),
    apifyBaseUrl: process.env.APIFY_API_BASE_URL,
    apifyToken: process.env.APIFY_API_TOKEN,
    n8nWebhookUrl: process.env.N8N_INTELLIGENCE_WEBHOOK_URL,
    n8nSecret: process.env.N8N_INTELLIGENCE_SECRET,
    publicApiUrl: process.env.PUBLIC_API_URL,
    callbackSecret: process.env.INTELLIGENCE_CALLBACK_SECRET,
    requestTimeoutMs: Number(process.env.INTELLIGENCE_REQUEST_TIMEOUT_MS || 30000),
    taskIds: {
      market_radar: process.env.APIFY_MARKET_RADAR_TASK_ID,
      b2b_prospecting: process.env.APIFY_B2B_PROSPECTING_TASK_ID,
      price_monitoring: process.env.APIFY_PRICE_MONITORING_TASK_ID,
    },
  });
  await intelligence.initialize();
  app.addHook("onClose", async () => {
    await Promise.all([credits.close(), intelligence.close()]);
  });

  await registerIntelligenceRoutes(app, options.auth, intelligence);
  await registerSmartBotsRoutes(app, {
    auth: options.auth,
    billing: options.billing,
    admin: options.admin,
    databaseUrl: options.databaseUrl,
    databaseSsl: options.databaseSsl,
    dispatchProvider: smartBotsDispatchProvider(),
    partnerEndpoint: process.env.SMARTBOTS_PARTNER_ENDPOINT,
    partnerApiKey: process.env.SMARTBOTS_PARTNER_API_KEY,
    n8nWebhookUrl: process.env.N8N_SMARTBOTS_WEBHOOK_URL,
    n8nSecret: process.env.N8N_SMARTBOTS_SECRET,
    requestTimeoutMs: Number(process.env.SMARTBOTS_REQUEST_TIMEOUT_MS || 15000),
  });

  app.post(
    "/api/v1/admin/login",
    { config: { rateLimit: { max: 6, timeWindow: "15 minutes" } } },
    async (request) => {
      const input = AdminLoginRequestSchema.parse(request.body);
      return options.admin.login(input.email, input.password);
    },
  );

  app.get("/api/v1/admin/me", async (request) => ({
    admin: await options.admin.authenticate(bearer(request)),
  }));

  app.post("/api/v1/admin/logout", async (request, reply) => {
    await options.admin.logout(bearer(request));
    return reply.code(204).send();
  });

  app.get("/api/v1/admin/overview", async (request) => {
    await options.admin.authenticate(bearer(request));
    return options.admin.overview();
  });

  app.get("/api/v1/admin/organizations", async (request) => {
    await options.admin.authenticate(bearer(request));
    return { organizations: await options.admin.listOrganizations() };
  });

  app.post("/api/v1/admin/organizations/:id/credits", async (request) => {
    await options.admin.authenticate(bearer(request));
    const accountId = z.string().min(3).parse((request.params as { id: string }).id);
    const input = AdminCreditAdjustmentSchema.parse(request.body);
    const result = await credits.adjust(accountId, input.credits, input.reason);
    await options.admin.audit("credits.adjusted", "organization", accountId, input);
    return { ...result, usage: await options.billing.getUsage(accountId) };
  });

  app.patch("/api/v1/admin/organizations/:id/subscription", async (request) => {
    await options.admin.authenticate(bearer(request));
    const accountId = z.string().min(3).parse((request.params as { id: string }).id);
    const input = AdminSubscriptionUpdateSchema.parse(request.body);
    let usage = input.plan
      ? await options.billing.createOrUpdateDemoSubscription(accountId, input.plan)
      : await options.billing.getUsage(accountId);
    if (input.status) usage = await options.billing.setStatus(accountId, input.status);
    await options.admin.audit("subscription.updated", "organization", accountId, input);
    return { usage };
  });

  app.get("/api/v1/admin/invitations", async (request) => {
    await options.admin.authenticate(bearer(request));
    return { invitations: await options.admin.listInvitations() };
  });

  app.post("/api/v1/admin/invitations", async (request, reply) => {
    await options.admin.authenticate(bearer(request));
    const input = AdminInvitationCreateSchema.parse(request.body);
    return reply.code(201).send(await options.admin.createInvitation(input));
  });

  app.post("/api/v1/admin/invitations/:id/revoke", async (request) => {
    await options.admin.authenticate(bearer(request));
    const id = z.string().uuid().parse((request.params as { id: string }).id);
    return options.admin.revokeInvitation(id);
  });

  app.get("/api/v1/admin/discounts", async (request) => {
    await options.admin.authenticate(bearer(request));
    return { campaigns: await options.admin.listCampaigns() };
  });

  app.post("/api/v1/admin/discounts", async (request, reply) => {
    await options.admin.authenticate(bearer(request));
    const input = AdminDiscountCampaignCreateSchema.parse(request.body);
    return reply.code(201).send(await options.admin.createCampaign(input));
  });

  app.patch("/api/v1/admin/discounts/:id", async (request) => {
    await options.admin.authenticate(bearer(request));
    const id = z.string().uuid().parse((request.params as { id: string }).id);
    const active = z.object({ active: z.boolean() }).parse(request.body).active;
    return options.admin.setCampaignActive(id, active);
  });

  app.get("/api/v1/invitations/:token", async (request) => {
    const token = z.string().min(20).parse((request.params as { token: string }).token);
    return options.admin.previewInvitation(token);
  });

  app.post(
    "/api/v1/invitations/:token/accept",
    { config: { rateLimit: { max: 5, timeWindow: "30 minutes" } } },
    async (request, reply) => {
      const token = z.string().min(20).parse((request.params as { token: string }).token);
      const invitation = await options.admin.previewInvitation(token);
      const input = InvitationAcceptRequestSchema.parse(request.body);
      const session = await options.auth.register({
        name: input.name,
        email: invitation.email,
        password: input.password,
        organizationName: input.organizationName,
      });
      await options.billing.createOrUpdateDemoSubscription(
        session.organization.id,
        invitation.plan,
      );
      if (invitation.bonusCredits > 0) {
        await credits.adjust(
          session.organization.id,
          invitation.bonusCredits,
          "Bônus de convite administrativo",
        );
      }
      await options.admin.consumeInvitation(
        token,
        session.user.id,
        session.organization.id,
      );
      return reply.code(201).send(session);
    },
  );
}
