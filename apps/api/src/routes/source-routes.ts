import { SourceExtractRequestSchema } from "@modo/contracts/source";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { AuthError, type AuthService } from "../services/auth-service.js";
import { extractPublicSource } from "../services/source-service.js";

function bearerToken(request: FastifyRequest) {
  const value = request.headers.authorization;
  if (!value?.startsWith("Bearer ")) {
    throw new AuthError("UNAUTHORIZED", 401, "Faça login para continuar.");
  }
  return value.slice(7).trim();
}

export async function registerSourceRoutes(app: FastifyInstance, auth: AuthService) {
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
}
