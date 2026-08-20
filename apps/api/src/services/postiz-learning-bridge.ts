import pg, { type Pool } from "pg";

const { Pool: PgPool } = pg;

interface Options {
  databaseUrl?: string;
  databaseSsl?: boolean;
}

export class PostizLearningBridge {
  private readonly pool?: Pool;

  constructor(options: Options = {}) {
    if (options.databaseUrl) {
      this.pool = new PgPool({
        connectionString: options.databaseUrl,
        ssl: options.databaseSsl ? { rejectUnauthorized: false } : undefined,
        max: 2,
      });
    }
  }

  async close() {
    await this.pool?.end();
  }

  async recommendationIdForContent(
    accountId: string,
    brandId: string,
    contentRequestId: string,
  ) {
    if (!this.pool) return undefined;
    const result = await this.pool.query<{ recommendation_id: string }>(
      `SELECT recommendation_id
       FROM modo_creative_feedback
       WHERE account_id=$1
         AND brand_id=$2
         AND content_request_id=$3
         AND recommendation_id IS NOT NULL
       ORDER BY created_at ASC
       LIMIT 1`,
      [accountId, brandId, contentRequestId],
    );
    return result.rows[0]?.recommendation_id || undefined;
  }
}
