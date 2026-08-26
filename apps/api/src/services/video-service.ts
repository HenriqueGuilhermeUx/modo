import type { ContentRequest, GeneratedContent } from "@modo/contracts/content";
import type { VideoDurationSeconds, VideoProject, VideoScene } from "@modo/contracts/video";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import pg, { type Pool } from "pg";
import { OpenAiVideoVoiceProvider, type VideoVoiceProvider, type VideoVoiceProviderName } from "../providers/video-voice-provider.js";

const { Pool: PgPool } = pg;

interface VideoServiceOptions {
  databaseUrl?: string;
  databaseSsl?: boolean;
  publicApiUrl?: string;
  openAiApiKey?: string;
  voiceModel?: string;
  voiceName?: string;
  voiceProvider?: VideoVoiceProvider;
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
  status: VideoProject["status"];
  scenes: VideoScene[];
  output_data: Buffer | null;
  error: string | null;
  created_at: Date;
  updated_at: Date;
};

type MemoryVideo = VideoRow;

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
    const startFrame = cursor;
    const endFrame = isLast ? totalFrames : cursor + baseFrames;
    cursor = endFrame;
    const visualAsset = output.visualAssets.find((asset) => asset.index === index + 1 && asset.imageUrl);
    return {
      index: index + 1,
      startFrame,
      endFrame,
      headline: (isFirst ? output.hook : isLast ? output.cta : scene.scene).slice(0, 300),
      visual: scene.visual.slice(0, 800),
      caption: scene.voiceover.slice(0, 900),
      imageUrl: visualAsset?.imageUrl || output.imageUrl || null,
    };
  });
}

function narrationText(scenes: VideoScene[]) {
  return scenes
    .map((scene) => scene.caption.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("\n\n");
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
    status: row.status,
    renderer: "remotion",
    scenes: row.scenes,
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
  private readonly publicApiUrl: string;
  private readonly voiceProvider?: VideoVoiceProvider;
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
        status TEXT NOT NULL DEFAULT 'queued',
        scenes JSONB NOT NULL DEFAULT '[]'::jsonb,
        output_data BYTEA,
        error TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      ALTER TABLE modo_video_renders ADD COLUMN IF NOT EXISTS voiceover BOOLEAN NOT NULL DEFAULT FALSE;
      ALTER TABLE modo_video_renders ADD COLUMN IF NOT EXISTS voice_provider TEXT;
      CREATE INDEX IF NOT EXISTS modo_video_renders_content_idx
        ON modo_video_renders(organization_id, content_request_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS modo_video_renders_status_idx
        ON modo_video_renders(status, updated_at ASC);
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
          duration_seconds, captions, voiceover, voice_provider, status, scenes
        ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'queued',$10::jsonb)
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

  private async render(input: { id: string; organizationId: string; brandName: string; title: string }) {
    const row = await this.rowForOrganization(input.id, input.organizationId);
    if (!row || row.status === "cancelled") return;
    await this.updateStatus(input.id, input.organizationId, "rendering", null);
    const workdir = await mkdtemp(join(tmpdir(), "modo-video-"));
    const outputLocation = join(workdir, `${input.id}.mp4`);
    try {
      let audioUrl: string | null = null;
      if (row.voiceover) {
        if (!this.voiceProvider) throw new Error("Provider de narração indisponível.");
        const audio = await this.voiceProvider.synthesize({
          text: narrationText(row.scenes),
          targetDurationSeconds: row.duration_seconds,
          language: "pt-BR",
        });
        audioUrl = `data:${audio.mimeType};base64,${audio.data.toString("base64")}`;
      }

      const serveUrl = await this.remotionBundle();
      const { selectComposition, renderMedia } = await import("@remotion/renderer");
      const inputProps = {
        brandName: input.brandName || "MODO",
        title: input.title || "Conteúdo MODO",
        accentColor: "#2ED19A",
        captions: row.captions,
        audioUrl,
        scenes: row.scenes,
      };
      const composition = await selectComposition({
        serveUrl,
        id: `ModoVideo${row.duration_seconds}`,
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
