import {
  IntelligenceCallbackSchema,
  IntelligenceMissionCreateSchema,
  intelligencePlaybookCatalog,
} from "@modo/contracts/intelligence";
import { randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { AuthError, type AuthService } from "../services/auth-service.js";
import {
  IntelligenceLeadError,
  IntelligenceLeadService,
} from "../services/intelligence-lead-service.js";
import {
  IntelligenceQuotaError,
  IntelligenceQuotaService,
} from "../services/intelligence-quota-service.js";
import { IntelligenceError, type IntelligenceService } from "../services/intelligence-service.js";

const LeadStatusSchema = z.enum([
  "new",
  "qualified",
  "contacted",
  "negotiating",
  "won",
  "lost",
  "archived",
]);
const LeadPrioritySchema = z.enum(["low", "medium", "high"]);
const LeadUpdateSchema = z
  .object({
    status: LeadStatusSchema.optional(),
    priority: LeadPrioritySchema.optional(),
    notes: z.string().trim().max(2000).optional(),
  })
  .refine(
    (value) => value.status !== undefined || value.priority !== undefined || value.notes !== undefined,
    "Informe ao menos uma alteração para o lead.",
  );

function bearerToken(request: FastifyRequest) {
  const value = request.headers.authorization;
  if (!value?.startsWith("Bearer ")) {
    throw new AuthError("UNAUTHORIZED", 401, "Faça login para continuar.");
  }
  return value.slice(7).trim();
}

function callbackSecret(request: FastifyRequest) {
  return String(
    request.headers["x-modo-intelligence-secret"] || request.headers.authorization || "",
  ).replace(/^Bearer\s+/i, "");
}

async function execute<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (
      error instanceof IntelligenceError ||
      error instanceof IntelligenceQuotaError ||
      error instanceof IntelligenceLeadError
    ) {
      throw new AuthError(error.code, error.statusCode, error.message);
    }
    throw error;
  }
}

function databaseSsl() {
  return ["1", "true", "yes", "on"].includes(
    String(process.env.DATABASE_SSL || "").trim().toLowerCase(),
  );
}

export async function registerIntelligenceRoutes(
  app: FastifyInstance,
  auth: AuthService,
  intelligence: IntelligenceService,
) {
  const storageOptions = {
    databaseUrl: process.env.DATABASE_URL,
    databaseSsl: databaseSsl(),
  };
  const quota = new IntelligenceQuotaService(storageOptions);
  const leads = new IntelligenceLeadService(storageOptions);
  await Promise.all([quota.initialize(), leads.initialize()]);
  app.addHook("onClose", async () => {
    await Promise.all([quota.close(), leads.close()]);
  });

  app.get("/api/v1/intelligence/playbooks", async (request) => {
    const context = await auth.authenticate(bearerToken(request));
    return {
      provider: intelligence.mode,
      configured: intelligence.configuredPlaybooks(),
      playbooks: intelligencePlaybookCatalog,
      quota: await execute(() => quota.usage(context.organization.id)),
    };
  });

  app.get("/api/v1/intelligence/missions", async (request) => {
    const context = await auth.authenticate(bearerToken(request));
    return { missions: await execute(() => intelligence.list(context.organization.id)) };
  });

  app.post(
    "/api/v1/intelligence/missions",
    { config: { rateLimit: { max: 6, timeWindow: "30 minutes" } } },
    async (request, reply) => {
      const context = await auth.authenticate(bearerToken(request));
      const input = IntelligenceMissionCreateSchema.parse(request.body);
      const brands = await auth.listBrands(context.organization.id);
      const brand = brands.find((item) => item.id === input.brandId);
      if (!brand) {
        throw new AuthError(
          "INTELLIGENCE_BRAND_NOT_FOUND",
          404,
          "Marca não encontrada nesta organização.",
        );
      }

      const reservationId = `create:${randomUUID()}`;
      await execute(() => quota.reserve(
        context.organization.id,
        input.maxItems,
        reservationId,
      ));

      try {
        const mission = await execute(() => intelligence.create(
          context.organization.id,
          context.user.id,
          input,
          {
            id: brand.id,
            name: brand.name,
            niche: brand.niche,
            websiteUrl: brand.websiteUrl || "",
            instagramHandle: brand.instagramHandle || "",
          },
        ));
        return reply.code(201).send(mission);
      } catch (error) {
        await quota.release(reservationId).catch(() => undefined);
        throw error;
      }
    },
  );

  app.get("/api/v1/intelligence/missions/:id", async (request) => {
    const context = await auth.authenticate(bearerToken(request));
    const id = z.string().uuid().parse((request.params as { id: string }).id);
    return execute(() => intelligence.get(id, context.organization.id));
  });

  app.get("/api/v1/intelligence/missions/:id/results", async (request) => {
    const context = await auth.authenticate(bearerToken(request));
    const id = z.string().uuid().parse((request.params as { id: string }).id);
    const limit = z.coerce.number().int().min(1).max(500).default(100).parse(
      (request.query as { limit?: string }).limit,
    );
    const result = await execute(() => intelligence.results(id, context.organization.id, limit));

    if (result.mission.playbook !== "b2b_prospecting") {
      return result;
    }

    const items = await execute(() => leads.syncMissionResults(
      context.organization.id,
      id,
      result.items,
    ));
    return { mission: result.mission, items };
  });

  app.get("/api/v1/intelligence/leads", async (request) => {
    const context = await auth.authenticate(bearerToken(request));
    const query = z.object({
      status: LeadStatusSchema.optional(),
      priority: LeadPrioritySchema.optional(),
      search: z.string().trim().max(200).optional(),
      limit: z.coerce.number().int().min(1).max(500).default(200),
    }).parse(request.query);
    return {
      leads: await execute(() => leads.list(context.organization.id, query)),
    };
  });

  app.patch(
    "/api/v1/intelligence/leads/:id",
    { config: { rateLimit: { max: 120, timeWindow: "1 minute" } } },
    async (request) => {
      const context = await auth.authenticate(bearerToken(request));
      const id = z.string().uuid().parse((request.params as { id: string }).id);
      const input = LeadUpdateSchema.parse(request.body);
      return execute(() => leads.update(id, context.organization.id, input));
    },
  );

  app.post(
    "/api/v1/intelligence/missions/:id/retry",
    { config: { rateLimit: { max: 4, timeWindow: "30 minutes" } } },
    async (request) => {
      const context = await auth.authenticate(bearerToken(request));
      const id = z.string().uuid().parse((request.params as { id: string }).id);
      const mission = await execute(() => intelligence.get(id, context.organization.id, false));
      if (mission.status !== "failed") {
        throw new AuthError(
          "INTELLIGENCE_RETRY_NOT_ALLOWED",
          409,
          "Somente missões que falharam podem ser reenviadas sem novo consumo.",
        );
      }

      const brands = await auth.listBrands(context.organization.id);
      const brand = brands.find((item) => item.id === mission.brandId);
      if (!brand) {
        throw new AuthError(
          "INTELLIGENCE_BRAND_NOT_FOUND",
          404,
          "Marca vinculada à missão não foi encontrada.",
        );
      }

      await execute(() => quota.assertRetryCapacity(
        context.organization.id,
        mission.maxItems,
      ));

      return execute(() => intelligence.retry(id, context.organization.id, {
        id: brand.id,
        name: brand.name,
        niche: brand.niche,
        websiteUrl: brand.websiteUrl || "",
        instagramHandle: brand.instagramHandle || "",
      }));
    },
  );

  app.post(
    "/api/v1/internal/intelligence/missions/:id/result",
    { config: { rateLimit: { max: 120, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const id = z.string().uuid().parse((request.params as { id: string }).id);
      const callback = IntelligenceCallbackSchema.parse(request.body);
      await execute(async () => {
        intelligence.validateCallbackSecret(callbackSecret(request));
        const mission = await intelligence.applyCallback(id, callback);
        if (
          mission.playbook === "b2b_prospecting" &&
          callback.status === "completed" &&
          callback.resultPreview.length
        ) {
          await leads.syncMissionResults(
            mission.organizationId,
            mission.id,
            callback.resultPreview,
          );
        }
      });
      return reply.code(200).send({ received: true });
    },
  );
}
