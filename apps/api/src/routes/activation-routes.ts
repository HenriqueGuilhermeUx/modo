import { z } from "zod";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { AuthError, type AuthService } from "../services/auth-service.js";
import {
  activationEventNames,
  type ActivationService,
} from "../services/activation-service.js";

const ActivationEventSchema = z.object({
  event: z.enum(activationEventNames),
  metadata: z
    .record(z.string(), z.union([z.string().max(300), z.number().finite(), z.boolean(), z.null()]))
    .optional()
    .default({}),
});

function bearerToken(request: FastifyRequest) {
  const value = request.headers.authorization;
  if (!value?.startsWith("Bearer ")) {
    throw new AuthError("UNAUTHORIZED", 401, "Faça login para continuar.");
  }
  return value.slice(7).trim();
}

export async function registerActivationRoutes(
  app: FastifyInstance,
  options: { auth: AuthService; activation: ActivationService },
) {
  app.get("/api/v1/activation-summary", async (request) => {
    const context = await options.auth.authenticate(bearerToken(request));
    return options.activation.summary(context.organization.id);
  });

  app.post(
    "/api/v1/activation-events",
    { config: { rateLimit: { max: 40, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const context = await options.auth.authenticate(bearerToken(request));
      const input = ActivationEventSchema.parse(request.body);
      const metadata = Object.fromEntries(Object.entries(input.metadata).slice(0, 15));
      const event = await options.activation.record({
        organizationId: context.organization.id,
        userId: context.user.id,
        name: input.event,
        metadata,
      });
      return reply.code(201).send({ event });
    },
  );
}
