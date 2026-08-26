import type { VideoProject, VideoProjectReview, VideoSceneReview } from "@modo/contracts/video";
import pg, { type Pool } from "pg";

const { Pool: PgPool } = pg;

type ApprovalRow = {
  video_project_id: string;
  organization_id: string;
  scene_reviews: VideoSceneReview[];
  approval_status: "pending" | "approved";
  approved_at: Date | null;
  created_at: Date;
  updated_at: Date;
};

type MemoryApproval = ApprovalRow;

export class VideoApprovalError extends Error {
  constructor(public readonly code: string, public readonly statusCode: number, message: string) {
    super(message);
    this.name = "VideoApprovalError";
  }
}

function sceneReviews(project: VideoProject, status: "pending" | "approved" = "pending"): VideoSceneReview[] {
  const reviewedAt = status === "approved" ? new Date().toISOString() : null;
  return project.scenes.map((scene) => ({ sceneIndex: scene.index, status, reviewedAt }));
}

function mapReview(row: ApprovalRow): VideoProjectReview {
  return {
    approvalStatus: row.approval_status,
    approvedAt: row.approved_at?.toISOString() ?? null,
    scenes: Array.isArray(row.scene_reviews) ? row.scene_reviews : [],
  };
}

export class VideoApprovalService {
  private readonly pool?: Pool;
  private readonly memory = new Map<string, MemoryApproval>();

  constructor(options: { databaseUrl?: string; databaseSsl?: boolean } = {}) {
    if (options.databaseUrl) {
      this.pool = new PgPool({
        connectionString: options.databaseUrl,
        ssl: options.databaseSsl ? { rejectUnauthorized: false } : undefined,
        max: 2,
      });
    }
  }

  get storage(): "memory" | "postgres" {
    return this.pool ? "postgres" : "memory";
  }

  async initialize() {
    if (!this.pool) return;
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS modo_video_approvals (
        video_project_id UUID PRIMARY KEY REFERENCES modo_video_renders(id) ON DELETE CASCADE,
        organization_id TEXT NOT NULL REFERENCES modo_organizations(id) ON DELETE CASCADE,
        scene_reviews JSONB NOT NULL DEFAULT '[]'::jsonb,
        approval_status TEXT NOT NULL DEFAULT 'pending',
        approved_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS modo_video_approvals_org_idx
        ON modo_video_approvals(organization_id, updated_at DESC);
    `);
  }

  async close() {
    await this.pool?.end();
  }

  async decorate(project: VideoProject, initialStatus?: "pending" | "approved"): Promise<VideoProject> {
    const review = await this.ensure(project, initialStatus);
    return { ...project, review };
  }

  async ensure(project: VideoProject, initialStatus?: "pending" | "approved"): Promise<VideoProjectReview> {
    const inferred = initialStatus || (project.status === "ready" ? "approved" : "pending");
    if (this.pool) {
      const existing = await this.pool.query<ApprovalRow>(
        `SELECT * FROM modo_video_approvals
         WHERE video_project_id=$1 AND organization_id=$2 LIMIT 1`,
        [project.id, project.organizationId],
      );
      if (existing.rows[0]) return this.reconcile(project, existing.rows[0]);
      const now = inferred === "approved" ? new Date() : null;
      const result = await this.pool.query<ApprovalRow>(
        `INSERT INTO modo_video_approvals(
          video_project_id,organization_id,scene_reviews,approval_status,approved_at
        ) VALUES($1,$2,$3::jsonb,$4,$5)
        ON CONFLICT(video_project_id) DO NOTHING
        RETURNING *`,
        [project.id, project.organizationId, JSON.stringify(sceneReviews(project, inferred)), inferred, now],
      );
      if (result.rows[0]) return mapReview(result.rows[0]);
      const raced = await this.pool.query<ApprovalRow>(
        `SELECT * FROM modo_video_approvals WHERE video_project_id=$1 AND organization_id=$2 LIMIT 1`,
        [project.id, project.organizationId],
      );
      if (!raced.rows[0]) throw new VideoApprovalError("VIDEO_REVIEW_NOT_FOUND", 404, "Revisão do vídeo não encontrada.");
      return this.reconcile(project, raced.rows[0]);
    }

    const existing = this.memory.get(project.id);
    if (existing && existing.organization_id === project.organizationId) return this.reconcile(project, existing);
    const now = new Date();
    const created: MemoryApproval = {
      video_project_id: project.id,
      organization_id: project.organizationId,
      scene_reviews: sceneReviews(project, inferred),
      approval_status: inferred,
      approved_at: inferred === "approved" ? now : null,
      created_at: now,
      updated_at: now,
    };
    this.memory.set(project.id, created);
    return mapReview(created);
  }

  async approveScene(project: VideoProject, sceneIndex: number): Promise<VideoProjectReview> {
    if (project.status !== "ready") {
      throw new VideoApprovalError("VIDEO_NOT_READY_FOR_REVIEW", 409, "Aguarde o render terminar antes de aprovar cenas.");
    }
    if (!project.scenes.some((scene) => scene.index === sceneIndex)) {
      throw new VideoApprovalError("VIDEO_SCENE_NOT_FOUND", 404, "Cena de vídeo não encontrada.");
    }
    const current = await this.ensure(project, "pending");
    const reviewedAt = new Date().toISOString();
    const reviews = project.scenes.map((scene) => {
      const previous = current.scenes.find((review) => review.sceneIndex === scene.index);
      if (scene.index === sceneIndex) return { sceneIndex, status: "approved" as const, reviewedAt };
      return previous || { sceneIndex: scene.index, status: "pending" as const, reviewedAt: null };
    });
    return this.save(project, {
      approvalStatus: "pending",
      approvedAt: null,
      scenes: reviews,
    });
  }

  async resetScene(project: VideoProject, sceneIndex: number): Promise<VideoProjectReview> {
    const current = await this.ensure(project, "pending");
    const reviews = project.scenes.map((scene) => {
      const previous = current.scenes.find((review) => review.sceneIndex === scene.index);
      if (scene.index === sceneIndex) return { sceneIndex, status: "pending" as const, reviewedAt: null };
      return previous || { sceneIndex: scene.index, status: "pending" as const, reviewedAt: null };
    });
    return this.save(project, {
      approvalStatus: "pending",
      approvedAt: null,
      scenes: reviews,
    });
  }

  async approveProject(project: VideoProject): Promise<VideoProjectReview> {
    if (project.status !== "ready" || !project.outputUrl) {
      throw new VideoApprovalError("VIDEO_NOT_READY_FOR_APPROVAL", 409, "Finalize o render antes de aprovar o vídeo.");
    }
    const current = await this.ensure(project, "pending");
    const pending = project.scenes.filter((scene) => {
      const review = current.scenes.find((item) => item.sceneIndex === scene.index);
      return review?.status !== "approved";
    });
    if (pending.length) {
      throw new VideoApprovalError(
        "VIDEO_SCENES_PENDING",
        409,
        `Aprove todas as cenas antes do vídeo final. Faltam: ${pending.map((scene) => scene.index).join(", ")}.`,
      );
    }
    return this.save(project, {
      approvalStatus: "approved",
      approvedAt: new Date().toISOString(),
      scenes: current.scenes,
    });
  }

  async requireApproved(project: VideoProject) {
    const review = await this.ensure(project);
    if (review.approvalStatus !== "approved") {
      throw new VideoApprovalError(
        "VIDEO_APPROVAL_REQUIRED",
        409,
        "Aprove as cenas e o vídeo final antes de publicar ou agendar este MP4.",
      );
    }
    return review;
  }

  private async reconcile(project: VideoProject, row: ApprovalRow): Promise<VideoProjectReview> {
    const current = mapReview(row);
    const indexes = new Set(project.scenes.map((scene) => scene.index));
    const reviews = project.scenes.map((scene) =>
      current.scenes.find((review) => review.sceneIndex === scene.index) || {
        sceneIndex: scene.index,
        status: "pending" as const,
        reviewedAt: null,
      },
    );
    const changed = reviews.length !== current.scenes.length || current.scenes.some((review) => !indexes.has(review.sceneIndex));
    if (!changed) return current;
    return this.save(project, {
      approvalStatus: "pending",
      approvedAt: null,
      scenes: reviews,
    });
  }

  private async save(project: VideoProject, review: VideoProjectReview): Promise<VideoProjectReview> {
    if (this.pool) {
      const result = await this.pool.query<ApprovalRow>(
        `UPDATE modo_video_approvals
         SET scene_reviews=$3::jsonb,approval_status=$4,approved_at=$5,updated_at=NOW()
         WHERE video_project_id=$1 AND organization_id=$2 RETURNING *`,
        [project.id, project.organizationId, JSON.stringify(review.scenes), review.approvalStatus, review.approvedAt],
      );
      if (!result.rows[0]) throw new VideoApprovalError("VIDEO_REVIEW_NOT_FOUND", 404, "Revisão do vídeo não encontrada.");
      return mapReview(result.rows[0]);
    }
    const existing = this.memory.get(project.id);
    if (!existing || existing.organization_id !== project.organizationId) {
      throw new VideoApprovalError("VIDEO_REVIEW_NOT_FOUND", 404, "Revisão do vídeo não encontrada.");
    }
    const updated: MemoryApproval = {
      ...existing,
      scene_reviews: review.scenes,
      approval_status: review.approvalStatus,
      approved_at: review.approvedAt ? new Date(review.approvedAt) : null,
      updated_at: new Date(),
    };
    this.memory.set(project.id, updated);
    return mapReview(updated);
  }
}
