import { VideoProjectCreateSchema } from "@modo/contracts/video";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { AuthError, AuthService } from "../services/auth-service.js";
import { ContentError, ContentService } from "../services/content-service.js";
import { VideoError, VideoService } from "../services/video-service.js";

interface Options {
  databaseUrl?: string;
  databaseSsl?: boolean;
  publicApiUrl?: string;
}

function bearerToken(request: FastifyRequest) {
  const value = request.headers.authorization;
  if (!value?.startsWith("Bearer ")) {
    throw new AuthError("UNAUTHORIZED", 401, "Faça login para continuar.");
  }
  return value.slice(7).trim();
}

function parseRange(value: string | undefined, size: number) {
  if (!value?.startsWith("bytes=")) return null;
  const [startRaw, endRaw] = value.slice(6).split("-", 2);
  let start = startRaw ? Number.parseInt(startRaw, 10) : Number.NaN;
  let end = endRaw ? Number.parseInt(endRaw, 10) : Number.NaN;

  if (Number.isNaN(start) && !Number.isNaN(end)) {
    const suffix = Math.min(size, end);
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    if (Number.isNaN(start)) return null;
    if (Number.isNaN(end)) end = size - 1;
  }

  if (start < 0 || start >= size || end < start) return null;
  return { start, end: Math.min(end, size - 1) };
}

export async function registerVideoRoutes(app: FastifyInstance, options: Options) {
  const auth = new AuthService({
    databaseUrl: options.databaseUrl,
    databaseSsl: options.databaseSsl,
  });
  const content = new ContentService({
    databaseUrl: options.databaseUrl,
    databaseSsl: options.databaseSsl,
  });
  const video = new VideoService({
    databaseUrl: options.databaseUrl,
    databaseSsl: options.databaseSsl,
    publicApiUrl: options.publicApiUrl,
  });

  await Promise.all([auth.initialize(), content.initialize(), video.initialize()]);
  app.addHook("onClose", async () => {
    await Promise.all([auth.close(), content.close(), video.close()]);
  });

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof VideoError || error instanceof AuthError || error instanceof ContentError) {
      return reply.code(error.statusCode).send({ code: error.code, message: error.message });
    }
    if (error instanceof z.ZodError) {
      return reply.code(400).send({ code: "VIDEO_INVALID_INPUT", message: "Revise os dados do vídeo e tente novamente." });
    }
    request.log.error({ error }, "MODO Video error");
    return reply.code(500).send({ code: "VIDEO_INTERNAL_ERROR", message: "Não foi possível concluir a operação de vídeo." });
  });

  async function context(request: FastifyRequest) {
    return auth.authenticate(bearerToken(request));
  }

  async function renderContext(request: FastifyRequest, projectId: string) {
    const current = await context(request);
    const project = await video.getForOrganization(projectId, current.organization.id);
    const contentRequest = await content.getForOrganization(project.contentRequestId, current.organization.id);
    const brands = await auth.listBrands(current.organization.id);
    const brand = brands.find((item) => item.id === project.brandId);
    if (!brand) throw new AuthError("BRAND_NOT_FOUND", 404, "Marca não encontrada nesta organização.");
    return {
      current,
      project,
      contentRequest,
      brand,
      title: contentRequest.output?.title || contentRequest.output?.hook || "Conteúdo MODO",
    };
  }

  app.get("/api/v1/public/videos/:token", async (request, reply) => {
    const token = z.string().uuid().parse((request.params as { token: string }).token);
    const data = await video.getPublic(token);
    if (!data) return reply.code(404).send({ message: "Vídeo não encontrado." });

    const range = parseRange(request.headers.range, data.length);
    reply.header("accept-ranges", "bytes");
    reply.header("content-type", "video/mp4");
    reply.header("cache-control", "public, max-age=31536000, immutable");
    reply.header("cross-origin-resource-policy", "cross-origin");

    if (range) {
      const chunk = data.subarray(range.start, range.end + 1);
      return reply
        .code(206)
        .header("content-range", `bytes ${range.start}-${range.end}/${data.length}`)
        .header("content-length", String(chunk.length))
        .send(chunk);
    }

    return reply.header("content-length", String(data.length)).send(data);
  });

  app.get("/api/v1/video/health", async () => ({
    status: "ok",
    renderer: "remotion",
    storage: video.storage,
    gpuRequired: false,
    output: "video/mp4",
    aspectRatio: "9:16",
    durations: [15, 30, 45],
    fps: 30,
  }));

  app.get("/api/v1/video-projects", async (request) => {
    const current = await context(request);
    const brandId = z.string().uuid().optional().parse((request.query as { brandId?: string }).brandId);
    if (brandId) {
      const brands = await auth.listBrands(current.organization.id);
      if (!brands.some((brand) => brand.id === brandId)) {
        throw new AuthError("BRAND_NOT_FOUND", 404, "Marca não encontrada nesta organização.");
      }
    }
    return { projects: await video.list(current.organization.id, brandId) };
  });

  app.get("/api/v1/video-projects/by-content/:contentRequestId", async (request) => {
    const current = await context(request);
    const contentRequestId = z.string().uuid().parse((request.params as { contentRequestId: string }).contentRequestId);
    await content.getForOrganization(contentRequestId, current.organization.id);
    return { project: await video.latestForContent(current.organization.id, contentRequestId) };
  });

  app.get("/api/v1/video-projects/:id", async (request) => {
    const current = await context(request);
    const id = z.string().uuid().parse((request.params as { id: string }).id);
    return { project: await video.getForOrganization(id, current.organization.id) };
  });

  app.post(
    "/api/v1/video-projects",
    { config: { rateLimit: { max: 8, timeWindow: "10 minutes" } } },
    async (request, reply) => {
      const current = await context(request);
      const input = VideoProjectCreateSchema.parse(request.body);
      const contentRequest = await content.getForOrganization(input.contentRequestId, current.organization.id);
      const brands = await auth.listBrands(current.organization.id);
      const brand = brands.find((item) => item.id === contentRequest.brandId);
      if (!brand) throw new AuthError("BRAND_NOT_FOUND", 404, "Marca não encontrada nesta organização.");

      const project = await video.createProject({
        organizationId: current.organization.id,
        content: contentRequest,
        durationSeconds: input.durationSeconds,
        captions: input.captions,
      });
      void video.enqueueRender({
        id: project.id,
        organizationId: current.organization.id,
        brandName: brand.name,
        title: contentRequest.output?.title || contentRequest.output?.hook || "Conteúdo MODO",
      });
      return reply.code(202).send({ project });
    },
  );

  app.post("/api/v1/video-projects/:id/retry", async (request) => {
    const id = z.string().uuid().parse((request.params as { id: string }).id);
    const found = await renderContext(request, id);
    const project = await video.retry({
      id,
      organizationId: found.current.organization.id,
      brandName: found.brand.name,
      title: found.title,
    });
    return { project };
  });

  app.post("/api/v1/video-projects/:id/cancel", async (request) => {
    const current = await context(request);
    const id = z.string().uuid().parse((request.params as { id: string }).id);
    return { project: await video.cancel(id, current.organization.id) };
  });
}
