import type {
  PerformanceSignal,
  PerformanceSignalCreate,
  PerformanceSummary,
} from "@modo/contracts/signal";
import { randomUUID } from "node:crypto";
import pg, { type Pool } from "pg";

const { Pool: PgPool } = pg;

interface Options {
  databaseUrl?: string;
  databaseSsl?: boolean;
}

type SignalRow = {
  id: string;
  account_id: string;
  brand_id: string;
  content_request_id: string;
  channel: PerformanceSignal["channel"];
  reach: number;
  impressions: number;
  engagements: number;
  clicks: number;
  leads: number;
  conversions: number;
  revenue_cents: number;
  score: number;
  classification: PerformanceSignal["classification"];
  notes: string;
  created_at: Date;
};

function mapSignal(row: SignalRow): PerformanceSignal {
  return {
    id: row.id,
    accountId: row.account_id,
    brandId: row.brand_id,
    contentRequestId: row.content_request_id,
    channel: row.channel,
    reach: Number(row.reach),
    impressions: Number(row.impressions),
    engagements: Number(row.engagements),
    clicks: Number(row.clicks),
    leads: Number(row.leads),
    conversions: Number(row.conversions),
    revenueCents: Number(row.revenue_cents),
    score: Number(row.score),
    classification: row.classification,
    notes: row.notes,
    createdAt: row.created_at.toISOString(),
  };
}

function clamp(value: number) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function score(input: PerformanceSignalCreate) {
  const engagementRate = input.impressions > 0
    ? (input.engagements / input.impressions) * 100
    : 0;
  const clickRate = input.impressions > 0 ? (input.clicks / input.impressions) * 100 : 0;
  const leadRate = input.clicks > 0 ? (input.leads / input.clicks) * 100 : input.leads > 0 ? 25 : 0;
  const conversionRate = input.leads > 0
    ? (input.conversions / input.leads) * 100
    : input.conversions > 0 ? 25 : 0;
  const revenueSignal = input.revenueCents > 0 ? Math.min(20, 5 + Math.log10(input.revenueCents / 100 + 1) * 4) : 0;
  const reachSignal = input.reach > 0 ? Math.min(10, Math.log10(input.reach + 1) * 2.5) : 0;

  return clamp(
    Math.min(30, engagementRate * 4) +
    Math.min(15, clickRate * 3) +
    Math.min(18, leadRate * 0.8) +
    Math.min(20, conversionRate * 0.8) +
    revenueSignal +
    reachSignal,
  );
}

export class SignalError extends Error {
  constructor(
    public readonly code: string,
    public readonly statusCode: number,
    message: string,
  ) {
    super(message);
    this.name = "SignalError";
  }
}

export class SignalService {
  private readonly pool?: Pool;
  private readonly items: PerformanceSignal[] = [];

  constructor(options: Options = {}) {
    if (options.databaseUrl) {
      this.pool = new PgPool({
        connectionString: options.databaseUrl,
        ssl: options.databaseSsl ? { rejectUnauthorized: false } : undefined,
        max: 4,
      });
    }
  }

  async initialize() {
    if (!this.pool) return;
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS modo_performance_signals (
        id TEXT PRIMARY KEY,
        account_id TEXT NOT NULL REFERENCES modo_organizations(id) ON DELETE CASCADE,
        brand_id TEXT NOT NULL REFERENCES modo_brands(id) ON DELETE CASCADE,
        content_request_id TEXT NOT NULL REFERENCES modo_content_requests(id) ON DELETE CASCADE,
        channel TEXT NOT NULL,
        reach INTEGER NOT NULL DEFAULT 0,
        impressions INTEGER NOT NULL DEFAULT 0,
        engagements INTEGER NOT NULL DEFAULT 0,
        clicks INTEGER NOT NULL DEFAULT 0,
        leads INTEGER NOT NULL DEFAULT 0,
        conversions INTEGER NOT NULL DEFAULT 0,
        revenue_cents INTEGER NOT NULL DEFAULT 0,
        score NUMERIC NOT NULL,
        classification TEXT NOT NULL,
        notes TEXT NOT NULL DEFAULT '',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE(account_id, content_request_id, channel)
      );
      CREATE INDEX IF NOT EXISTS modo_performance_signals_brand_idx
        ON modo_performance_signals(account_id, brand_id, created_at DESC);
    `);
  }

  async close() {
    await this.pool?.end();
  }

  async record(accountId: string, input: PerformanceSignalCreate): Promise<PerformanceSignal> {
    const performanceScore = score(input);
    const classification = performanceScore >= 55 ? "performed_well" : "performed_poorly";

    if (this.pool) {
      const client = await this.pool.connect();
      try {
        await client.query("BEGIN");
        const mapping = await client.query<{ recommendation_id: string | null }>(
          `SELECT recommendation_id
           FROM modo_creative_feedback
           WHERE account_id=$1 AND content_request_id=$2 AND recommendation_id IS NOT NULL
           ORDER BY created_at ASC LIMIT 1`,
          [accountId, input.contentRequestId],
        );
        const recommendationId = mapping.rows[0]?.recommendation_id ?? null;
        const result = await client.query<SignalRow>(
          `INSERT INTO modo_performance_signals(
            id,account_id,brand_id,content_request_id,channel,reach,impressions,
            engagements,clicks,leads,conversions,revenue_cents,score,classification,notes
          ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
          ON CONFLICT(account_id,content_request_id,channel) DO UPDATE SET
            reach=EXCLUDED.reach,impressions=EXCLUDED.impressions,
            engagements=EXCLUDED.engagements,clicks=EXCLUDED.clicks,
            leads=EXCLUDED.leads,conversions=EXCLUDED.conversions,
            revenue_cents=EXCLUDED.revenue_cents,score=EXCLUDED.score,
            classification=EXCLUDED.classification,notes=EXCLUDED.notes,
            created_at=NOW()
          RETURNING *`,
          [
            randomUUID(),
            accountId,
            input.brandId,
            input.contentRequestId,
            input.channel,
            input.reach,
            input.impressions,
            input.engagements,
            input.clicks,
            input.leads,
            input.conversions,
            input.revenueCents,
            performanceScore,
            classification,
            input.notes,
          ],
        );
        await client.query(
          `INSERT INTO modo_creative_feedback(
            id,account_id,brand_id,recommendation_id,content_request_id,
            signal,score,notes,metrics
          ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)`,
          [
            randomUUID(),
            accountId,
            input.brandId,
            recommendationId,
            input.contentRequestId,
            classification,
            performanceScore,
            input.notes,
            JSON.stringify({
              channel: input.channel,
              reach: input.reach,
              impressions: input.impressions,
              engagements: input.engagements,
              clicks: input.clicks,
              leads: input.leads,
              conversions: input.conversions,
              revenueCents: input.revenueCents,
            }),
          ],
        );
        await client.query("COMMIT");
        return mapSignal(result.rows[0]);
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    }

    const now = new Date().toISOString();
    const existingIndex = this.items.findIndex(
      (item) => item.accountId === accountId &&
        item.contentRequestId === input.contentRequestId &&
        item.channel === input.channel,
    );
    const item: PerformanceSignal = {
      ...input,
      id: existingIndex >= 0 ? this.items[existingIndex].id : randomUUID(),
      accountId,
      score: performanceScore,
      classification,
      createdAt: now,
    };
    if (existingIndex >= 0) this.items[existingIndex] = item;
    else this.items.unshift(item);
    return item;
  }

  async summary(accountId: string, brandId: string): Promise<PerformanceSummary> {
    const items = this.pool
      ? await this.postgresItems(accountId, brandId)
      : this.items.filter((item) => item.accountId === accountId && item.brandId === brandId);

    const channelMap = new Map<PerformanceSignal["channel"], PerformanceSignal[]>();
    for (const item of items) {
      channelMap.set(item.channel, [...(channelMap.get(item.channel) ?? []), item]);
    }
    const channels = [...channelMap.entries()].map(([channel, channelItems]) => ({
      channel,
      items: channelItems.length,
      averageScore: channelItems.length
        ? Math.round(channelItems.reduce((total, item) => total + item.score, 0) / channelItems.length)
        : 0,
      reach: channelItems.reduce((total, item) => total + item.reach, 0),
      impressions: channelItems.reduce((total, item) => total + item.impressions, 0),
      engagements: channelItems.reduce((total, item) => total + item.engagements, 0),
      clicks: channelItems.reduce((total, item) => total + item.clicks, 0),
      leads: channelItems.reduce((total, item) => total + item.leads, 0),
      conversions: channelItems.reduce((total, item) => total + item.conversions, 0),
      revenueCents: channelItems.reduce((total, item) => total + item.revenueCents, 0),
    })).sort((a, b) => b.averageScore - a.averageScore);

    const averageScore = items.length
      ? Math.round(items.reduce((total, item) => total + item.score, 0) / items.length)
      : 0;
    const best = channels[0];
    const weakest = channels.length > 1 ? channels[channels.length - 1] : undefined;
    const insights: string[] = [];
    if (!items.length) {
      insights.push("Registre o desempenho de um conteúdo publicado para iniciar o aprendizado.");
    } else {
      if (best) insights.push(`${best.channel} é o canal com melhor sinal médio até agora (${best.averageScore}/100).`);
      if (weakest && weakest.averageScore + 15 < (best?.averageScore ?? 0)) {
        insights.push(`${weakest.channel} precisa de outro ângulo, formato ou chamada para ação.`);
      }
      const totalLeads = items.reduce((total, item) => total + item.leads, 0);
      const totalConversions = items.reduce((total, item) => total + item.conversions, 0);
      if (totalLeads > 0) insights.push(`${totalLeads} lead(s) e ${totalConversions} conversão(ões) já foram associados ao conteúdo.`);
      if (items.some((item) => item.classification === "performed_well")) {
        insights.push("Padrões dos conteúdos com melhor desempenho terão mais peso nos próximos planos criativos.");
      }
    }

    return {
      brandId,
      totalSignals: items.length,
      averageScore,
      positiveSignals: items.filter((item) => item.classification === "performed_well").length,
      negativeSignals: items.filter((item) => item.classification === "performed_poorly").length,
      channels,
      recent: items.slice(0, 20),
      insights,
    };
  }

  private async postgresItems(accountId: string, brandId: string) {
    const result = await this.pool!.query<SignalRow>(
      `SELECT * FROM modo_performance_signals
       WHERE account_id=$1 AND brand_id=$2
       ORDER BY created_at DESC LIMIT 200`,
      [accountId, brandId],
    );
    return result.rows.map(mapSignal);
  }
}
