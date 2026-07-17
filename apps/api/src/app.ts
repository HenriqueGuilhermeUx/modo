import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import { DiagnosticCreateRequestSchema, LeadCreateRequestSchema } from "@modo/contracts";
import Fastify from "fastify";
import type { DiagnosticProvider } from "./providers/diagnostic-provider.js";
import { assertPublicHttpUrl } from "./security/public-url.js";
import { DiagnosticService } from "./services/diagnostic-service.js";
import { LeadService } from "./services/lead-service.js";

export interface CreateAppOptions { provider: DiagnosticProvider; allowedOrigins?: string[]; logger?: boolean; }

export async function createApp(options: CreateAppOptions) {
  const app = Fastify({logger: options.logger ?? false});
  const diagnosticService = new DiagnosticService(options.provider);
  const leadService = new LeadService();
  const allowedOrigins = options.allowedOrigins ?? ["http://localhost:5173"];

  await app.register(helmet, {contentSecurityPolicy: false});
  await app.register(cors, {origin(origin, callback) {
    if (!origin || allowedOrigins.includes("*") || allowedOrigins.includes(origin)) return callback(null, true);
    callback(new Error("Origem não permitida."), false);
  }});
  await app.register(rateLimit, {max: 80, timeWindow: "1 minute"});

  app.get("/health", async () => ({status: "ok", service: "modo-api", version: "0.1.0"}));

  app.post("/api/v1/diagnostics", {config: {rateLimit: {max: 8, timeWindow: "10 minutes"}}}, async (request, reply) => {
    const input = DiagnosticCreateRequestSchema.parse(request.body);
    assertPublicHttpUrl(input.websiteUrl);
    const job = diagnosticService.create(input);
    return reply.code(202).send({id: job.id, status: job.status, pollUrl: `/api/v1/diagnostics/${job.id}`});
  });

  app.get("/api/v1/diagnostics/:id", async (request, reply) => {
    const {id} = request.params as {id: string};
    const job = diagnosticService.get(id);
    if (!job) return reply.code(404).send({code: "DIAGNOSTIC_NOT_FOUND", message: "Diagnóstico não encontrado."});
    return job;
  });

  app.post("/api/v1/leads", {config: {rateLimit: {max: 10, timeWindow: "10 minutes"}}}, async (request, reply) => {
    const input = LeadCreateRequestSchema.parse(request.body);
    if (!diagnosticService.get(input.diagnosticId)) return reply.code(404).send({code: "DIAGNOSTIC_NOT_FOUND", message: "Diagnóstico não encontrado."});
    const lead = leadService.create(input);
    request.log.info({leadId: lead.id}, "Lead capturado");
    return reply.code(201).send({id: lead.id, status: "captured"});
  });

  app.setErrorHandler((error, _request, reply) => {
    const errorMessage = error instanceof Error ? error.message : "Ocorreu um erro inesperado.";
    const errorName = error instanceof Error ? error.name : "UnknownError";
    const isValidation = errorName === "ZodError" || errorMessage.includes("URL") || errorMessage.includes("Endereços");
    const statusCode = isValidation ? 400 : 500;
    return reply.code(statusCode).send({
      code: statusCode === 400 ? "INVALID_REQUEST" : "INTERNAL_ERROR",
      message: isValidation ? errorMessage : "Ocorreu um erro inesperado.",
    });
  });

  return app;
}
