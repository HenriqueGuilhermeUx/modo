import pg, { type Pool } from "pg";
import type { PostizService } from "./postiz-service.js";

const { Pool: PgPool } = pg;

interface Options {
  databaseUrl?: string;
  databaseSsl?: boolean;
  postiz: PostizService;
}

interface DuePublicationRow {
  id: string;
  account_id: string;
}

export interface ScheduledAnalyticsResult {
  publicationId: string;
  accountId: string;
  ok: boolean;
  brandId?: string;
  contentRequestId?: string;
  score?: number;
  learningSignal?: "performed_well" | "performed_poorly" | "neutral";
  normalized?: Record<string, number>;
  error?: string;
}

export class PostizAnalyticsScheduler {
  private readonly pool?: Pool;

  constructor(private readonly options: Options) {
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

  async refreshDue(limit = 50) {
    if (!this.pool) {
      return { processed: 0, refreshed: 0, failed: 0, results: [] as ScheduledAnalyticsResult[] };
    }

    const due = await this.pool.query<DuePublicationRow>(
      `SELECT p.id, p.account_id
       FROM modo_postiz_publications p
       WHERE p.status <> 'draft'
         AND p.created_at >= NOW() - INTERVAL '60 days'
         AND (p.scheduled_for IS NULL OR p.scheduled_for <= NOW())
         AND NOT EXISTS (
           SELECT 1
           FROM modo_postiz_analytics_snapshots s
           WHERE s.publication_id = p.id
             AND s.collected_at >= NOW() - INTERVAL '6 hours'
         )
       ORDER BY COALESCE(p.published_at, p.scheduled_for, p.created_at) DESC
       LIMIT $1`,
      [Math.max(1, Math.min(100, limit))],
    );

    const results: ScheduledAnalyticsResult[] = [];
    let refreshed = 0;
    let failed = 0;

    for (const row of due.rows) {
      try {
        const result = await this.options.postiz.refreshAnalytics(row.account_id, row.id, 30);
        refreshed += 1;
        results.push({
          publicationId: row.id,
          accountId: row.account_id,
          ok: true,
          brandId: result.publication.brandId,
          contentRequestId: result.publication.contentRequestId,
          score: result.summary.score,
          learningSignal: result.summary.learningSignal,
          normalized: result.summary.normalized,
        });
      } catch (error) {
        failed += 1;
        results.push({
          publicationId: row.id,
          accountId: row.account_id,
          ok: false,
          error: error instanceof Error ? error.message : "Falha ao atualizar analytics.",
        });
      }
    }

    return {
      processed: due.rowCount ?? due.rows.length,
      refreshed,
      failed,
      results,
    };
  }
}
