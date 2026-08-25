import { BrandScanRequestSchema } from "@modo/contracts/brand-scan";
import { SourceExtractRequestSchema } from "@modo/contracts/source";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { AuthError, type AuthService } from "../services/auth-service.js";
import { BrandScanError, BrandScanService } from "../services/brand-scan-service.js";
import { extractPublicSource } from "../services/source-service.js";

function bearerToken(request: FastifyRequest) {
  const value = request.headers.authorization;
  if (!value?.startsWith("Bearer ")) {
    throw new AuthError("UNAUTHORIZED", 401, "Faça login para continuar.");
  }
  return value.slice(7).trim();
}

export async function registerSourceRoutes(app: FastifyInstance, auth: AuthService) {
  const brandScanner = new BrandScanService({
    openAiApiKey: process.env.OPENAI_API_KEY,
    openAiTextModel: process.env.OPENAI_TEXT_MODEL,
    apifyBaseUrl: process.env.APIFY_API_BASE_URL,
    apifyToken: process.env.APIFY_API_TOKEN,
    apifyWebsiteCrawlerActorId: process.env.APIFY_WEBSITE_CRAWLER_ACTOR_ID,
    apifyInstagramScraperActorId: process.env.APIFY_INSTAGRAM_SCRAPER_ACTOR_ID,
  });

  app.post(
    "/api/v1/sources/extract",
    { config: { rateLimit: { max: 12, timeWindow: "10 minutes" } } },
    async (request) => {
      await auth.authenticate(bearerToken(request));
      const input = SourceExtractRequestSchema.parse(request.body);
      try {
        return await extractPublicSource(input.url);
      } catch (error) {
        throw new AuthError(
          "SOURCE_EXTRACTION_FAILED",
          400,
          error instanceof Error ? error.message : "Não foi possível ler essa fonte.",
        );
      }
    },
  );

  app.post(
    "/api/v1/brands/scan-url",
    { config: { rateLimit: { max: 5, timeWindow: "10 minutes" } } },
    async (request) => {
      await auth.authenticate(bearerToken(request));
      const input = BrandScanRequestSchema.parse(request.body);
      try {
        return await brandScanner.scan(input.url);
      } catch (error) {
        if (error instanceof BrandScanError) {
          throw new AuthError(error.code, error.statusCode, error.message);
        }
        throw error;
      }
    },
  );
}
