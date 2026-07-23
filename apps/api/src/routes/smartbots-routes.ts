import {
  SmartBotsIntakePayloadSchema,
  SmartBotsIntakeStatusSchema,
} from "@modo/contracts/smartbots";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { AuthError, type AuthService } from "../services/auth-service.js";
import { BillingError, type BillingService } from "../services/billing-service.js";
import type { PlatformAdminService } from "../services/platform-admin-service.js";
import { SmartBotsService } from "../services/smartbots-service.js";

interface Options {
  auth: AuthService;
  billing: BillingService;
  admin: PlatformAdminService;
  databaseUrl?: string;
  databaseSsl?: boolean;
  partnerEndpoint?: string;
}

function customerBearer(request: FastifyRequest) {
  const value = request.headers.authorization;
  if (!value?.startsWith("Bearer ")) {
    throw new AuthError("UNAUTHORIZED", 401, "Faça login para continuar.");
  }
  return value.slice(7).trim();
}

function adminBearer(request: FastifyRequest) {
  const value = request.headers.authorization;
  if (!value?.startsWith("Bearer ")) {
    throw new AuthError("ADMIN_UNAUTHORIZED", 401, "Acesso administrativo não autorizado.");
  }
  return value.slice(7).trim();
}

function isEligible(plan: string, status: string) {
  return ["presenca", "pro", "business"].includes(plan) && ["active", "retrying"].includes(status);
}

export async function registerSmartBotsRoutes(app: FastifyInstance, options: Options) {
  const service = new SmartBotsService({
    databaseUrl: options.databaseUrl,
    databaseSsl: options.databaseSsl,
    partnerEndpoint: options.partnerEndpoint,
  });
  await service.initialize();
  app.addHook("onClose", async () => service.close());

  app.get("/api/v1/smartbots/intake", async (request) => {
    const context = await options.auth.authenticate(customerBearer(request));
    const usage = await options.billing.getUsage(context.organization.id);
    return {
      eligible: isEligible(usage.plan, usage.status),
      requiredPlan: "presenca",
      intake: await service.getForOrganization(context.organization.id),
    };
  });

  app.post(
    "/api/v1/smartbots/intake",
    { config: { rateLimit: { max: 8, timeWindow: "30 minutes" } } },
    async (request, reply) => {
      const context = await options.auth.authenticate(customerBearer(request));
      const usage = await options.billing.getUsage(context.organization.id);
      if (!isEligible(usage.plan, usage.status)) {
        throw new BillingError(
          "SMARTBOTS_REQUIRES_PRESENCA",
          403,
          "O SmartBots Assistido está incluído a partir do plano MODO Presença.",
        );
      }
      const payload = SmartBotsIntakePayloadSchema.parse({
        ...(request.body as Record<string, unknown>),
        partner: "modo",
        plan: "presenca",
      });
      const intake = await service.submit(
        context.organization.id,
        context.user.id,
        payload,
      );
      return reply.code(201).send(intake);
    },
  );

  app.get("/api/v1/admin/smartbots-intakes", async (request) => {
    await options.admin.authenticate(adminBearer(request));
    return { intakes: await service.listAll() };
  });

  app.patch("/api/v1/admin/smartbots-intakes/:id/status", async (request) => {
    await options.admin.authenticate(adminBearer(request));
    const id = z.string().uuid().parse((request.params as { id: string }).id);
    const input = z.object({
      status: SmartBotsIntakeStatusSchema,
      providerMessage: z.string().trim().max(1000).optional().default(""),
    }).parse(request.body);
    const updated = await service.updateStatus(id, input.status, input.providerMessage);
    await options.admin.audit("smartbots.status_updated", "smartbots_intake", id, input);
    return updated;
  });
}
