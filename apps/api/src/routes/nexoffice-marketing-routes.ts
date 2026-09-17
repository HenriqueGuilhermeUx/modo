import { timingSafeEqual } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { AdsCopilotService } from "../services/ads-copilot-service.js";
import { DemandService } from "../services/demand-service.js";
import { MediaCampaignError, MediaCampaignService } from "../services/media-campaign-service.js";
import { MediaConnectionService, type MediaProvider } from "../services/media-connection-service.js";

type Options = {
  serviceKey?: string;
  databaseUrl?: string;
  databaseSsl?: boolean;
  openAiApiKey?: string;
  openAiTextModel?: string;
};

const DemandInput = z.object({
  name: z.string().max(160).optional(),
  business: z.string().min(1).max(160),
  offer: z.string().min(1).max(240),
  objective: z.string().max(40).default("leads"),
  location: z.string().max(160).default("Brasil"),
  monthlyBudget: z.number().nonnegative().default(0),
  ticket: z.number().nonnegative().default(0),
  cpc: z.number().positive().optional(),
  landingRate: z.number().min(0).max(100).optional(),
  closeRate: z.number().min(0).max(100).optional(),
});

const AdsInput = z.object({
  business: z.string().min(1).max(160),
  offer: z.string().min(1).max(240),
  objective: z.string().max(80).optional(),
  location: z.string().max(160).optional(),
  budget: z.number().nonnegative().optional(),
  ticket: z.number().nonnegative().optional(),
  customerDescription: z.string().max(1200).optional(),
  channelPreference: z.string().max(120).optional(),
});

const CampaignInput = z.object({
  projectId: z.string().uuid(),
  provider: z.enum(["google_ads", "meta_ads"]),
  name: z.string().max(160).optional(),
  monthlyBudget: z.number().nonnegative().optional(),
  plan: z.record(z.string(), z.unknown()).default({}),
});

function safeEqual(received: string, expected: string) {
  if (!received || !expected) return false;
  const a = Buffer.from(received);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

function access(request: FastifyRequest, expected: string) {
  const key = String(request.headers["x-nexoffice-key"] || "");
  const workspaceId = String(request.headers["x-nexoffice-workspace-id"] || "").trim();
  if (!expected) return { ok: false as const, status: 503, error: "bridge_not_configured" };
  if (!safeEqual(key, expected)) return { ok: false as const, status: 401, error: "unauthorized" };
  if (!workspaceId) return { ok: false as const, status: 400, error: "workspace_required" };
  return { ok: true as const, workspaceId };
}

function context(workspaceId: string) {
  return { organization: { id: `nexoffice:${workspaceId}` } };
}

export async function registerNexOfficeMarketingRoutes(app: FastifyInstance, options: Options = {}) {
  const expectedKey = options.serviceKey || process.env.NEXOFFICE_SERVICE_KEY || "";
  const demand = new DemandService({ databaseUrl: options.databaseUrl, databaseSsl: options.databaseSsl });
  const ads = new AdsCopilotService({ openAiApiKey: options.openAiApiKey, model: options.openAiTextModel });
  const media = new MediaConnectionService({ databaseUrl: options.databaseUrl, databaseSsl: options.databaseSsl });
  const campaigns = new MediaCampaignService({ databaseUrl: options.databaseUrl, databaseSsl: options.databaseSsl });
  await demand.initialize();
  await media.initialize();
  await campaigns.initialize();
  app.addHook("onClose", async () => Promise.all([demand.close(), media.close(), campaigns.close()]));

  app.get("/api/v1/internal/nexoffice/marketing/v1/health", async (request, reply) => {
    const a = access(request, expectedKey);
    if (!a.ok) return reply.code(a.status).send({ status: "error", error: a.error });
    return {
      status: "ok",
      contract: "nexoffice-marketing-v1",
      workspaceId: a.workspaceId,
      storage: { demand: demand.storage, media: media.storage, campaigns: campaigns.storage },
      capabilities: ["demand.projects", "demand.landing", "demand.funnel", "ads.plan", "media.connections.read", "media.connections.prepare", "campaigns.draft", "campaigns.review", "campaigns.ready"],
      workflow: ["draft", "review", "ready"],
      externalCampaignActivation: false,
      readyRequirements: ["explicit_client_approval", "authorized_media_account"],
    };
  });

  app.get("/api/v1/internal/nexoffice/marketing/v1/demand/projects", async (request, reply) => {
    const a = access(request, expectedKey); if (!a.ok) return reply.code(a.status).send({ error: a.error });
    return demand.list(context(a.workspaceId));
  });
  app.post("/api/v1/internal/nexoffice/marketing/v1/demand/projects", async (request, reply) => {
    const a = access(request, expectedKey); if (!a.ok) return reply.code(a.status).send({ error: a.error });
    const input = DemandInput.parse(request.body);
    return reply.code(201).send(await demand.create(context(a.workspaceId), input));
  });
  app.post("/api/v1/internal/nexoffice/marketing/v1/demand/projects/:id/landing", async (request, reply) => {
    const a = access(request, expectedKey); if (!a.ok) return reply.code(a.status).send({ error: a.error });
    return demand.generateLanding(context(a.workspaceId), String((request.params as any).id));
  });
  app.get("/api/v1/internal/nexoffice/marketing/v1/demand/projects/:id/funnel", async (request, reply) => {
    const a = access(request, expectedKey); if (!a.ok) return reply.code(a.status).send({ error: a.error });
    return demand.funnel(context(a.workspaceId), String((request.params as any).id));
  });

  app.post("/api/v1/internal/nexoffice/marketing/v1/ads/plan", async (request, reply) => {
    const a = access(request, expectedKey); if (!a.ok) return reply.code(a.status).send({ error: a.error });
    return ads.plan(AdsInput.parse(request.body));
  });

  app.get("/api/v1/internal/nexoffice/marketing/v1/media/connections", async (request, reply) => {
    const a = access(request, expectedKey); if (!a.ok) return reply.code(a.status).send({ error: a.error });
    return media.list(context(a.workspaceId));
  });
  app.post("/api/v1/internal/nexoffice/marketing/v1/media/connections/:provider/prepare", async (request, reply) => {
    const a = access(request, expectedKey); if (!a.ok) return reply.code(a.status).send({ error: a.error });
    const provider = z.enum(["google_ads", "meta_ads"]).parse((request.params as any).provider) as MediaProvider;
    return reply.code(201).send(await media.prepare(context(a.workspaceId), provider));
  });

  app.get("/api/v1/internal/nexoffice/marketing/v1/campaigns", async (request, reply) => {
    const a = access(request, expectedKey); if (!a.ok) return reply.code(a.status).send({ error: a.error });
    const projectId = String((request.query as any)?.projectId || "") || undefined;
    return campaigns.list(context(a.workspaceId), projectId);
  });
  app.post("/api/v1/internal/nexoffice/marketing/v1/campaigns", async (request, reply) => {
    const a = access(request, expectedKey); if (!a.ok) return reply.code(a.status).send({ error: a.error });
    try { return reply.code(201).send(await campaigns.create(context(a.workspaceId), CampaignInput.parse(request.body))); }
    catch (e) { if (e instanceof MediaCampaignError) return reply.code(e.status).send({ error: e.code, message: e.message }); throw e; }
  });
  app.post("/api/v1/internal/nexoffice/marketing/v1/campaigns/:id/review", async (request, reply) => {
    const a = access(request, expectedKey); if (!a.ok) return reply.code(a.status).send({ error: a.error });
    try { return await campaigns.submitReview(context(a.workspaceId), String((request.params as any).id)); }
    catch (e) { if (e instanceof MediaCampaignError) return reply.code(e.status).send({ error: e.code, message: e.message }); throw e; }
  });
  app.post("/api/v1/internal/nexoffice/marketing/v1/campaigns/:id/ready", async (request, reply) => {
    const a = access(request, expectedKey); if (!a.ok) return reply.code(a.status).send({ error: a.error });
    const body = z.object({ approved: z.literal(true) }).parse(request.body);
    try { return await campaigns.markReady(context(a.workspaceId), String((request.params as any).id), body); }
    catch (e) { if (e instanceof MediaCampaignError) return reply.code(e.status).send({ error: e.code, message: e.message }); throw e; }
  });
}
