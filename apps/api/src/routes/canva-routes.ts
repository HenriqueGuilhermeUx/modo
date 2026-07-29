import type { FastifyInstance, FastifyRequest } from "fastify";
import { AuthError, type AuthService } from "../services/auth-service.js";
import {
  CanvaError,
  type CanvaService,
} from "../services/canva-service.js";
import type { ContentAssetService } from "../services/content-asset-service.js";
import { ContentError, type ContentService } from "../services/content-service.js";

interface Options {
  auth: AuthService;
  content: ContentService;
  assets: ContentAssetService;
  canva: CanvaService;
}

function bearerToken(request: FastifyRequest) {
  const value = request.headers.authorization;
  if (!value?.startsWith("Bearer ")) {
    throw new AuthError("UNAUTHORIZED", 401, "Faça login para continuar.");
  }
  return value.slice(7).trim();
}

function dimensions(contentType: string) {
  if (contentType === "story" || contentType === "short_video_script") {
    return { width: 1080, height: 1920 };
  }
  return { width: 1080, height: 1350 };
}

function publicTokenFromUrl(value: string | null | undefined) {
  if (!value) return "";
  try {
    return new URL(value).pathname.split("/").filter(Boolean).at(-1) || "";
  } catch {
    return "";
  }
}

export async function registerCanvaRoutes(app: FastifyInstance, options: Options) {
  await app.register(async (scope) => {
    scope.setErrorHandler((error, _request, reply) => {
      if (
        error instanceof CanvaError ||
        error instanceof AuthError ||
        error instanceof ContentError
      ) {
        return reply.code(error.statusCode).send({ code: error.code, message: error.message });
      }
      const message = error instanceof Error ? error.message : "Não foi possível concluir a operação no Canva.";
      return reply.code(500).send({
        code: "CANVA_INTERNAL_ERROR",
        message: process.env.NODE_ENV === "development"
          ? message
          : "Não foi possível concluir a operação no Canva.",
      });
    });

    scope.get("/api/v1/canva/status", async (request) => {
      const context = await options.auth.authenticate(bearerToken(request));
      return options.canva.getStatus(context.organization.id);
    });

    scope.post("/api/v1/canva/connect", async (request) => {
      const context = await options.auth.authenticate(bearerToken(request));
      const contentRequestId = String(
        (request.body as { contentRequestId?: unknown } | undefined)?.contentRequestId || "",
      ).trim();
      if (contentRequestId) {
        await options.content.getForOrganization(contentRequestId, context.organization.id);
      }
      return options.canva.createAuthorizationUrl(
        context.organization.id,
        contentRequestId || undefined,
      );
    });

    scope.get("/api/v1/canva/callback", async (request, reply) => {
      const query = request.query as {
        state?: string;
        code?: string;
        error?: string;
        error_description?: string;
      };
      const target = await options.canva.completeAuthorization({
        state: query.state,
        code: query.code,
        error: query.error,
        errorDescription: query.error_description,
      });
      return reply.redirect(target);
    });

    scope.post("/api/v1/canva/disconnect", async (request) => {
      const context = await options.auth.authenticate(bearerToken(request));
      return options.canva.disconnect(context.organization.id);
    });

    scope.get("/api/v1/content-requests/:id/canva-design", async (request) => {
      const context = await options.auth.authenticate(bearerToken(request));
      const id = (request.params as { id: string }).id;
      await options.content.getForOrganization(id, context.organization.id);
      return { design: await options.canva.getDesign(context.organization.id, id) };
    });

    scope.post(
      "/api/v1/content-requests/:id/canva-design",
      { config: { rateLimit: { max: 8, timeWindow: "5 minutes" } } },
      async (request, reply) => {
        const context = await options.auth.authenticate(bearerToken(request));
        const id = (request.params as { id: string }).id;
        const content = await options.content.getForOrganization(id, context.organization.id);
        if (content.status !== "approved" || !content.output) {
          throw new CanvaError(
            "CONTENT_NOT_APPROVED",
            409,
            "Apenas conteúdos aprovados podem gerar uma versão no Canva.",
          );
        }
        if (content.output.imageStatus !== "generated") {
          throw new CanvaError(
            "IMAGE_NOT_APPROVED",
            409,
            "A imagem precisa estar concluída antes de criar a versão no Canva.",
          );
        }
        const primaryToken = publicTokenFromUrl(content.output.imageUrl);
        const asset = (
          primaryToken
            ? await options.assets.getForRequestByToken(context.organization.id, id, primaryToken)
            : null
        ) || await options.assets.getLatestForRequest(context.organization.id, id);
        if (!asset) {
          throw new CanvaError(
            "CONTENT_ASSET_NOT_FOUND",
            404,
            "A imagem aprovada não foi encontrada. Gere uma nova versão antes de continuar.",
          );
        }
        const brand = (await options.auth.listBrands(context.organization.id))
          .find((item) => item.id === content.brandId);
        if (!brand) throw new AuthError("BRAND_NOT_FOUND", 404, "Marca não encontrada.");
        const size = dimensions(content.contentType);
        const design = await options.canva.createApprovedDesign({
          accountId: context.organization.id,
          contentRequestId: id,
          title: `MODO · ${brand.name} · ${content.output.title}`,
          assetName: `${brand.name} - ${content.output.title}`,
          mimeType: asset.mimeType,
          data: asset.data,
          width: size.width,
          height: size.height,
        });
        return reply.code(201).send({ design });
      },
    );
  });
}
