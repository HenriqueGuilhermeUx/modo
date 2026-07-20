import {
  LinkedInConnectRequestSchema,
  LinkedInPublishRequestSchema,
} from "@modo/contracts/linkedin";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { AuthError, type AuthService } from "../services/auth-service.js";
import type { ContentService } from "../services/content-service.js";
import { renderLinkedInDocument } from "../services/linkedin-document.js";
import { LinkedInError, LinkedInService } from "../services/linkedin-service.js";

interface Options {
  auth: AuthService;
  content: ContentService;
  clientId?: string;
  clientSecret?: string;
  redirectUri?: string;
  scopes?: string;
  encryptionSecret?: string;
  apiVersion?: string;
  webUrl?: string;
  databaseUrl?: string;
  databaseSsl?: boolean;
}

function bearerToken(request: FastifyRequest) {
  const value = request.headers.authorization;
  if (!value?.startsWith("Bearer ")) {
    throw new AuthError("UNAUTHORIZED", 401, "Faça login para continuar.");
  }
  return value.slice(7).trim();
}

export async function registerLinkedInRoutes(app: FastifyInstance, options: Options) {
  await app.register(async (scope) => {
    const service = new LinkedInService({
      clientId: options.clientId,
      clientSecret: options.clientSecret,
      redirectUri: options.redirectUri,
      scopes: options.scopes,
      encryptionSecret: options.encryptionSecret,
      apiVersion: options.apiVersion,
      webUrl: options.webUrl,
      databaseUrl: options.databaseUrl,
      databaseSsl: options.databaseSsl,
    });
    await service.initialize();
    scope.addHook("onClose", async () => service.close());

    scope.setErrorHandler((error, _request, reply) => {
      if (error instanceof LinkedInError || error instanceof AuthError) {
        return reply.code(error.statusCode).send({ code: error.code, message: error.message });
      }
      const message = error instanceof Error ? error.message : "Não foi possível concluir a operação no LinkedIn.";
      const validation = error instanceof Error && error.name === "ZodError";
      return reply.code(validation ? 400 : 500).send({
        code: validation ? "INVALID_REQUEST" : "LINKEDIN_INTERNAL_ERROR",
        message: validation ? message : "Não foi possível concluir a operação no LinkedIn.",
      });
    });

    scope.get("/api/v1/linkedin/status", async (request) => {
      const context = await options.auth.authenticate(bearerToken(request));
      return service.getStatus(context.organization.id);
    });

    scope.post("/api/v1/linkedin/connect", async (request) => {
      const context = await options.auth.authenticate(bearerToken(request));
      return service.createAuthorizationUrl(
        context.organization.id,
        LinkedInConnectRequestSchema.parse(request.body),
      );
    });

    scope.get("/api/v1/linkedin/callback", async (request, reply) => {
      const query = request.query as {
        state?: string;
        code?: string;
        error?: string;
        error_description?: string;
      };
      const target = await service.completeAuthorization({
        state: query.state,
        code: query.code,
        error: query.error,
        errorDescription: query.error_description,
      });
      return reply.redirect(target);
    });

    scope.post("/api/v1/linkedin/disconnect", async (request) => {
      const context = await options.auth.authenticate(bearerToken(request));
      return service.disconnect(context.organization.id);
    });

    scope.get("/api/v1/linkedin/publications", async (request) => {
      const context = await options.auth.authenticate(bearerToken(request));
      return { publications: await service.listPublications(context.organization.id) };
    });

    scope.get("/api/v1/linkedin/content/:id/document", async (request, reply) => {
      const context = await options.auth.authenticate(bearerToken(request));
      const content = await options.content.getForOrganization(
        (request.params as { id: string }).id,
        context.organization.id,
      );
      if (!content.output) {
        throw new LinkedInError(
          "CONTENT_NOT_READY",
          409,
          "O conteúdo precisa estar pronto antes de gerar o documento.",
        );
      }
      const pdf = await renderLinkedInDocument(content.output);
      reply.header("content-type", "application/pdf");
      reply.header(
        "content-disposition",
        `attachment; filename="modo-linkedin-${content.id}.pdf"`,
      );
      return reply.send(Buffer.from(pdf));
    });

    scope.post("/api/v1/linkedin/publications", async (request, reply) => {
      const context = await options.auth.authenticate(bearerToken(request));
      const input = LinkedInPublishRequestSchema.parse(request.body);
      const content = await options.content.getForOrganization(
        input.contentRequestId,
        context.organization.id,
      );
      const publication = await service.requestPublication(
        context.organization.id,
        content,
        input.scheduledFor,
      );
      return reply.code(201).send(publication);
    });
  });
}
