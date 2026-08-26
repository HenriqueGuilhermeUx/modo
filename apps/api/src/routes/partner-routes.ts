import { PartnerApplicationCreateSchema } from "@modo/contracts/strategy-network";
import type { FastifyInstance } from "fastify";
import { PartnerNotifier } from "../services/partner-notifier.js";
import { PartnerError, PartnerService } from "../services/partner-service.js";

interface Options {
  databaseUrl?: string;
  databaseSsl?: boolean;
  resendApiKey?: string;
  emailFrom?: string;
  emailTo?: string;
  publicWebUrl?: string;
}

export async function registerPartnerRoutes(app: FastifyInstance, options: Options) {
  const service = new PartnerService(options);
  const notifier = new PartnerNotifier(options);
  await service.initialize();
  app.addHook("onClose", async () => service.close());

  app.get("/api/v1/partners/health", async () => ({
    status: "ok",
    program: "founding_partners",
    storage: service.storage,
    notification: notifier.configured ? "configured" : "not_configured",
  }));

  app.post(
    "/api/v1/public/partner-applications",
    { config: { rateLimit: { max: 5, timeWindow: "1 hour" } } },
    async (request, reply) => {
      try {
        const input = PartnerApplicationCreateSchema.parse(request.body);
        const created = await service.createApplication(input);
        void notifier.notify(created).catch((error) => {
          request.log.error(
            { applicationId: created.id, error: error instanceof Error ? error.message : String(error) },
            "Falha ao notificar candidatura MODO Partner",
          );
        });
        return reply.code(201).send(created);
      } catch (error) {
        if (error instanceof PartnerError) {
          return reply.code(error.statusCode).send({ code: error.code, message: error.message });
        }
        const message = error instanceof Error ? error.message : "Não foi possível receber sua candidatura.";
        const validation = error instanceof Error && error.name === "ZodError";
        return reply.code(validation ? 400 : 500).send({
          code: validation ? "INVALID_PARTNER_APPLICATION" : "INTERNAL_ERROR",
          message: validation ? message : "Não foi possível receber sua candidatura agora.",
        });
      }
    },
  );
}
