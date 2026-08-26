import type { ContentRequest, GeneratedContent } from "@modo/contracts/content";
import type {
  VideoDurationSeconds,
  VideoProject,
  VideoScene,
  VideoSceneMotion,
  VideoSceneVisualType,
} from "@modo/contracts/video";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import pg, { type Pool } from "pg";
import {
  OpenAiVideoVisualProvider,
  type VideoVisualProvider,
  type VideoVisualProviderName,
} from "../providers/video-visual-provider.js";
import {
  OpenAiVideoVoiceProvider,
  type VideoVoiceProvider,
  type VideoVoiceProviderName,
} from "../providers/video-voice-provider.js";

const { Pool: PgPool } = pg;

interface VideoServiceOptions {
  databaseUrl?: string;
  databaseSsl?: boolean;
  publicApiUrl?: string;
  openAiApiKey?: string;
  voiceModel?: string;
  voiceName?: string;
  voiceProvider?: VideoVoiceProvider;
  videoImageModel?: string;
  videoImageQuality?: "low" | "medium" | "high";
  visualProvider?: VideoVisualProvider;
}

type VideoRow = {
  id: string;
  public_token: string;
  organization_id: string;
  brand_id: string;
  content_request_id: string;
  duration_seconds: number;
  captions: boolean;
  voiceover: boolean;
  voice_provider: VideoVoiceProviderName | null;
  visual_provider: VideoVisualProviderName | null;
  status: VideoProject["status"];
  scenes: VideoScene[];
  output_data: Buffer | null;
  error: string | null;
  created_at: Date;
  updated_at: Date;
};

type SceneAssetKind = "image" | "audio";

type SceneAssetRow = {
  id: string;
  public_token: string;
  video_project_id: string;
  organization_id: string;
  scene_index: number;
  kind: SceneAssetKind;
  mime_type: string;
  data: Buffer;
  provider: string;
  revision: number;
  created_at: Date;
};

type MemorySceneAsset = {
  id: string;
  publicToken: string;
  videoProjectId: string;
  organizationId: string;
  sceneIndex: number;
  kind: SceneAssetKind;
  mimeType: string;
  data: Buffer;
  provider: string;
  revision: number;
  createdAt: Date;
};

type MemoryVideo = VideoRow;
type RenderScene = VideoScene & { audioUrl?: string | null };

export class VideoError extends Error {
  constructor(public readonly code: string, public readonly statusCode: number, message: string) {
    super(message);
    this.name = "VideoError";
  }
}

function sceneLimit(duration: VideoDurationSeconds) {
  if (duration === 15) return 3;
  if (duration === 30) return 5;
  return 6;
}

function motionForIndex(index: number): VideoSceneMotion {
  const motions: VideoSceneMotion[] = ["push_in", "pan_right", "zoom_out", "pan_left", "push_in", "static"];
  return motions[(index - 1) % motions.length];
}

function visualTypeFor(input: {
  visual: string;
  scene: string;
  hasAsset: boolean;
  isLast: boolean;
}): VideoSceneVisualType {
  if (input.hasAsset) return "brand_asset";
  const value = `${input.scene} ${input.visual}`.toLocaleLowerCase("pt-BR");
  if (input.isLast || /(logo|cta|chamada final|assinatura|encerramento|marca aparece)/i.test(value)) {
    return "kinetic_text";
  }
  if (/(gr[aá]fico|dados|m[eé]trica|indicador|percentual|porcentagem|estat[ií]stica|kpi|\d+%)/i.test(value)) {
    return "data_card";
  }
  if (/(tela|dashboard|interface|aplicativo|\bapp\b|software|plataforma|site|agenda|cards?|abas?|painel|celular|smartphone)/i.test(value)) {
    return "interface";
  }
  if (/(tipografia|palavras?|texto|frase|headline|lista|passos? aparecem|checklist)/i.test(value)) {
    return "kinetic_text";
  }
  return "generated_image";
}

function normalizeScene(scene: Partial<VideoScene> & Pick<VideoScene, "index" | "startFrame" | "endFrame" | "headline" | "visual" | "caption">): VideoScene {
  const imageUrl = scene.imageUrl || null;
  return {
    index: scene.index,
    startFrame: scene.startFrame,
    endFrame: scene.endFrame,
    headline: scene.headline,
    visual: scene.visual,
    caption: scene.caption,
    imageUrl,
    visualType: scene.visualType || (imageUrl ? "brand_asset" : "kinetic_text"),
    motion: scene.motion || motionForIndex(scene.index),
    assetSource: scene.assetSource || (imageUrl ? "content" : "native"),
    assetRevision: Number.isInteger(scene.assetRevision) ? Number(scene.assetRevision) : 0,
    visualPrompt: scene.visualPrompt || scene.visual || null,
  };
}

export function planVideoScenes(output: GeneratedContent, durationSeconds: VideoDurationSeconds): VideoScene[] {
  if (!output.script.length) {
    throw new VideoError(
      "VIDEO_SCRIPT_REQUIRED",
      409,
      "Este conteúdo ainda não possui roteiro de vídeo. Gere um vídeo curto na MODO antes de renderizar.",
    );
  }

  const fps = 30;
  const totalFrames = durationSeconds * fps;
  const source = output.script.slice(0, sceneLimit(durationSeconds));
  const baseFrames = Math.floor(totalFrames / source.length);
  let cursor = 0;

  return source.map((scene, index) => {
    const isFirst = index === 0;
    const isLast = index === source.length - 1;
    const sceneIndex = index + 1;
    const startFrame = cursor;
    const endFrame = isLast ? totalFrames : cursor + baseFrames;
    cursor = endFrame;
    const visualAsset = output.visualAssets.find((asset) => asset.index === sceneIndex && asset.imageUrl);
    const imageUrl = visualAsset?.imageUrl || (isFirst ? output.imageUrl : null) || null;
    const visualType = visualTypeFor({
      visual: scene.visual,
      scene: scene.scene,
      hasAsset: Boolean(imageUrl),
      isLast,
    });
    return {
      index: sceneIndex,
      startFrame,
      endFrame,
      headline: (isFirst ? output.hook : isLast ? output.cta : scene.scene).slice(0, 300),
      visual: scene.visual.slice(0, 800),
      caption: scene.voiceover.slice(0, 900),
      imageUrl,
      visualType,
      motion: motionForIndex(sceneIndex),
      assetSource: imageUrl ? "content" : visualType === "generated_image" ? "generated" : "native",
      assetRevision: 0,
      visualPrompt: scene.visual.slice(0, 1600),
    };
  });
}

function mapProject(row: VideoRow, publicApiUrl: string): VideoProject {
  return {
    id: row.id,
    organizationId: row.organization_id,
    brandId: row.brand_id,
    contentRequestId: row.content_request_id,
    durationSeconds: row.duration_seconds as VideoDurationSeconds,
    aspectRatio: "9:16",
    fps: 30,
    captions: row.captions,
    voiceover: Boolean(row.voiceover),
    voiceProvider: row.voice_provider || null,
    visualProvider: row.visual_provider || null,
    status: row.status,
    renderer: "remotion",
    scenes: row.scenes.map((scene) => normalizeScene(scene)),
    outputUrl: row.output_data ? `${publicApiUrl}/api/v1/public/videos/${row.public_token}` : null,
    mimeType: row.output_data ? "video/mp4" : null,
    error: row.error,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

export class VideoService {
  private readonly pool?: Pool;
  private readonly memory = new Map<string, MemoryVideo>();
  private readonly memorySceneAssets = new Map<string, MemorySceneAsset>();
  private readonly publicApiUrl: string;
  private readonly voiceProvider?: VideoVoiceProvider;
  private readonly visualProvider?: VideoVisualProvider;
  private bundlePromise?: Promise<string>;
  private renderQueue: Promise<void> = Promise.resolve();

  constructor(options: VideoServiceOptions = {}) {
    if (options.databaseUrl) {
      this.pool = new PgPool({
        connectionString: options.databaseUrl,
        ssl: options.databaseSsl ? { rejectUnauthorized: false } : undefined,
        max: 2,
      });
    }
    this.publicApiUrl = (options.publicApiUrl || "http://localhost:4000").replace(/\/$/, "");
    this.voiceProvider = options.voiceProvider || (options.openAiApiKey
      ? new OpenAiVideoVoiceProvider(options.openAiApiKey, options.voiceModel, options.voiceName)
      : undefined);
    this.visualProvider = options.visualProvider || (options.openAiApiKey
      ? new OpenAiVideoVisualProvider(
          options.openAiApiKey,
          options.videoImageModel || "gpt-image-2",
          options.videoImageQuality || "low",
        )
      : undefined);
  }

  get storage(): "memory" | "postgres" {
    return this.pool ? "postgres" : "memory";
  }

  get voice() {
    return {
      available: Boolean(this.voiceProvider),
      provider: this.voiceProvider?.name || null,
    };
  }

  get visuals() {
    return {
      available: Boolean(this.visualProvider),
      provider: this.visualProvider?.name || null,
      strategy: "hybrid",
    };
  }

  async initialize() {
    if (!this.pool) return;
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS modo_video_renders (
        id UUID PRIMARY KEY,
        public_token UUID NOT NULL UNIQUE,
        organization_id TEXT NOT NULL REFERENCES modo_organizations(id) ON DELETE CASCADE,
        brand_id TEXT NOT NULL REFERENCES modo_brands(id) ON DELETE CASCADE,
        content_request_id TEXT NOT NULL REFERENCES modo_content_requests(id) ON DELETE CASCADE,
        duration_seconds INTEGER NOT NULL,
        captions BOOLEAN NOT NULL DEFAULT TRUE,
        voiceover BOOLEAN NOT NULL DEFAULT FALSE,
        voice_provider TEXT,
        visual_provider TEXT,
        status TEXT NOT NULL DEFAULT 'queued',
        scenes JSONB NOT NULL DEFAULT '[]'::jsonb,
        output_data BYTEA,
        error TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      ALTER TABLE modo_video_renders ADD COLUMN IF NOT EXISTS voiceover BOOLEAN NOT NULL DEFAULT FALSE;
      ALTER TABLE modo_video_renders ADD COLUMN IF NOT EXISTS voice_provider TEXT;
      ALTER TABLE modo_video_renders ADD COLUMN IF NOT EXISTS visual_provider TEXT;
      CREATE INDEX IF NOT EXISTS modo_video_renders_content_idx
        ON modo_video_renders(organization_id, content_request_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS modo_video_renders_status_idx
        ON modo_video_renders(status, updated_at ASC);

      CREATE TABLE IF NOT EXISTS modo_video_scene_assets (
        id UUID PRIMARY KEY,
        public_token UUID NOT NULL UNIQUE,
        video_project_id UUID NOT NULL REFERENCES modo_video_renders(id) ON DELETE CASCADE,
        organization_id TEXT NOT NULL REFERENCES modo_organizations(id) ON DELETE CASCADE,
        scene_index INTEGER NOT NULL,
        kind TEXT NOT NULL,
        mime_type TEXT NOT NULL,
        data BYTEA NOT NULL,
        provider TEXT NOT NULL,
        revision INTEGER NOT NULL DEFAULT 0,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS modo_video_scene_assets_project_idx
        ON modo_video_scene_assets(video_project_id, scene_index, kind, revision DESC, created_at DESC);
      CREATE INDEX IF NOT EXISTS modo_video_scene_assets_public_idx
        ON modo_video_scene_assets(public_token);

      UPDATE modo_video_renders
        SET status='failed', error='Render interrompido por reinicialização do serviço.', updated_at=NOW()
        WHERE status='rendering';
    `);
  }

  async close() {
    await this.pool?.end();
  }

  async createProject(input: {
    organizationId: string;
    content: ContentRequest;
    durationSeconds: VideoDurationSeconds;
    captions: boolean;
    voiceover?: boolean;
  }) {
    if (input.content.organizationId !== input.organizationId) {
      throw new VideoError("VIDEO_CONTENT_NOT_FOUND", 404, "Conteúdo não encontrado nesta organização.");
    }
    if (input.content.contentType !== "short_video_script") {
      throw new VideoError("VIDEO_CONTENT_TYPE_REQUIRED", 409, "A composição de vídeo exige um roteiro de vídeo curto.");
    }
    if (!input.content.output || !["ready", "approved"].includes(input.content.status)) {
      throw new VideoError("VIDEO_CONTENT_NOT_READY", 409, "Finalize o roteiro antes de gerar o vídeo.");
    }
    if (input.voiceover && !this.voiceProvider) {
      throw new VideoError(
        "VIDEO_VOICE_UNAVAILABLE",
        503,
        "A narração PT-BR ainda não está disponível neste ambiente. Gere sem voz ou configure o provider de áudio.",
      );
    }

    const scenes = planVideoScenes(input.content.output, input.durationSeconds);
    const now = new Date();
    const row: VideoRow = {
      id: randomUUID(),
      public_token: randomUUID(),
      organization_id: input.organizationId,
      brand_id: input.content.brandId,
      content_request_id: input.content.id,
      duration_seconds: input.durationSeconds,
      captions: input.captions,
      voiceover: Boolean(input.voiceover),
      voice_provider: input.voiceover ? this.voiceProvider?.name || null : null,
      visual_provider: null,
      status: "queued",
      scenes,
      output_data: null,
      error: null,
      created_at: now,
      updated_at: now,
    };

    if (this.pool) {
      const result = await this.pool.query<VideoRow>(
        `INSERT INTO modo_video_renders(
          id, public_token, organization_id, brand_id, content_request_id,
          duration_seconds, captions, voiceover, voice_provider, visual_provider, status, scenes
        ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'queued',$11::jsonb)
        RETURNING *`,
        [
          row.id,
          row.public_token,
          row.organization_id,
          row.brand_id,
          row.content_request_id,
          row.duration_seconds,
          row.captions,
          row.voiceover,
          row.voice_provider,
          row.visual_provider,
          JSON.stringify(row.scenes),
        ],
      );
      return mapProject(result.rows[0], this.publicApiUrl);
    }

    this.memory.set(row.id, row);
    return mapProject(row, this.publicApiUrl);
  }

  async getForOrganization(id: string, organizationId: string) {
    const row = await this.rowForOrganization(id, organizationId);
    if (!row) throw new VideoError("VIDEO_PROJECT_NOT_FOUND", 404, "Projeto de vídeo não encontrado.");
    return mapProject(row, this.publicApiUrl);
  }

  async latestForContent(organizationId: string, contentRequestId: string) {
    if (this.pool) {
      const result = await this.pool.query<VideoRow>(
        `SELECT * FROM modo_video_renders
         WHERE organization_id=$1 AND content_request_id=$2
         ORDER BY created_at DESC LIMIT 1`,
        [organizationId, contentRequestId],
      );
      return result.rows[0] ? mapProject(result.rows[0], this.publicApiUrl) : null;
    }
    const rows = [...this.memory.values()]
      .filter((row) => row.organization_id === organizationId && row.content_request_id === contentRequestId)
      .sort((a, b) => b.created_at.getTime() - a.created_at.getTime());
    return rows[0] ? mapProject(rows[0], this.publicApiUrl) : null;
  }

  async list(organizationId: string, brandId?: string) {
    if (this.pool) {
      const values: unknown[] = [organizationId];
      let where = "organization_id=$1";
      if (brandId) {
        values.push(brandId);
        where += ` AND brand_id=$${values.length}`;
      }
      const result = await this.pool.query<VideoRow>(
        `SELECT * FROM modo_video_renders WHERE ${where} ORDER BY created_at DESC LIMIT 100`,
        values,
      );
      return result.rows.map((row) => mapProject(row, this.publicApiUrl));
    }
    return [...this.memory.values()]
      .filter((row) => row.organization_id === organizationId && (!brandId || row.brand_id === brandId))
      .sort((a, b) => b.created_at.getTime() - a.created_at.getTime())
      .map((row) => mapProject(row, this.publicApiUrl));
  }

  enqueueRender(input: { id: string; organizationId: string; brandName: string; title: string }) {
    this.renderQueue = this.renderQueue
      .catch(() => undefined)
      .then(async () => {
        await this.render(input);
      });
    return this.renderQueue;
  }

  async cancel(id: string, organizationId: string) {
    const row = await this.rowForOrganization(id, organizationId);
    if (!row) throw new VideoError("VIDEO_PROJECT_NOT_FOUND", 404, "Projeto de vídeo não encontrado.");
    if (!["queued", "failed"].includes(row.status)) {
      throw new VideoError("VIDEO_PROJECT_NOT_CANCELLABLE", 409, "Este render já está em processamento ou concluído.");
    }
    return this.updateStatus(id, organizationId, "cancelled", "Render cancelado pelo usuário.");
  }

  async retry(input: { id: string; organizationId: string; brandName: string; title: string }) {
    const row = await this.rowForOrganization(input.id, input.organizationId);
    if (!row) throw new VideoError("VIDEO_PROJECT_NOT_FOUND", 404, "Projeto de vídeo não encontrado.");
    if (row.status !== "failed") {
      throw new VideoError("VIDEO_PROJECT_NOT_RETRYABLE", 409, "Somente renders com falha podem ser tentados novamente.");
    }
    if (row.voiceover && !this.voiceProvider) {
      throw new VideoError("VIDEO_VOICE_UNAVAILABLE", 503, "O provider de narração não está disponível para repetir este render.");
    }
    await this.updateStatus(input.id, input.organizationId, "queued", null);
    void this.enqueueRender(input);
    return this.getForOrganization(input.id, input.organizationId);
  }

  async regenerateScene(input: {
    id: string;
    organizationId: string;
    sceneIndex: number;
    brandName: string;
  }) {
    const row = await this.rowForOrganization(input.id, input.organizationId);
    if (!row) throw new VideoError("VIDEO_PROJECT_NOT_FOUND", 404, "Projeto de vídeo não encontrado.");
    if (["queued", "rendering"].includes(row.status)) {
      throw new VideoError("VIDEO_SCENE_BUSY", 409, "Aguarde o render atual terminar antes de trocar uma cena.");
    }
    if (!this.visualProvider) {
      throw new VideoError("VIDEO_VISUAL_UNAVAILABLE", 503, "A geração visual por cena ainda não está disponível neste ambiente.");
    }

    const scenes = row.scenes.map((scene) => normalizeScene(scene));
    const position = scenes.findIndex((scene) => scene.index === input.sceneIndex);
    if (position < 0) throw new VideoError("VIDEO_SCENE_NOT_FOUND", 404, "Cena de vídeo não encontrada.");
    const current = scenes[position];
    const nextRevision = current.assetRevision + 1;

    let generated;
    try {
      generated = await this.visualProvider.generate({
        brandName: input.brandName || "MODO",
        headline: current.headline,
        visualDirection: current.visualPrompt || current.visual,
        sceneIndex: current.index,
        revision: nextRevision,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Falha ao gerar a nova cena.";
      throw new VideoError("VIDEO_SCENE_REGENERATION_FAILED", 502, message);
    }

    const asset = await this.saveSceneAsset({
      videoProjectId: row.id,
      organizationId: row.organization_id,
      sceneIndex: current.index,
      kind: "image",
      mimeType: generated.mimeType,
      data: generated.data,
      provider: generated.provider,
      revision: nextRevision,
    });
    scenes[position] = {
      ...current,
      imageUrl: this.sceneAssetUrl(asset.publicToken),
      visualType: "generated_image",
      assetSource: "generated",
      assetRevision: nextRevision,
      motion: motionForIndex(current.index + nextRevision),
    };

    return this.replaceScenesAndQueue(row, scenes, generated.provider);
  }

  async getPublic(publicToken: string) {
    if (this.pool) {
      const result = await this.pool.query<Pick<VideoRow, "output_data">>(
        `SELECT output_data FROM modo_video_renders
         WHERE public_token=$1 AND status='ready' AND output_data IS NOT NULL LIMIT 1`,
        [publicToken],
      );
      return result.rows[0]?.output_data || null;
    }
    const row = [...this.memory.values()].find((item) => item.public_token === publicToken && item.status === "ready");
    return row?.output_data || null;
  }

  async getPublicSceneAsset(publicToken: string) {
    if (this.pool) {
      const result = await this.pool.query<Pick<SceneAssetRow, "kind" | "mime_type" | "data">>(
        `SELECT kind,mime_type,data FROM modo_video_scene_assets
         WHERE public_token=$1 AND kind='image' LIMIT 1`,
        [publicToken],
      );
      const row = result.rows[0];
      return row ? { mimeType: row.mime_type, data: row.data } : null;
    }
    const asset = this.memorySceneAssets.get(publicToken);
    return asset?.kind === "image" ? { mimeType: asset.mimeType, data: asset.data } : null;
  }

  private async rowForOrganization(id: string, organizationId: string): Promise<VideoRow | null> {
    if (this.pool) {
      const result = await this.pool.query<VideoRow>(
        `SELECT * FROM modo_video_renders WHERE id=$1 AND organization_id=$2 LIMIT 1`,
        [id, organizationId],
      );
      return result.rows[0] || null;
    }
    const row = this.memory.get(id);
    return row?.organization_id === organizationId ? row : null;
  }

  private async updateStatus(
    id: string,
    organizationId: string,
    status: VideoProject["status"],
    error: string | null,
    outputData?: Buffer,
  ) {
    if (this.pool) {
      const result = await this.pool.query<VideoRow>(
        `UPDATE modo_video_renders
         SET status=$3, error=$4, output_data=COALESCE($5,output_data), updated_at=NOW()
         WHERE id=$1 AND organization_id=$2 RETURNING *`,
        [id, organizationId, status, error, outputData || null],
      );
      if (!result.rows[0]) throw new VideoError("VIDEO_PROJECT_NOT_FOUND", 404, "Projeto de vídeo não encontrado.");
      return mapProject(result.rows[0], this.publicApiUrl);
    }
    const row = this.memory.get(id);
    if (!row || row.organization_id !== organizationId) throw new VideoError("VIDEO_PROJECT_NOT_FOUND", 404, "Projeto de vídeo não encontrado.");
    const updated: MemoryVideo = {
      ...row,
      status,
      error,
      output_data: outputData || row.output_data,
      updated_at: new Date(),
    };
    this.memory.set(id, updated);
    return mapProject(updated, this.publicApiUrl);
  }

  private async replaceScenesAndQueue(
    row: VideoRow,
    scenes: VideoScene[],
    visualProvider: VideoVisualProviderName | null,
  ) {
    if (this.pool) {
      const result = await this.pool.query<VideoRow>(
        `UPDATE modo_video_renders
         SET scenes=$3::jsonb,status='queued',error=NULL,output_data=NULL,
             visual_provider=COALESCE($4,visual_provider),updated_at=NOW()
         WHERE id=$1 AND organization_id=$2 RETURNING *`,
        [row.id, row.organization_id, JSON.stringify(scenes), visualProvider],
      );
      if (!result.rows[0]) throw new VideoError("VIDEO_PROJECT_NOT_FOUND", 404, "Projeto de vídeo não encontrado.");
      return mapProject(result.rows[0], this.publicApiUrl);
    }

    const updated: MemoryVideo = {
      ...row,
      scenes,
      status: "queued",
      error: null,
      output_data: null,
      visual_provider: visualProvider || row.visual_provider,
      updated_at: new Date(),
    };
    this.memory.set(row.id, updated);
    return mapProject(updated, this.publicApiUrl);
  }

  private sceneAssetUrl(publicToken: string) {
    return `${this.publicApiUrl}/api/v1/public/video-scene-assets/${publicToken}`;
  }

  private async saveSceneAsset(input: {
    videoProjectId: string;
    organizationId: string;
    sceneIndex: number;
    kind: SceneAssetKind;
    mimeType: string;
    data: Buffer;
    provider: string;
    revision: number;
  }) {
    const id = randomUUID();
    const publicToken = randomUUID();
    if (this.pool) {
      await this.pool.query(
        `INSERT INTO modo_video_scene_assets(
          id,public_token,video_project_id,organization_id,scene_index,kind,mime_type,data,provider,revision
        ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [
          id,
          publicToken,
          input.videoProjectId,
          input.organizationId,
          input.sceneIndex,
          input.kind,
          input.mimeType,
          input.data,
          input.provider,
          input.revision,
        ],
      );
    } else {
      this.memorySceneAssets.set(publicToken, {
        id,
        publicToken,
        ...input,
        createdAt: new Date(),
      });
    }
    return { id, publicToken };
  }

  private async latestSceneAsset(
    videoProjectId: string,
    organizationId: string,
    sceneIndex: number,
    kind: SceneAssetKind,
  ): Promise<{ mimeType: string; data: Buffer; revision: number } | null> {
    if (this.pool) {
      const result = await this.pool.query<Pick<SceneAssetRow, "mime_type" | "data" | "revision">>(
        `SELECT mime_type,data,revision FROM modo_video_scene_assets
         WHERE video_project_id=$1 AND organization_id=$2 AND scene_index=$3 AND kind=$4
         ORDER BY revision DESC,created_at DESC LIMIT 1`,
        [videoProjectId, organizationId, sceneIndex, kind],
      );
      const row = result.rows[0];
      return row ? { mimeType: row.mime_type, data: row.data, revision: Number(row.revision || 0) } : null;
    }

    const assets = [...this.memorySceneAssets.values()]
      .filter((asset) =>
        asset.videoProjectId === videoProjectId &&
        asset.organizationId === organizationId &&
        asset.sceneIndex === sceneIndex &&
        asset.kind === kind,
      )
      .sort((a, b) => b.revision - a.revision || b.createdAt.getTime() - a.createdAt.getTime());
    const asset = assets[0];
    return asset ? { mimeType: asset.mimeType, data: asset.data, revision: asset.revision } : null;
  }

  private async persistPreparedScenes(row: VideoRow, scenes: VideoScene[], provider: VideoVisualProviderName | null) {
    if (this.pool) {
      const result = await this.pool.query<VideoRow>(
        `UPDATE modo_video_renders
         SET scenes=$3::jsonb,visual_provider=COALESCE($4,visual_provider),updated_at=NOW()
         WHERE id=$1 AND organization_id=$2 RETURNING *`,
        [row.id, row.organization_id, JSON.stringify(scenes), provider],
      );
      return result.rows[0] || row;
    }
    const updated: MemoryVideo = {
      ...row,
      scenes,
      visual_provider: provider || row.visual_provider,
      updated_at: new Date(),
    };
    this.memory.set(row.id, updated);
    return updated;
  }

  private async prepareVisualScenes(row: VideoRow, brandName: string) {
    const scenes = row.scenes.map((scene) => normalizeScene(scene));
    if (!this.visualProvider) return { row: { ...row, scenes }, scenes };

    let changed = false;
    let generatedAny = false;
    for (let index = 0; index < scenes.length; index += 1) {
      const scene = scenes[index];
      if (scene.visualType !== "generated_image" || scene.imageUrl) continue;
      try {
        const generated = await this.visualProvider.generate({
          brandName: brandName || "MODO",
          headline: scene.headline,
          visualDirection: scene.visualPrompt || scene.visual,
          sceneIndex: scene.index,
          revision: scene.assetRevision,
        });
        const asset = await this.saveSceneAsset({
          videoProjectId: row.id,
          organizationId: row.organization_id,
          sceneIndex: scene.index,
          kind: "image",
          mimeType: generated.mimeType,
          data: generated.data,
          provider: generated.provider,
          revision: scene.assetRevision,
        });
        scenes[index] = {
          ...scene,
          imageUrl: this.sceneAssetUrl(asset.publicToken),
          visualType: "generated_image",
          assetSource: "generated",
        };
        changed = true;
        generatedAny = true;
      } catch {
        scenes[index] = {
          ...scene,
          visualType: "kinetic_text",
          assetSource: "native",
          imageUrl: null,
        };
        changed = true;
      }
    }

    if (!changed) return { row: { ...row, scenes }, scenes };
    const persisted = await this.persistPreparedScenes(
      row,
      scenes,
      generatedAny ? this.visualProvider.name : null,
    );
    return { row: persisted, scenes };
  }

  private async renderScenes(row: VideoRow, brandName: string): Promise<{ row: VideoRow; scenes: RenderScene[] }> {
    const prepared = await this.prepareVisualScenes(row, brandName);
    const scenes: RenderScene[] = [];

    for (const scene of prepared.scenes) {
      let audioUrl: string | null = null;
      if (prepared.row.voiceover) {
        if (!this.voiceProvider) throw new Error("Provider de narração indisponível.");
        const cached = await this.latestSceneAsset(
          prepared.row.id,
          prepared.row.organization_id,
          scene.index,
          "audio",
        );
        if (cached) {
          audioUrl = `data:${cached.mimeType};base64,${cached.data.toString("base64")}`;
        } else {
          const targetDurationSeconds = Math.max(1, (scene.endFrame - scene.startFrame) / 30);
          const audio = await this.voiceProvider.synthesize({
            text: scene.caption,
            targetDurationSeconds,
            language: "pt-BR",
          });
          await this.saveSceneAsset({
            videoProjectId: prepared.row.id,
            organizationId: prepared.row.organization_id,
            sceneIndex: scene.index,
            kind: "audio",
            mimeType: audio.mimeType,
            data: audio.data,
            provider: audio.provider,
            revision: 0,
          });
          audioUrl = `data:${audio.mimeType};base64,${audio.data.toString("base64")}`;
        }
      }
      scenes.push({ ...scene, audioUrl });
    }

    return { row: prepared.row, scenes };
  }

  private async render(input: { id: string; organizationId: string; brandName: string; title: string }) {
    const row = await this.rowForOrganization(input.id, input.organizationId);
    if (!row || row.status === "cancelled") return;
    await this.updateStatus(input.id, input.organizationId, "rendering", null);
    const workdir = await mkdtemp(join(tmpdir(), "modo-video-"));
    const outputLocation = join(workdir, `${input.id}.mp4`);
    try {
      const prepared = await this.renderScenes(row, input.brandName);
      const serveUrl = await this.remotionBundle();
      const { selectComposition, renderMedia } = await import("@remotion/renderer");
      const inputProps = {
        brandName: input.brandName || "MODO",
        title: input.title || "Conteúdo MODO",
        accentColor: "#2ED19A",
        captions: prepared.row.captions,
        scenes: prepared.scenes,
      };
      const composition = await selectComposition({
        serveUrl,
        id: `ModoVideo${prepared.row.duration_seconds}`,
        inputProps,
      });
      await renderMedia({
        composition,
        serveUrl,
        codec: "h264",
        outputLocation,
        inputProps,
        pixelFormat: "yuv420p",
        concurrency: 1,
        logLevel: "warn",
      });
      const data = await readFile(outputLocation);
      await this.updateStatus(input.id, input.organizationId, "ready", null, data);
    } catch (error) {
      const message = error instanceof Error ? error.message.slice(0, 1800) : "Falha no renderer Remotion.";
      await this.updateStatus(input.id, input.organizationId, "failed", message);
    } finally {
      await rm(workdir, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  private remotionBundle() {
    if (!this.bundlePromise) {
      this.bundlePromise = (async () => {
        const { bundle } = await import("@remotion/bundler");
        const entryPoint = fileURLToPath(new URL("../video-remotion-entry.js", import.meta.url));
        return bundle({ entryPoint });
      })().catch((error) => {
        this.bundlePromise = undefined;
        throw error;
      });
    }
    return this.bundlePromise;
  }
}
