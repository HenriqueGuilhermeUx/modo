import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import {
  HumanOperationsError,
  HumanOperationsService,
} from "../services/human-operations-service.js";

const SupportStatusSchema = z.enum(["requested", "triage", "proposal", "in_progress", "completed", "declined"]);
const PricingStatusSchema = z.enum(["under_review", "proposal_required", "included", "not_available"]);
const ApplicationStatusSchema = z.enum(["received", "under_review", "approved", "talent_pool", "declined"]);

function bearer(request: FastifyRequest) {
  const value = request.headers.authorization;
  if (!value?.startsWith("Bearer ")) {
    throw new HumanOperationsError("ADMIN_UNAUTHORIZED", 401, "Acesso administrativo não autorizado.");
  }
  return value.slice(7).trim();
}

interface Options {
  databaseUrl?: string;
  databaseSsl?: boolean;
}

export async function registerHumanOperationsRoutes(app: FastifyInstance, options: Options) {
  const operations = new HumanOperationsService(options);
  await operations.initialize();
  app.addHook("onClose", async () => operations.close());

  async function authenticate(request: FastifyRequest) {
    await operations.authenticateAdmin(bearer(request));
  }

  app.get("/api/v1/admin/human-operations/overview", async (request) => {
    await authenticate(request);
    return operations.overview();
  });

  app.get("/api/v1/admin/human-operations/support-requests", async (request) => {
    await authenticate(request);
    return { requests: await operations.listSupportRequests() };
  });

  app.patch("/api/v1/admin/human-operations/support-requests/:id", async (request) => {
    await authenticate(request);
    const id = z.string().uuid().parse((request.params as { id: string }).id);
    const input = z.object({
      status: SupportStatusSchema.optional(),
      pricingStatus: PricingStatusSchema.optional(),
      internalNotes: z.string().trim().max(5000).optional(),
      assignedApplicationId: z.string().uuid().nullable().optional(),
    }).parse(request.body);
    return operations.updateSupportRequest(id, input);
  });

  app.get("/api/v1/admin/human-operations/applications", async (request) => {
    await authenticate(request);
    return { applications: await operations.listApplications() };
  });

  app.patch("/api/v1/admin/human-operations/applications/:id", async (request) => {
    await authenticate(request);
    const id = z.string().uuid().parse((request.params as { id: string }).id);
    const input = z.object({
      status: ApplicationStatusSchema.optional(),
      internalNotes: z.string().trim().max(5000).optional(),
    }).parse(request.body);
    return operations.updateApplication(id, input);
  });

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof HumanOperationsError) {
      return reply.code(error.statusCode).send({ code: error.code, message: error.message });
    }
    const message = error instanceof Error ? error.message : "Ocorreu um erro inesperado.";
    const validation = error instanceof Error && error.name === "ZodError";
    return reply.code(validation ? 400 : 500).send({
      code: validation ? "INVALID_REQUEST" : "INTERNAL_ERROR",
      message: validation ? message : "Ocorreu um erro inesperado.",
    });
  });
}
