import pg, { type Pool } from "pg";

const { Pool: PgPool } = pg;

export class VideoApprovalPublisherGuard {
  private readonly pool?: Pool;

  constructor(options: { databaseUrl?: string; databaseSsl?: boolean } = {}) {
    if (options.databaseUrl) {
      this.pool = new PgPool({
        connectionString: options.databaseUrl,
        ssl: options.databaseSsl ? { rejectUnauthorized: false } : undefined,
        max: 1,
      });
    }
  }

  async close() {
    await this.pool?.end();
  }

  async canPublish(videoProjectId: string) {
    if (!this.pool) return true;
    const result = await this.pool.query<{ approval_status: string }>(
      `SELECT approval_status FROM modo_video_approvals WHERE video_project_id=$1 LIMIT 1`,
      [videoProjectId],
    );
    // Ausência de linha significa projeto legado, anterior ao review granular.
    // Esses vídeos já eram publicáveis na V1.3 e permanecem compatíveis.
    const row = result.rows[0];
    return !row || row.approval_status === "approved";
  }
}
