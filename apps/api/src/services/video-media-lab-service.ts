import type {
  VideoProject,
  VideoScene,
  VideoSceneMediaTransform,
  VideoSceneMediaUpdate,
  VideoSceneMediaUpload,
  VideoSceneTake,
} from "@modo/contracts/video";
import { randomUUID } from "node:crypto";
import { VideoError, VideoService } from "./video-service.js";

const IMAGE_MAX_BYTES = 12 * 1024 * 1024;
const VIDEO_MAX_BYTES = 24 * 1024 * 1024;
const MEDIA_KEYS = ["mlfx", "mlfy", "mlz", "mltrim", "mldur"] as const;

type UploadMetadata = {
  originalFileName?: string;
  durationSeconds?: number | null;
};

type RuntimeVideoService = {
  pool?: { query: (sql: string, values?: unknown[]) => Promise<{ rows: any[] }> };
  memory?: Map<string, any>;
  memorySceneAssets?: Map<string, any>;
};

export type SceneMediaState = VideoSceneMediaTransform & {
  durationSeconds: number | null;
};

function finiteNumber(value: string | null, fallback: number) {
  if (value === null || value.trim() === "") return fallback;
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

export function sceneMediaState(scene: Pick<VideoScene, "imageUrl" | "videoUrl">): SceneMediaState {
  const source = scene.videoUrl || scene.imageUrl;
  if (!source) return { focalX: 50, focalY: 50, zoom: 1, trimStartSeconds: 0, durationSeconds: null };
  try {
    const url = new URL(source);
    const duration = finiteNumber(url.searchParams.get("mldur"), Number.NaN);
    return {
      focalX: Math.min(100, Math.max(0, finiteNumber(url.searchParams.get("mlfx"), 50))),
      focalY: Math.min(100, Math.max(0, finiteNumber(url.searchParams.get("mlfy"), 50))),
      zoom: Math.min(2.5, Math.max(1, finiteNumber(url.searchParams.get("mlz"), 1))),
      trimStartSeconds: Math.min(120, Math.max(0, finiteNumber(url.searchParams.get("mltrim"), 0))),
      durationSeconds: Number.isFinite(duration) && duration > 0 ? duration : null,
    };
  } catch {
    return { focalX: 50, focalY: 50, zoom: 1, trimStartSeconds: 0, durationSeconds: null };
  }
}

function withMediaState(source: string, state: SceneMediaState) {
  const url = new URL(source);
  url.searchParams.set("mlfx", String(Math.round(state.focalX * 10) / 10));
  url.searchParams.set("mlfy", String(Math.round(state.focalY * 10) / 10));
  url.searchParams.set("mlz", String(Math.round(state.zoom * 100) / 100));
  url.searchParams.set("mltrim", String(Math.round(state.trimStartSeconds * 100) / 100));
  if (state.durationSeconds) url.searchParams.set("mldur", String(Math.round(state.durationSeconds * 100) / 100));
  else url.searchParams.delete("mldur");
  return url.toString();
}

function withoutMediaState(source: string | null) {
  if (!source) return null;
  try {
    const url = new URL(source);
    for (const key of MEDIA_KEYS) url.searchParams.delete(key);
    return url.toString();
  } catch {
    return source;
  }
}

function decodeBase64(value: string) {
  const normalized = value.replace(/\s+/g, "");
  if (!normalized || !/^[A-Za-z0-9+/]+={0,2}$/.test(normalized)) {
    throw new VideoError("VIDEO_MEDIA_INVALID_DATA", 400, "O arquivo enviado não está em Base64 válido.");
  }
  const data = Buffer.from(normalized, "base64");
  if (!data.length) throw new VideoError("VIDEO_MEDIA_EMPTY", 400, "O arquivo enviado está vazio.");
  return data;
}

function validateSignature(mimeType: VideoSceneMediaUpload["mimeType"], data: Buffer) {
  if (mimeType === "image/png") {
    return data.length >= 8 && data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  }
  if (mimeType === "image/jpeg") {
    return data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff;
  }
  if (mimeType === "image/webp") {
    return data.length >= 12 && data.subarray(0, 4).toString("ascii") === "RIFF" && data.subarray(8, 12).toString("ascii") === "WEBP";
  }
  return data.length >= 12 && data.subarray(4, 8).toString("ascii") === "ftyp";
}

function cleanFileName(value: string) {
  return value.replace(/[\\/\u0000-\u001f]/g, "_").trim().slice(0, 240) || "media";
}

export class VideoMediaLabService {
  private readonly runtime: RuntimeVideoService;

  constructor(private readonly video: VideoService, private readonly publicApiUrl: string) {
    this.runtime = video as unknown as RuntimeVideoService;
  }

  get capabilities() {
    return {
      upload: true,
      crop: true,
      zoom: true,
      trim: true,
      imageMaxBytes: IMAGE_MAX_BYTES,
      videoMaxBytes: VIDEO_MAX_BYTES,
      formats: ["image/png", "image/jpeg", "image/webp", "video/mp4"],
    };
  }

  private assertOrganization(project: VideoProject, organizationId: string) {
    if (project.organizationId !== organizationId) {
      throw new VideoError("VIDEO_PROJECT_NOT_FOUND", 404, "Projeto de vídeo não encontrado.");
    }
  }

  private sceneAssetUrl(token: string) {
    return `${this.publicApiUrl.replace(/\/$/, "")}/api/v1/public/video-scene-assets/${token}`;
  }

  private async persistScenes(project: VideoProject, organizationId: string, scenes: VideoScene[]) {
    this.assertOrganization(project, organizationId);
    if (this.runtime.pool) {
      await this.runtime.pool.query(
        `UPDATE modo_video_renders
         SET scenes=$3::jsonb,status='queued',error=NULL,output_data=NULL,updated_at=NOW()
         WHERE id=$1 AND organization_id=$2`,
        [project.id, organizationId, JSON.stringify(scenes)],
      );
    } else {
      const row = this.runtime.memory?.get(project.id);
      if (!row || row.organization_id !== organizationId) {
        throw new VideoError("VIDEO_PROJECT_NOT_FOUND", 404, "Projeto de vídeo não encontrado.");
      }
      this.runtime.memory?.set(project.id, {
        ...row,
        scenes,
        status: "queued",
        error: null,
        output_data: null,
        updated_at: new Date(),
      });
    }
    return this.video.getForOrganization(project.id, organizationId);
  }

  async updateTransform(input: {
    project: VideoProject;
    organizationId: string;
    sceneIndex: number;
    patch: VideoSceneMediaUpdate;
  }) {
    this.assertOrganization(input.project, input.organizationId);
    if (["queued", "rendering"].includes(input.project.status)) {
      throw new VideoError("VIDEO_SCENE_BUSY", 409, "Aguarde o render atual terminar antes de ajustar a mídia.");
    }
    const scene = input.project.scenes.find((item) => item.index === input.sceneIndex);
    if (!scene) throw new VideoError("VIDEO_SCENE_NOT_FOUND", 404, "Cena de vídeo não encontrada.");
    const source = scene.videoUrl || scene.imageUrl;
    if (!source) throw new VideoError("VIDEO_MEDIA_REQUIRED", 409, "Esta cena não possui imagem ou vídeo para enquadrar.");

    const current = sceneMediaState(scene);
    const next: SceneMediaState = {
      focalX: input.patch.focalX ?? current.focalX,
      focalY: input.patch.focalY ?? current.focalY,
      zoom: input.patch.zoom ?? current.zoom,
      trimStartSeconds: input.patch.trimStartSeconds ?? current.trimStartSeconds,
      durationSeconds: current.durationSeconds,
    };

    if (!scene.videoUrl && next.trimStartSeconds > 0) {
      throw new VideoError("VIDEO_MEDIA_TRIM_VIDEO_ONLY", 409, "Trim é aplicado apenas a cenas com vídeo.");
    }
    if (scene.videoUrl && next.trimStartSeconds > 0 && !next.durationSeconds) {
      throw new VideoError(
        "VIDEO_MEDIA_DURATION_REQUIRED",
        409,
        "O trim está disponível para vídeos enviados com duração conhecida. Reenvie o arquivo para habilitar este controle.",
      );
    }
    if (scene.videoUrl && next.durationSeconds) {
      const sceneSeconds = Math.max(1 / 30, (scene.endFrame - scene.startFrame) / 30);
      if (next.trimStartSeconds + sceneSeconds > next.durationSeconds + 0.05) {
        throw new VideoError(
          "VIDEO_MEDIA_TRIM_OUT_OF_RANGE",
          409,
          "O ponto inicial escolhido não deixa vídeo suficiente para preencher esta cena.",
        );
      }
    }

    const scenes = input.project.scenes.map((item) => item.index === input.sceneIndex
      ? {
          ...item,
          imageUrl: item.imageUrl ? withMediaState(item.imageUrl, next) : null,
          videoUrl: item.videoUrl ? withMediaState(item.videoUrl, next) : null,
        }
      : item);
    return this.persistScenes(input.project, input.organizationId, scenes);
  }

  async uploadAndAttach(input: {
    project: VideoProject;
    organizationId: string;
    sceneIndex: number;
    upload: VideoSceneMediaUpload;
  }) {
    this.assertOrganization(input.project, input.organizationId);
    if (["queued", "rendering"].includes(input.project.status)) {
      throw new VideoError("VIDEO_SCENE_BUSY", 409, "Aguarde o render atual terminar antes de enviar outra mídia.");
    }
    const scene = input.project.scenes.find((item) => item.index === input.sceneIndex);
    if (!scene) throw new VideoError("VIDEO_SCENE_NOT_FOUND", 404, "Cena de vídeo não encontrada.");

    const data = decodeBase64(input.upload.dataBase64);
    const isVideo = input.upload.mimeType === "video/mp4";
    const maxBytes = isVideo ? VIDEO_MAX_BYTES : IMAGE_MAX_BYTES;
    if (data.length > maxBytes) {
      throw new VideoError(
        "VIDEO_MEDIA_TOO_LARGE",
        413,
        isVideo ? "O MP4 deve ter no máximo 24 MB." : "A imagem deve ter no máximo 12 MB.",
      );
    }
    if (!validateSignature(input.upload.mimeType, data)) {
      throw new VideoError("VIDEO_MEDIA_SIGNATURE_MISMATCH", 400, "O conteúdo do arquivo não corresponde ao formato informado.");
    }

    const token = randomUUID();
    const id = randomUUID();
    const revision = scene.assetRevision + 1;
    const metadata: UploadMetadata = {
      originalFileName: cleanFileName(input.upload.fileName),
      durationSeconds: isVideo ? input.upload.durationSeconds || null : null,
    };

    if (this.runtime.pool) {
      await this.runtime.pool.query(
        `INSERT INTO modo_video_scene_assets(
          id,public_token,video_project_id,organization_id,scene_index,kind,mime_type,data,provider,revision,metadata
        ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,'upload',$9,$10::jsonb)`,
        [
          id,
          token,
          input.project.id,
          input.organizationId,
          input.sceneIndex,
          isVideo ? "video" : "image",
          input.upload.mimeType,
          data,
          revision,
          JSON.stringify(metadata),
        ],
      );
    } else {
      this.runtime.memorySceneAssets?.set(token, {
        id,
        publicToken: token,
        videoProjectId: input.project.id,
        organizationId: input.organizationId,
        sceneIndex: input.sceneIndex,
        kind: isVideo ? "video" : "image",
        mimeType: input.upload.mimeType,
        data,
        provider: "upload",
        revision,
        metadata,
        createdAt: new Date(),
      });
    }

    const selected = await this.video.selectSceneTake({
      id: input.project.id,
      organizationId: input.organizationId,
      sceneIndex: input.sceneIndex,
      token,
    });
    const initial: SceneMediaState = {
      focalX: 50,
      focalY: 50,
      zoom: 1,
      trimStartSeconds: 0,
      durationSeconds: isVideo ? input.upload.durationSeconds || null : null,
    };
    const rawUrl = this.sceneAssetUrl(token);
    const scenes = selected.scenes.map((item) => item.index === input.sceneIndex
      ? {
          ...item,
          imageUrl: isVideo ? null : withMediaState(rawUrl, initial),
          videoUrl: isVideo ? withMediaState(rawUrl, initial) : null,
          assetSource: "upload" as const,
          assetRevision: revision,
          stockCredit: null,
        }
      : item);
    return this.persistScenes(selected, input.organizationId, scenes);
  }

  private async metadataForTokens(projectId: string, organizationId: string, tokens: string[]) {
    const result = new Map<string, { provider: string; metadata: UploadMetadata | null }>();
    if (!tokens.length) return result;
    if (this.runtime.pool) {
      const query = await this.runtime.pool.query(
        `SELECT public_token,provider,metadata FROM modo_video_scene_assets
         WHERE video_project_id=$1 AND organization_id=$2 AND public_token = ANY($3::uuid[])`,
        [projectId, organizationId, tokens],
      );
      for (const row of query.rows) {
        result.set(row.public_token, { provider: row.provider, metadata: row.metadata || null });
      }
      return result;
    }
    for (const token of tokens) {
      const asset = this.runtime.memorySceneAssets?.get(token);
      if (asset && asset.videoProjectId === projectId && asset.organizationId === organizationId) {
        result.set(token, { provider: asset.provider, metadata: asset.metadata || null });
      }
    }
    return result;
  }

  async listSceneTakes(project: VideoProject, organizationId: string, sceneIndex: number): Promise<VideoSceneTake[]> {
    this.assertOrganization(project, organizationId);
    const takes = await this.video.listSceneTakes(project.id, organizationId, sceneIndex);
    const metadata = await this.metadataForTokens(project.id, organizationId, takes.map((take) => take.token));
    const scene = project.scenes.find((item) => item.index === sceneIndex);
    const activeBase = withoutMediaState(scene?.videoUrl || scene?.imageUrl || null);
    return takes.map((take) => {
      const info = metadata.get(take.token);
      const upload = info?.provider === "upload";
      const uploadMetadata = upload ? info?.metadata : null;
      return {
        ...take,
        active: withoutMediaState(take.url) === activeBase,
        selectable: upload || take.selectable,
        originalFileName: uploadMetadata?.originalFileName || null,
        durationSeconds: uploadMetadata?.durationSeconds || null,
      };
    });
  }

  async selectTake(input: {
    project: VideoProject;
    organizationId: string;
    sceneIndex: number;
    token: string;
  }) {
    this.assertOrganization(input.project, input.organizationId);
    const metadata = await this.metadataForTokens(input.project.id, input.organizationId, [input.token]);
    const info = metadata.get(input.token);
    const selected = await this.video.selectSceneTake({
      id: input.project.id,
      organizationId: input.organizationId,
      sceneIndex: input.sceneIndex,
      token: input.token,
    });
    if (info?.provider !== "upload") return selected;

    const scene = selected.scenes.find((item) => item.index === input.sceneIndex);
    if (!scene) return selected;
    const source = scene.videoUrl || scene.imageUrl;
    if (!source) return selected;
    const state: SceneMediaState = {
      focalX: 50,
      focalY: 50,
      zoom: 1,
      trimStartSeconds: 0,
      durationSeconds: info.metadata?.durationSeconds || null,
    };
    const scenes = selected.scenes.map((item) => item.index === input.sceneIndex
      ? {
          ...item,
          imageUrl: item.imageUrl ? withMediaState(item.imageUrl, state) : null,
          videoUrl: item.videoUrl ? withMediaState(item.videoUrl, state) : null,
          assetSource: "upload" as const,
          stockCredit: null,
        }
      : item);
    return this.persistScenes(selected, input.organizationId, scenes);
  }
}
