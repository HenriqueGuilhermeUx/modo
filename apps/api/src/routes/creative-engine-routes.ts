import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { AuthError, type AuthService } from "../services/auth-service.js";
import { CreativeEngineService } from "../services/creative-engine-service.js";
import { CreativeAssetService } from "../services/creative-asset-service.js";
import { videoCapabilities, videoRoutingPreview } from "../services/video-model-catalog.js";

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
  confirmPaidGeneration: z.boolean().optional(),
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

function publicCreative(item: any) {
  if (!item) return item;
  const { providerJobId: _providerJobId, organizationId: _organizationId, ...safe } = item;
  return safe;
}

export async function registerCreativeEngineRoutes(app: FastifyInstance, options: {
  auth: AuthService;
  engine: CreativeEngineService;
  assets: CreativeAssetService;
  creativeIntelligence?: { getProfile(accountId:string,brandId:string):Promise<any> };
}) {
  app.get("/api/v1/creative-engine/video-capabilities", async (request) => { await options.auth.authenticate(token(request)); return {items:videoCapabilities()}; });

  app.post("/api/v1/creative-engine/video-route-preview", async (request) => { await options.auth.authenticate(token(request)); const body=z.object({objective:z.string().optional(),channel:z.string().optional(),format:z.string().optional()}).parse(request.body||{}); return videoRoutingPreview(body); });

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
    const idemRaw=request.headers["idempotency-key"]; const idem=Array.isArray(idemRaw)?idemRaw[0]:idemRaw;
    if(idem && (idem.length<8 || idem.length>200)) throw new AuthError("INVALID_IDEMPOTENCY_KEY",400,"Idempotency-Key inválida.");
    const profile=options.creativeIntelligence?await options.creativeIntelligence.getProfile(context.organization.id,input.brandId):undefined;
    const brandContext=profile?[...(profile.productsOrServicesToShow||[]).map((x:string)=>`Produto/serviço: ${x}`),...(profile.currentPriorities||[]).map((x:string)=>`Prioridade: ${x}`),...(profile.proofAvailable||[]).map((x:string)=>`Prova disponível: ${x}`),...(profile.prohibitedTopics||[]).map((x:string)=>`Não abordar: ${x}`)].join("\n"):"";
    const enrichedInput=brandContext?{...input,prompt:`${input.prompt}\n\nContexto conhecido da marca:\n${brandContext}`} : input;
    if (input.kind === "video" && input.confirmPaidGeneration !== true) throw new AuthError("PAID_GENERATION_CONFIRMATION_REQUIRED",409,"Vídeos usam geração paga. Confirme explicitamente antes de gerar.");
    const job = await options.engine.generate(enrichedInput, input.provider);
    const stored = await options.assets.create(context.organization.id, input, job);
    return reply.code(202).send(publicCreative(stored));
  });

  app.get("/api/v1/creative-engine/costs/:brandId", async (request) => { const brandId=z.string().uuid().parse((request.params as {brandId:string}).brandId); const context=await contextForBrand(options.auth,request,brandId); return options.assets.costSummary(context.organization.id,brandId); });

  app.get("/api/v1/creative-engine/library/:brandId", async (request) => {
    const brandId = z.string().uuid().parse((request.params as { brandId: string }).brandId);
    const context = await contextForBrand(options.auth, request, brandId);
    return { items: (await options.assets.list(context.organization.id, brandId)).map(publicCreative) };
  });

  app.get("/api/v1/creative-engine/approved/:brandId", async (request) => {
    const brandId = z.string().uuid().parse((request.params as { brandId: string }).brandId);
    const context = await contextForBrand(options.auth, request, brandId);
    return { items: (await options.assets.listApproved(context.organization.id, brandId)).map(publicCreative) };
  });

  app.post("/api/v1/creative-engine/generations/:id/approval", async (request) => {
    const context = await options.auth.authenticate(token(request));
    const id = z.string().uuid().parse((request.params as { id: string }).id);
    const body = z.object({ status: z.enum(["approved","rejected"]) }).parse(request.body);
    const item = await options.assets.get(context.organization.id,id);
    if (!item) throw new AuthError("CREATIVE_NOT_FOUND",404,"Criação não encontrada.");
    const checked = item.qualityStatus === "pending" ? await options.assets.qualityGate(context.organization.id,id) : item;
    if (body.status === "approved" && checked.qualityStatus !== "passed") throw new AuthError("QUALITY_GATE_FAILED",409,"O criativo precisa passar pelo Quality Gate antes da aprovação.");
    return publicCreative(await options.assets.setApproval(context.organization.id,id,body.status));
  });

  app.post("/api/v1/creative-engine/generations/:id/variation", {
    config: { rateLimit: { max: 12, timeWindow: "10 minutes" } },
  }, async (request, reply) => {
    const context = await options.auth.authenticate(token(request));
    const id = z.string().uuid().parse((request.params as { id: string }).id);
    const source = await options.assets.get(context.organization.id,id);
    if (!source) throw new AuthError("CREATIVE_NOT_FOUND",404,"Criação não encontrada.");
    const body = z.object({ instructions: z.string().max(2000).optional() }).parse(request.body || {});
    const brief = { brandId: source.brandId, kind: source.kind as "image"|"video", objective: source.objective, prompt: body.instructions ? source.prompt + "\\n\\nVariação solicitada: " + body.instructions : source.prompt + "\\n\\nCrie uma variação visual distinta preservando objetivo e mensagem." };
    const job = await options.engine.generate(brief, source.provider);
    const stored = await options.assets.create(context.organization.id, brief, job);
    return reply.code(202).send(publicCreative(stored));
  });

  app.get("/api/v1/creative-engine/generations/:id", async (request) => {
    const context = await options.auth.authenticate(token(request));
    const id = z.string().uuid().parse((request.params as { id: string }).id);
    const stored = await options.assets.get(context.organization.id, id);
    if (!stored) throw new AuthError("CREATIVE_NOT_FOUND", 404, "Criação não encontrada.");
    if (stored.status === "ready" || stored.status === "failed") return publicCreative(stored);
    const providerJob = await options.engine.status(stored.provider, stored.providerJobId);
    const synced = await options.assets.sync(context.organization.id, id, providerJob);
    return publicCreative(synced.status === "ready" ? await options.assets.qualityGate(context.organization.id,id) : synced);
  });
}
