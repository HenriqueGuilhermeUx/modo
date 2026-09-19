import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { AuthError, type AuthService } from "../services/auth-service.js";
import { CreativeEngineService } from "../services/creative-engine-service.js";
import { CreativeAssetService } from "../services/creative-asset-service.js";

const BriefSchema = z.object({
  brandId: z.string().uuid(),
  kind: z.enum(["image", "video"]),
  objective: z.string().min(2).max(500),
  audience: z.string().max(1000).optional(),
  channel: z.string().max(100).optional(),
  format: z.string().max(100).optional(),
  prompt: z.string().min(3).max(8000),
  negativePrompt: z.string().max(4000).optional(),
  durationSeconds: z.number().int().min(1).max(120).optional(),
  provider: z.string().max(50).optional(),
});

function token(request: FastifyRequest) {
  const value = request.headers.authorization;
  if (!value?.startsWith("Bearer ")) throw new AuthError("UNAUTHORIZED", 401, "Faça login para continuar.");
  return value.slice(7).trim();
}

async function contextForBrand(auth: AuthService, request: FastifyRequest, brandId: string) {
  const context = await auth.authenticate(token(request));
  const brands = await auth.listBrands(context.organization.id);
  if (!brands.some((brand) => brand.id === brandId)) {
    throw new AuthError("BRAND_NOT_FOUND", 404, "Marca não encontrada nesta organização.");
  }
  return context;
}

export async function registerCreativeEngineRoutes(app: FastifyInstance, options: {
  auth: AuthService;
  engine: CreativeEngineService;
  assets: CreativeAssetService;
}) {
  app.get("/api/v1/creative-engine/health", async () => ({
    status: "ok",
    providers: options.engine.capabilities(),
    publishing: false,
    humanApprovalRequired: true,
  }));

  app.post("/api/v1/creative-engine/generations", {
    config: { rateLimit: { max: 12, timeWindow: "10 minutes" } },
  }, async (request, reply) => {
    const input = BriefSchema.parse(request.body);
    const context = await contextForBrand(options.auth, request, input.brandId);
    const job = await options.engine.generate(input, input.provider);
    const stored = await options.assets.create(context.organization.id, input, job);
    return reply.code(202).send(stored);
  });

  app.get("/api/v1/creative-engine/library/:brandId", async (request) => {
    const brandId = z.string().uuid().parse((request.params as { brandId: string }).brandId);
    const context = await contextForBrand(options.auth, request, brandId);
    return { items: await options.assets.list(context.organization.id, brandId) };
  });

  app.post("/api/v1/creative-engine/generations/:id/approval", async (request) => {
    const context = await options.auth.authenticate(token(request));
    const id = z.string().uuid().parse((request.params as { id: string }).id);
    const body = z.object({ status: z.enum(["approved","rejected"]) }).parse(request.body);
    return options.assets.setApproval(context.organization.id,id,body.status);
  });

  app.get("/api/v1/creative-engine/generations/:id", async (request) => {
    const context = await options.auth.authenticate(token(request));
    const id = z.string().uuid().parse((request.params as { id: string }).id);
    const stored = await options.assets.get(context.organization.id, id);
    if (!stored) throw new AuthError("CREATIVE_NOT_FOUND", 404, "Criação não encontrada.");
    if (stored.status === "ready" || stored.status === "failed") return stored;
    const providerJob = await options.engine.status(stored.provider, stored.providerJobId);
    return options.assets.sync(context.organization.id, id, providerJob);
  });
}
