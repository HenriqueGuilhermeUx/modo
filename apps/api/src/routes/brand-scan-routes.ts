import { BrandScanRequestSchema } from "@modo/contracts/brand-scan";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { AuthError, type AuthService } from "../services/auth-service.js";
import { BrandScanError, type BrandScanService } from "../services/brand-scan-service.js";

function bearerToken(request: FastifyRequest) {
  const value = request.headers.authorization;
  if (!value?.startsWith("Bearer ")) {
    throw new AuthError("UNAUTHORIZED", 401, "Faça login para continuar.");
  }
  return value.slice(7).trim();
}

export async function registerBrandScanRoutes(
  app: FastifyInstance,
  options: { auth: AuthService; scanner: BrandScanService },
) {
  app.post(
    "/api/v1/brands/scan-url",
    { config: { rateLimit: { max: 5, timeWindow: "10 minutes" } } },
    async (request) => {
      await options.auth.authenticate(bearerToken(request));
      const input = BrandScanRequestSchema.parse(request.body);
      try {
        return await options.scanner.scan(input.url);
      } catch (error) {
        if (error instanceof BrandScanError) {
          throw new AuthError(error.code, error.statusCode, error.message);
        }
        throw error;
      }
    },
  );
}
