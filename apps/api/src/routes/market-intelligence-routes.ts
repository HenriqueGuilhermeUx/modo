import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import type { AuthService } from "../services/auth-service.js";
import { MarketIntelligenceError, MarketIntelligenceService } from "../services/market-intelligence-service.js";
import { assertPublicHttpUrl } from "../security/public-url.js";

function token(request: FastifyRequest) {
  const value = request.headers.authorization;
  if (!value?.startsWith("Bearer ")) throw new MarketIntelligenceError("UNAUTHORIZED", 401, "Faça login para continuar.");
  return value.slice(7).trim();
}
const UrlSchema = z.string().url().max(5000);

export async function registerMarketIntelligenceRoutes(
  app: FastifyInstance,
  options: { auth: AuthService; service: MarketIntelligenceService },
) {
  app.get("/api/v1/market-intelligence/capabilities", async (request) => {
    await options.auth.authenticate(token(request));
    return options.service.capabilities;
  });

  app.post(
    "/api/v1/market-intelligence/inspect",
    { config: { rateLimit: { max: 12, timeWindow: "10 minutes" } } },
    async (request, reply) => {
      await options.auth.authenticate(token(request));
      const url = UrlSchema.parse((request.body as { url?: unknown })?.url);
      assertPublicHttpUrl(url);
      try {
        return await options.service.inspectPage(url);
      } catch (error) {
        if (error instanceof MarketIntelligenceError) return reply.code(error.status).send({ code: error.code, message: error.message });
        throw error;
      }
    },
  );

  app.get("/api/v1/market-intelligence/watches", async (request, reply) => {
    await options.auth.authenticate(token(request));
    try {
      return await options.service.listWatches();
    } catch (error) {
      if (error instanceof MarketIntelligenceError) return reply.code(error.status).send({ code: error.code, message: error.message });
      throw error;
    }
  });

  app.post(
    "/api/v1/market-intelligence/watches",
    { config: { rateLimit: { max: 20, timeWindow: "1 hour" } } },
    async (request, reply) => {
      const context = await options.auth.authenticate(token(request));
      const body = request.body as { url?: unknown; title?: unknown };
      const url = UrlSchema.parse(body?.url);
      assertPublicHttpUrl(url);
      const title = typeof body?.title === "string" ? body.title.slice(0, 200) : undefined;
      try {
        return reply.code(201).send(await options.service.createWatch({
          url,
          title,
          tag: `modo:${context.organization.id}`,
        }));
      } catch (error) {
        if (error instanceof MarketIntelligenceError) return reply.code(error.status).send({ code: error.code, message: error.message });
        throw error;
      }
    },
  );
}
