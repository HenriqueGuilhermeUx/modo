import {
  NativeMetaConnectRequestSchema,
  NativeScheduleRequestSchema,
  NativeSocialPlatformSchema,
} from "@modo/contracts/native-publisher";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { AuthError, type AuthService } from "../services/auth-service.js";
import type { ContentService } from "../services/content-service.js";
import {
  NativePublisherError,
  type NativePublisherService,
} from "../services/native-publisher-service.js";

interface Options {
  auth: AuthService;
  content: ContentService;
  publisher: NativePublisherService;
}

function bearerToken(request: FastifyRequest) {
  const value = request.headers.authorization;
  if (!value?.startsWith("Bearer ")) {
    throw new AuthError("UNAUTHORIZED", 401, "Faça login para continuar.");
  }
  return value.slice(7).trim();
}

async function context(options: Options, request: FastifyRequest) {
  return options.auth.authenticate(bearerToken(request));
}

async function requireBrand(options: Options, request: FastifyRequest, brandId: string) {
  const current = await context(options, request);
  const brand = (await options.auth.listBrands(current.organization.id))
    .find((item) => item.id === brandId);
  if (!brand) throw new AuthError("BRAND_NOT_FOUND", 404, "Marca não encontrada nesta organização.");
  return { current, brand };
}

function dateQuery(value: unknown) {
  if (typeof value !== "string" || !value.trim()) return undefined;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) {
    throw new NativePublisherError("INVALID_DATE", 400, "Informe uma data válida.");
  }
  return date;
}

export async function registerNativePublisherRoutes(app: FastifyInstance, options: Options) {
  await app.register(async (scope) => {
    scope.setErrorHandler((error, _request, reply) => {
      if (error instanceof NativePublisherError || error instanceof AuthError) {
        return reply.code(error.statusCode).send({ code: error.code, message: error.message });
      }
      if (error instanceof z.ZodError) {
        return reply.code(400).send({
          code: "INVALID_PUBLISHER_INPUT",
          message: error.issues[0]?.message || "Dados inválidos.",
        });
      }
      const message = error instanceof Error ? error.message : "Falha no Publisher nativo.";
      return reply.code(500).send({
        code: "NATIVE_PUBLISHER_INTERNAL_ERROR",
        message: process.env.NODE_ENV === "development" ? message : "Não foi possível concluir a operação.",
      });
    });

    scope.get("/api/v1/native-publisher/connections", async (request) => {
      const current = await context(options, request);
      const brandId = z.string().uuid().optional().parse(
        (request.query as { brandId?: unknown })?.brandId || undefined,
      );
      if (brandId) await requireBrand(options, request, brandId);
      return {
        connections: await options.publisher.listConnections(current.organization.id, brandId),
      };
    });

    scope.get("/api/v1/native-publisher/content/:id/quality", async (request) => {
      const current = await context(options, request);
      const id = z.string().uuid().parse((request.params as { id: string }).id);
      const content = await options.content.getForOrganization(id, current.organization.id);
      return options.publisher.qualityReport(current.organization.id, content);
    });

    scope.post(
      "/api/v1/native-publisher/facebook/connect",
      { config: { rateLimit: { max: 12, timeWindow: "10 minutes" } } },
      async (request) => {
        const input = NativeMetaConnectRequestSchema.parse(request.body);
        const { current } = await requireBrand(options, request, input.brandId);
        return options.publisher.createMetaAuthorizationUrl(
          current.organization.id,
          input.brandId,
          "facebook",
        );
      },
    );

    scope.get("/api/v1/native-publisher/facebook/callback", async (request, reply) => {
      const query = request.query as { state?: string; code?: string; error?: string };
      const target = await options.publisher.completeFacebookAuthorization(query);
      return reply.redirect(target);
    });

    scope.get("/api/v1/native-publisher/facebook/candidates", async (request) => {
      const current = await context(options, request);
      const selectionId = z.string().uuid().parse(
        (request.query as { selection?: unknown }).selection,
      );
      return {
        pages: await options.publisher.listFacebookCandidates(
          current.organization.id,
          selectionId,
        ),
      };
    });

    scope.post("/api/v1/native-publisher/facebook/select", async (request) => {
      const current = await context(options, request);
      const input = z.object({
        selectionId: z.string().uuid(),
        pageId: z.string().min(1).max(200),
      }).parse(request.body);
      return options.publisher.selectFacebookPage(
        current.organization.id,
        input.selectionId,
        input.pageId,
      );
    });

    scope.post(
      "/api/v1/native-publisher/threads/connect",
      { config: { rateLimit: { max: 12, timeWindow: "10 minutes" } } },
      async (request) => {
        const input = NativeMetaConnectRequestSchema.parse(request.body);
        const { current } = await requireBrand(options, request, input.brandId);
        return options.publisher.createMetaAuthorizationUrl(
          current.organization.id,
          input.brandId,
          "threads",
        );
      },
    );

    scope.get("/api/v1/native-publisher/threads/callback", async (request, reply) => {
      const query = request.query as { state?: string; code?: string; error?: string };
      const target = await options.publisher.completeThreadsAuthorization(query);
      return reply.redirect(target);
    });

    scope.post("/api/v1/native-publisher/disconnect", async (request) => {
      const input = z.object({
        brandId: z.string().uuid(),
        platform: NativeSocialPlatformSchema,
      }).parse(request.body);
      const { current } = await requireBrand(options, request, input.brandId);
      return options.publisher.disconnect(
        current.organization.id,
        input.brandId,
        input.platform,
      );
    });

    scope.post(
      "/api/v1/native-publisher/publications",
      { config: { rateLimit: { max: 20, timeWindow: "10 minutes" } } },
      async (request, reply) => {
        const input = NativeScheduleRequestSchema.parse(request.body);
        const current = await context(options, request);
        const content = await options.content.getForOrganization(
          input.contentRequestId,
          current.organization.id,
        );
        await requireBrand(options, request, content.brandId);
        const result = await options.publisher.schedule(current.organization.id, input);
        return reply.code(201).send(result);
      },
    );

    scope.get("/api/v1/native-publisher/publications", async (request) => {
      const current = await context(options, request);
      const query = request.query as { brandId?: unknown; from?: unknown; to?: unknown };
      const brandId = z.string().uuid().optional().parse(query.brandId || undefined);
      if (brandId) await requireBrand(options, request, brandId);
      return {
        publications: await options.publisher.listPublications(current.organization.id, {
          brandId,
          from: dateQuery(query.from),
          to: dateQuery(query.to),
        }),
      };
    });

    scope.post("/api/v1/native-publisher/publications/:id/cancel", async (request) => {
      const current = await context(options, request);
      const id = z.string().uuid().parse((request.params as { id: string }).id);
      return options.publisher.cancel(current.organization.id, id);
    });

    scope.post("/api/v1/native-publisher/publications/:id/retry", async (request) => {
      const current = await context(options, request);
      const id = z.string().uuid().parse((request.params as { id: string }).id);
      return options.publisher.retry(current.organization.id, id);
    });

    scope.post("/api/v1/native-publisher/publications/:id/analytics/refresh", async (request) => {
      const current = await context(options, request);
      const id = z.string().uuid().parse((request.params as { id: string }).id);
      return options.publisher.refreshAnalytics(current.organization.id, id);
    });

    scope.get("/api/v1/native-publisher/brands/:brandId/insights", async (request) => {
      const brandId = z.string().uuid().parse((request.params as { brandId: string }).brandId);
      const { current } = await requireBrand(options, request, brandId);
      return options.publisher.brandInsights(current.organization.id, brandId);
    });

    scope.get("/api/v1/native-publisher/calendar", async (request) => {
      const current = await context(options, request);
      const query = request.query as { brandId?: unknown; from?: unknown; to?: unknown };
      const brandId = z.string().uuid().optional().parse(query.brandId || undefined);
      if (brandId) await requireBrand(options, request, brandId);
      const publications = await options.publisher.listPublications(current.organization.id, {
        brandId,
        from: dateQuery(query.from),
        to: dateQuery(query.to),
      });
      const items = await Promise.all(publications.map(async (publication) => {
        const content = await options.content.getForOrganization(
          publication.contentRequestId,
          current.organization.id,
        );
        return {
          ...publication,
          contentTitle:
            content.output?.title ||
            content.output?.hook ||
            content.brief.split("\n").find(Boolean) ||
            "Conteúdo MODO",
          channel: content.channel,
        };
      }));
      return { items };
    });
  });
}
