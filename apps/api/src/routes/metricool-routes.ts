import type { FastifyInstance, FastifyRequest } from "fastify";
import { AuthError, AuthService } from "../services/auth-service.js";
import { MetricoolService } from "../services/metricool-service.js";

function bearerToken(request: FastifyRequest) {
  const value = request.headers.authorization;
  if (!value?.startsWith("Bearer ")) throw new AuthError("UNAUTHORIZED", 401, "Faça login para continuar.");
  return value.slice(7).trim();
}

export async function registerMetricoolRoutes(app: FastifyInstance, options: {
  databaseUrl?: string; databaseSsl?: boolean; userToken?: string; userId?: string; baseUrl?: string;
}) {
  const auth = new AuthService({ databaseUrl: options.databaseUrl, databaseSsl: options.databaseSsl });
  const metricool = new MetricoolService(options);
  await Promise.all([auth.initialize(), metricool.initialize()]);
  app.addHook("onClose", async () => { await Promise.all([auth.close(), metricool.close()]); });

  async function requireBrand(request: FastifyRequest, brandId: string) {
    const current = await auth.authenticate(bearerToken(request));
    const brands = await auth.listBrands(current.organization.id);
    if (!brands.some((brand) => brand.id === brandId)) throw new AuthError("BRAND_NOT_FOUND", 404, "Marca não encontrada nesta organização.");
    return current;
  }

  app.get("/api/v1/metricool/health", async () => ({
    status: "ok", configured: metricool.configured, mode: metricool.mode, storage: metricool.storage,
    customerExperience: "modo_managed", credentialsExposedToClient: false,
  }));

  app.get("/api/v1/metricool/brands/:brandId/status", async (request) => {
    const brandId = (request.params as { brandId: string }).brandId;
    const current = await requireBrand(request, brandId);
    return metricool.status(current.organization.id, brandId);
  });

  app.post("/api/v1/metricool/brands/:brandId/connect", { config: { rateLimit: { max: 6, timeWindow: "10 minutes" } } }, async (request, reply) => {
    try {
      const brandId = (request.params as { brandId: string }).brandId;
      const current = await requireBrand(request, brandId);
      return await metricool.connectionPortal(current.organization.id, brandId);
    } catch (error) {
      if (error instanceof AuthError) throw error;
      request.log.error({ error }, "Metricool connection error");
      return reply.code(503).send({ code: "METRICOOL_NOT_READY", message: error instanceof Error ? error.message : "Não foi possível preparar a conexão social." });
    }
  });
}
