import {
  VideoProjectCreateSchema,
  VideoSceneUpdateSchema,
  type VideoProject,
} from "@modo/contracts/video";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { AuthError, AuthService } from "../services/auth-service.js";
import { ContentError, ContentService } from "../services/content-service.js";
import { VideoApprovalError, VideoApprovalService } from "../services/video-approval-service.js";
import { VideoError, VideoService } from "../services/video-service.js";

interface Options {
  databaseUrl?: string;
  databaseSsl?: boolean;
  publicApiUrl?: string;
  openAiApiKey?: string;
  videoImageModel?: string;
  videoImageQuality?: "low" | "medium" | "high";
  pexelsApiKey?: string;
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
    openAiApiKey: options.openAiApiKey,
    videoImageModel: options.videoImageModel,
    videoImageQuality: options.videoImageQuality,
    pexelsApiKey: options.pexelsApiKey,
  });
  const approvals = new VideoApprovalService({
    databaseUrl: options.databaseUrl,
    databaseSsl: options.databaseSsl,
  });

  await Promise.all([auth.initialize(), content.initialize(), video.initialize()]);
  await approvals.initialize();
  app.addHook("onClose", async () => {
    await Promise.all([auth.close(), content.close(), video.close(), approvals.close()]);
  });

  app.setErrorHandler((error, request, reply) => {
    if (
      error instanceof VideoError ||
      error instanceof VideoApprovalError ||
      error instanceof AuthError ||
      error instanceof ContentError
    ) {
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

  async function decorate(project: VideoProject | null, initialStatus?: "pending" | "approved") {
    if (!project) return null;
    return approvals.decorate(project, initialStatus);
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

  app.get("/api/v1/public/video-scene-assets/:token", async (request, reply) => {
    const token = z.string().uuid().parse((request.params as { token: string }).token);
    const asset = await video.getPublicSceneAsset(token);
    if (!asset) return reply.code(404).send({ message: "Asset visual não encontrado." });

    const range = asset.mimeType.startsWith("video/") ? parseRange(request.headers.range, asset.data.length) : null;
    reply.header("content-type", asset.mimeType);
    reply.header("content-length", String(asset.data.length));
    reply.header("cache-control", "public, max-age=31536000, immutable");
    reply.header("cross-origin-resource-policy", "cross-origin");
    if (asset.mimeType.startsWith("video/")) reply.header("accept-ranges", "bytes");

    if (range) {
      const chunk = asset.data.subarray(range.start, range.end + 1);
      return reply
        .code(206)
        .header("content-range", `bytes ${range.start}-${range.end}/${asset.data.length}`)
        .header("content-length", String(chunk.length))
        .send(chunk);
    }

    return reply.send(asset.data);
  });

  app.get("/api/v1/video/health", async () => ({
    status: "ok",
    renderer: "remotion",
    storage: video.storage,
    approvalStorage: approvals.storage,
    granularApproval: true,
    sceneEditing: true,
    scenePacing: true,
    sceneTransitions: true,
    takeLibrary: true,
    soundtrack: "native_procedural",
    soundtrackDucking: true,
    gpuRequired: false,
    output: "video/mp4",
    aspectRatio: "9:16",
    durations: [15, 30, 45],
    fps: 30,
    voice: video.voice,
    visuals: video.visuals,
    broll: video.broll,
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
    const projects = await video.list(current.organization.id, brandId);
    return { projects: await Promise.all(projects.map((project) => decorate(project))) };
  });

  app.get("/api/v1/video-projects/by-content/:contentRequestId", async (request) => {
    const current = await context(request);
    const contentRequestId = z.string().uuid().parse((request.params as { contentRequestId: string }).contentRequestId);
    await content.getForOrganization(contentRequestId, current.organization.id);
    const project = await video.latestForContent(current.organization.id, contentRequestId);
    return { project: await decorate(project) };
  });

  app.get("/api/v1/video-projects/:id", async (request) => {
    const current = await context(request);
    const id = z.string().uuid().parse((request.params as { id: string }).id);
    return { project: await decorate(await video.getForOrganization(id, current.organization.id)) };
  });

  app.get("/api/v1/video-projects/:id/scenes/:sceneIndex/takes", async (request) => {
    const current = await context(request);
    const params = request.params as { id: string; sceneIndex: string };
    const id = z.string().uuid().parse(params.id);
    const sceneIndex = z.coerce.number().int().min(1).max(12).parse(params.sceneIndex);
    const takes = await video.listSceneTakes(id, current.organization.id, sceneIndex);
    return { takes };
  });

  app.post(
    "/api/v1/video-projects/:id/scenes/:sceneIndex/takes/:token/select",
    { config: { rateLimit: { max: 20, timeWindow: "30 minutes" } } },
    async (request, reply) => {
      const params = request.params as { id: string; sceneIndex: string; token: string };
      const id = z.string().uuid().parse(params.id);
      const sceneIndex = z.coerce.number().int().min(1).max(12).parse(params.sceneIndex);
      const token = z.string().uuid().parse(params.token);
      const found = await renderContext(request, id);
      const rawProject = await video.selectSceneTake({
        id,
        organizationId: found.current.organization.id,
        sceneIndex,
        token,
      });
      const review = await approvals.resetScene(rawProject, sceneIndex);
      void video.enqueueRender({
        id,
        organizationId: found.current.organization.id,
        brandName: found.brand.name,
        title: found.title,
      });
      return reply.code(202).send({ project: { ...rawProject, review } });
    },
  );

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

      const rawProject = await video.createProject({
        organizationId: current.organization.id,
        content: contentRequest,
        durationSeconds: input.durationSeconds,
        captions: input.captions,
        voiceover: input.voiceover,
      });
      const project = await decorate(rawProject, "pending");
      void video.enqueueRender({
        id: rawProject.id,
        organizationId: current.organization.id,
        brandName: brand.name,
        title: contentRequest.output?.title || contentRequest.output?.hook || "Conteúdo MODO",
      });
      return reply.code(202).send({ project });
    },
  );

  app.patch(
    "/api/v1/video-projects/:id/scenes/:sceneIndex",
    { config: { rateLimit: { max: 20, timeWindow: "30 minutes" } } },
    async (request, reply) => {
      const id = z.string().uuid().parse((request.params as { id: string; sceneIndex: string }).id);
      const sceneIndex = z.coerce.number().int().min(1).max(12).parse(
        (request.params as { id: string; sceneIndex: string }).sceneIndex,
      );
      const parsedPatch = VideoSceneUpdateSchema.parse(request.body);
      const found = await renderContext(request, id);
      const currentScene = found.project.scenes.find((scene) => scene.index === sceneIndex);
      if (!currentScene) throw new VideoError("VIDEO_SCENE_NOT_FOUND", 404, "Cena de vídeo não encontrada.");

      const patch = { ...parsedPatch };
      if (patch.headline === currentScene.headline) delete patch.headline;
      if (patch.visual === currentScene.visual) delete patch.visual;
      if (patch.caption === currentScene.caption) delete patch.caption;
      if (patch.visualPrompt === (currentScene.visualPrompt || currentScene.visual)) delete patch.visualPrompt;
      if (patch.stockQuery === currentScene.stockQuery) delete patch.stockQuery;
      const currentMode = currentScene.visualType === "brand_asset" ? "auto" : currentScene.visualType;
      if (patch.visualMode === currentMode) delete patch.visualMode;
      if (patch.motion === currentScene.motion) delete patch.motion;
      if (patch.pace !== undefined && patch.pace === currentScene.pace) delete patch.pace;
      if (patch.transition !== undefined && patch.transition === currentScene.transition) delete patch.transition;

      if (Object.keys(patch).length === 0) {
        return reply.code(200).send({ project: await decorate(found.project) });
      }

      const rawProject = await video.updateScene({
        id,
        organizationId: found.current.organization.id,
        sceneIndex,
        patch,
      });
      const review = await approvals.resetScene(rawProject, sceneIndex);
      void video.enqueueRender({
        id,
        organizationId: found.current.organization.id,
        brandName: found.brand.name,
        title: found.title,
      });
      return reply.code(202).send({ project: { ...rawProject, review } });
    },
  );

  app.post(
    "/api/v1/video-projects/:id/scenes/:sceneIndex/regenerate",
    { config: { rateLimit: { max: 12, timeWindow: "30 minutes" } } },
    async (request, reply) => {
      const id = z.string().uuid().parse((request.params as { id: string; sceneIndex: string }).id);
      const sceneIndex = z.coerce.number().int().min(1).max(12).parse(
        (request.params as { id: string; sceneIndex: string }).sceneIndex,
      );
      const found = await renderContext(request, id);
      const rawProject = await video.regenerateScene({
        id,
        organizationId: found.current.organization.id,
        sceneIndex,
        brandName: found.brand.name,
      });
      const review = await approvals.resetScene(rawProject, sceneIndex);
      void video.enqueueRender({
        id,
        organizationId: found.current.organization.id,
        brandName: found.brand.name,
        title: found.title,
      });
      return reply.code(202).send({ project: { ...rawProject, review } });
    },
  );

  app.post("/api/v1/video-projects/:id/scenes/:sceneIndex/approve", async (request) => {
    const id = z.string().uuid().parse((request.params as { id: string; sceneIndex: string }).id);
    const sceneIndex = z.coerce.number().int().min(1).max(12).parse(
      (request.params as { id: string; sceneIndex: string }).sceneIndex,
    );
    const found = await renderContext(request, id);
    const review = await approvals.approveScene(found.project, sceneIndex);
    return { project: { ...found.project, review } };
  });

  app.post("/api/v1/video-projects/:id/approve", async (request) => {
    const id = z.string().uuid().parse((request.params as { id: string }).id);
    const found = await renderContext(request, id);
    const review = await approvals.approveProject(found.project);
    return { project: { ...found.project, review } };
  });

  app.post("/api/v1/video-projects/:id/retry", async (request) => {
    const id = z.string().uuid().parse((request.params as { id: string }).id);
    const found = await renderContext(request, id);
    const rawProject = await video.retry({
      id,
      organizationId: found.current.organization.id,
      brandName: found.brand.name,
      title: found.title,
    });
    return { project: await decorate(rawProject) };
  });

  app.post("/api/v1/video-projects/:id/cancel", async (request) => {
    const current = await context(request);
    const id = z.string().uuid().parse((request.params as { id: string }).id);
    const rawProject = await video.cancel(id, current.organization.id);
    return { project: await decorate(rawProject) };
  });
}
