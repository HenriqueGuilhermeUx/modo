import {
  LinkedInConnectRequestSchema,
  LinkedInPublishRequestSchema,
} from "@modo/contracts/linkedin";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { AuthError, type AuthService } from "../services/auth-service.js";
import type { ContentService } from "../services/content-service.js";
import { LinkedInService } from "../services/linkedin-service.js";

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
  app.addHook("onClose", async () => service.close());

  app.get("/api/v1/linkedin/status", async (request) => {
    const context = await options.auth.authenticate(bearerToken(request));
    return service.getStatus(context.organization.id);
  });

  app.post("/api/v1/linkedin/connect", async (request) => {
    const context = await options.auth.authenticate(bearerToken(request));
    return service.createAuthorizationUrl(
      context.organization.id,
      LinkedInConnectRequestSchema.parse(request.body),
    );
  });

  app.get("/api/v1/linkedin/callback", async (request, reply) => {
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

  app.post("/api/v1/linkedin/disconnect", async (request) => {
    const context = await options.auth.authenticate(bearerToken(request));
    return service.disconnect(context.organization.id);
  });

  app.get("/api/v1/linkedin/publications", async (request) => {
    const context = await options.auth.authenticate(bearerToken(request));
    return { publications: await service.listPublications(context.organization.id) };
  });

  app.post("/api/v1/linkedin/publications", async (request, reply) => {
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
}
