import type { FastifyInstance, FastifyRequest } from "fastify";
import { AuthError, type AuthService } from "../services/auth-service.js";
import type { ContentAssetService } from "../services/content-asset-service.js";
import { ContentError, type ContentService } from "../services/content-service.js";
import {
  InstagramError,
  type InstagramService,
} from "../services/instagram-service.js";
import { InstagramV2ComplianceService } from "../services/instagram-v2-compliance-service.js";

interface Options {
  auth: AuthService;
  content: ContentService;
  assets: ContentAssetService;
  instagram: InstagramService;
}

function bearerToken(request: FastifyRequest) {
  const value = request.headers.authorization;
  if (!value?.startsWith("Bearer ")) {
    throw new AuthError("UNAUTHORIZED", 401, "Faça login para continuar.");
  }
  return value.slice(7).trim();
}

function formSignedRequest(body: unknown) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return "";
  return String((body as { signed_request?: unknown }).signed_request || "").trim();
}

function databaseSsl() {
  return ["1", "true", "yes", "on"].includes(
    String(process.env.DATABASE_SSL || "").trim().toLowerCase(),
  );
}

function buildCaption(output: NonNullable<Awaited<ReturnType<ContentService["getForOrganization"]>>["output"]>) {
  const pieces = [
    output.hook,
    output.caption,
    output.cta,
    output.hashtags.join(" "),
  ]
    .map((item) => item.trim())
    .filter(Boolean);
  const unique: string[] = [];
  for (const piece of pieces) {
    if (!unique.some((current) => current === piece)) unique.push(piece);
  }
  return unique.join("\n\n").slice(0, 2_200);
}

export async function registerInstagramRoutes(app: FastifyInstance, options: Options) {
  const publisherCompliance = new InstagramV2ComplianceService({
    databaseUrl: process.env.DATABASE_URL,
    databaseSsl: databaseSsl(),
    clientSecret: process.env.INSTAGRAM_CLIENT_SECRET,
  });
  app.addHook("onClose", async () => publisherCompliance.close());

  await app.register(async (scope) => {
    scope.setErrorHandler((error, _request, reply) => {
      if (
        error instanceof InstagramError ||
        error instanceof AuthError ||
        error instanceof ContentError
      ) {
        return reply.code(error.statusCode).send({ code: error.code, message: error.message });
      }
      const message = error instanceof Error ? error.message : "Não foi possível concluir a operação no Instagram.";
      return reply.code(500).send({
        code: "INSTAGRAM_INTERNAL_ERROR",
        message: process.env.NODE_ENV === "development"
          ? message
          : "Não foi possível concluir a operação no Instagram.",
      });
    });

    scope.get("/api/v1/instagram/status", async (request) => {
      const context = await options.auth.authenticate(bearerToken(request));
      return options.instagram.getStatus(context.organization.id);
    });

    scope.post("/api/v1/instagram/connect", async (request) => {
      const context = await options.auth.authenticate(bearerToken(request));
      const brandId = String(
        (request.body as { brandId?: unknown } | undefined)?.brandId || "",
      ).trim();
      if (brandId) {
        const brand = (await options.auth.listBrands(context.organization.id))
          .find((item) => item.id === brandId);
        if (!brand) throw new AuthError("BRAND_NOT_FOUND", 404, "Marca não encontrada nesta organização.");
      }
      return options.instagram.createAuthorizationUrl(
        context.organization.id,
        brandId || undefined,
      );
    });

    scope.get("/api/v1/instagram/callback", async (request, reply) => {
      const query = request.query as {
        state?: string;
        code?: string;
        error?: string;
        error_description?: string;
      };
      const target = await options.instagram.completeAuthorization({
        state: query.state,
        code: query.code,
        error: query.error,
        errorDescription: query.error_description,
      });
      return reply.redirect(target);
    });

    scope.post("/api/v1/instagram/disconnect", async (request) => {
      const context = await options.auth.authenticate(bearerToken(request));
      return options.instagram.disconnect(context.organization.id);
    });

    scope.post("/api/v1/instagram/deauthorize", async (request) => {
      const signedRequest = formSignedRequest(request.body);
      if (!signedRequest) {
        throw new InstagramError(
          "INSTAGRAM_SIGNED_REQUEST_MISSING",
          400,
          "A Meta não enviou o signed_request esperado.",
        );
      }
      const response = await options.instagram.handleDeauthorize(signedRequest);
      await publisherCompliance.deleteForSignedRequest(signedRequest);
      return response;
    });

    scope.post("/api/v1/instagram/data-deletion", async (request) => {
      const signedRequest = formSignedRequest(request.body);
      if (!signedRequest) {
        throw new InstagramError(
          "INSTAGRAM_SIGNED_REQUEST_MISSING",
          400,
          "A Meta não enviou o signed_request esperado.",
        );
      }
      const response = await options.instagram.handleDataDeletionRequest(signedRequest);
      await publisherCompliance.deleteForSignedRequest(signedRequest);
      return response;
    });

    scope.post(
      "/api/v1/content-requests/:id/publish-instagram",
      { config: { rateLimit: { max: 6, timeWindow: "15 minutes" } } },
      async (request, reply) => {
        const context = await options.auth.authenticate(bearerToken(request));
        const id = (request.params as { id: string }).id;
        const content = await options.content.getForOrganization(id, context.organization.id);
        if (content.status !== "approved" || !content.output) {
          throw new InstagramError(
            "CONTENT_NOT_APPROVED",
            409,
            "Apenas conteúdos aprovados podem ser publicados no Instagram.",
          );
        }
        if (content.output.imageStatus !== "generated") {
          throw new InstagramError(
            "IMAGE_NOT_GENERATED",
            409,
            "A imagem aprovada precisa estar concluída antes da publicação.",
          );
        }

        const status = await options.instagram.getStatus(context.organization.id);
        if (!status.connected) {
          throw new InstagramError(
            "INSTAGRAM_NOT_CONNECTED",
            409,
            "Conecte uma conta profissional do Instagram antes de publicar.",
          );
        }
        if (status.brandId && status.brandId !== content.brandId) {
          throw new InstagramError(
            "INSTAGRAM_BRAND_MISMATCH",
            409,
            "A conta Instagram conectada está vinculada a outra marca da organização.",
          );
        }

        const imageUrl = await options.assets.getPublicUrlForRequest(
          context.organization.id,
          id,
          content.output.imageUrl,
        );
        if (!imageUrl) {
          throw new InstagramError(
            "CONTENT_ASSET_NOT_FOUND",
            404,
            "A imagem aprovada não foi encontrada em um endereço público da MODO.",
          );
        }

        await options.instagram.refreshTokenIfNeeded(context.organization.id);
        const publication = await options.instagram.publishPost({
          accountId: context.organization.id,
          contentRequestId: id,
          imageUrl,
          caption: buildCaption(content.output),
        });
        return reply.code(201).send({ publication });
      },
    );
  });
}
