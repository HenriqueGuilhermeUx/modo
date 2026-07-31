import { randomUUID } from "node:crypto";
import pg, { type Pool, type PoolClient } from "pg";

const { Pool: PgPool } = pg;

type PlanSlug = "trial" | "start" | "presenca" | "pro" | "business";
type SubscriptionStatus = "active" | "retrying" | "suspended" | "canceled";

interface Options {
  databaseUrl?: string;
  databaseSsl?: boolean;
}

interface SubscriptionRow {
  plan_slug: PlanSlug;
  status: SubscriptionStatus;
  period_start: Date;
  period_end: Date;
}

interface AggregateRow {
  runs_used: number;
  items_used: number;
}

export interface IntelligencePlanLimit {
  monthlyRuns: number;
  monthlyItems: number;
  maxItemsPerRun: number;
  maxConcurrentRuns: number;
}

export interface IntelligenceQuotaSnapshot extends IntelligencePlanLimit {
  plan: PlanSlug;
  periodStart: string;
  periodEnd: string;
  runsUsed: number;
  itemsUsed: number;
  runsRemaining: number;
  itemsRemaining: number;
  runningNow: number;
}

export const intelligencePlanLimits: Record<PlanSlug, IntelligencePlanLimit> = {
  trial: {
    monthlyRuns: 1,
    monthlyItems: 10,
    maxItemsPerRun: 10,
    maxConcurrentRuns: 1,
  },
  start: {
    monthlyRuns: 2,
    monthlyItems: 20,
    maxItemsPerRun: 10,
    maxConcurrentRuns: 1,
  },
  presenca: {
    monthlyRuns: 4,
    monthlyItems: 100,
    maxItemsPerRun: 25,
    maxConcurrentRuns: 1,
  },
  pro: {
    monthlyRuns: 10,
    monthlyItems: 500,
    maxItemsPerRun: 50,
    maxConcurrentRuns: 2,
  },
  business: {
    monthlyRuns: 30,
    monthlyItems: 3000,
    maxItemsPerRun: 100,
    maxConcurrentRuns: 3,
  },
};

export class IntelligenceQuotaError extends Error {
  constructor(
    public readonly code: string,
    public readonly statusCode: number,
    message: string,
  ) {
    super(message);
    this.name = "IntelligenceQuotaError";
  }
}

interface MemoryReservation {
  id: string;
  organizationId: string;
  requestedItems: number;
  createdAt: Date;
}

export class IntelligenceQuotaService {
  private readonly pool?: Pool;
  private readonly memoryReservations: MemoryReservation[] = [];
  private readonly memoryPeriods = new Map<string, { start: Date; end: Date }>();

  constructor(options: Options = {}) {
    if (options.databaseUrl) {
      this.pool = new PgPool({
        connectionString: options.databaseUrl,
        ssl: options.databaseSsl ? { rejectUnauthorized: false } : undefined,
        max: 3,
      });
    }
  }

  async initialize() {
    if (!this.pool) return;
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS modo_intelligence_usage (
        id TEXT PRIMARY KEY,
        organization_id TEXT NOT NULL,
        reference_id TEXT NOT NULL UNIQUE,
        requested_items INTEGER NOT NULL CHECK (requested_items > 0),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS modo_intelligence_usage_org_period_idx
        ON modo_intelligence_usage(organization_id, created_at DESC);
    `);
  }

  async close() {
    await this.pool?.end();
  }

  async usage(organizationId: string): Promise<IntelligenceQuotaSnapshot> {
    if (!this.pool) return this.memoryUsage(organizationId);
    const client = await this.pool.connect();
    try {
      const subscription = await this.loadSubscription(client, organizationId);
      const aggregate = await this.aggregate(client, organizationId, subscription);
      const runningNow = await this.runningCount(client, organizationId);
      return this.snapshot(subscription, aggregate, runningNow);
    } finally {
      client.release();
    }
  }

  async assertRetryCapacity(organizationId: string, requestedItems: number) {
    const quota = await this.usage(organizationId);
    this.assertRequestedItems(quota, requestedItems);
    this.assertConcurrentCapacity(quota);
    return quota;
  }

  async reserve(
    organizationId: string,
    requestedItems: number,
    referenceId = `intelligence:${randomUUID()}`,
  ) {
    if (!Number.isInteger(requestedItems) || requestedItems < 1) {
      throw new IntelligenceQuotaError(
        "INTELLIGENCE_INVALID_LIMIT",
        400,
        "O limite da missão precisa ser um número inteiro positivo.",
      );
    }

    if (!this.pool) {
      const usage = this.memoryUsage(organizationId);
      this.assertCapacity(usage, requestedItems);
      this.memoryReservations.push({
        id: referenceId,
        organizationId,
        requestedItems,
        createdAt: new Date(),
      });
      return { referenceId, quota: this.memoryUsage(organizationId) };
    }

    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
        `modo-intelligence:${organizationId}`,
      ]);

      const duplicate = await client.query(
        `SELECT id FROM modo_intelligence_usage WHERE reference_id=$1 LIMIT 1`,
        [referenceId],
      );
      if (duplicate.rowCount) {
        const quota = await this.usageWithinClient(client, organizationId);
        await client.query("COMMIT");
        return { referenceId, quota };
      }

      const subscription = await this.loadSubscription(client, organizationId);
      const aggregate = await this.aggregate(client, organizationId, subscription);
      const runningNow = await this.runningCount(client, organizationId);
      const quota = this.snapshot(subscription, aggregate, runningNow);
      this.assertCapacity(quota, requestedItems);

      await client.query(
        `INSERT INTO modo_intelligence_usage(id,organization_id,reference_id,requested_items)
         VALUES($1,$2,$3,$4)`,
        [randomUUID(), organizationId, referenceId, requestedItems],
      );

      const updated = this.snapshot(
        subscription,
        {
          runs_used: aggregate.runs_used + 1,
          items_used: aggregate.items_used + requestedItems,
        },
        runningNow,
      );
      await client.query("COMMIT");
      return { referenceId, quota: updated };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async release(referenceId: string) {
    if (!this.pool) {
      const index = this.memoryReservations.findIndex((item) => item.id === referenceId);
      if (index >= 0) this.memoryReservations.splice(index, 1);
      return;
    }
    await this.pool.query(
      `DELETE FROM modo_intelligence_usage WHERE reference_id=$1`,
      [referenceId],
    );
  }

  private async usageWithinClient(client: PoolClient, organizationId: string) {
    const subscription = await this.loadSubscription(client, organizationId);
    const aggregate = await this.aggregate(client, organizationId, subscription);
    const runningNow = await this.runningCount(client, organizationId);
    return this.snapshot(subscription, aggregate, runningNow);
  }

  private async loadSubscription(client: PoolClient, organizationId: string) {
    const result = await client.query<SubscriptionRow>(
      `SELECT plan_slug,status,period_start,period_end
       FROM modo_subscriptions WHERE account_id=$1 LIMIT 1`,
      [organizationId],
    );
    const subscription = result.rows[0];
    if (!subscription) {
      throw new IntelligenceQuotaError(
        "INTELLIGENCE_SUBSCRIPTION_REQUIRED",
        402,
        "É necessário ter um plano ativo para executar pesquisas de inteligência.",
      );
    }
    if (!["active", "retrying"].includes(subscription.status) || new Date() >= subscription.period_end) {
      throw new IntelligenceQuotaError(
        "INTELLIGENCE_SUBSCRIPTION_INACTIVE",
        402,
        "Seu plano não está ativo para novas pesquisas de inteligência.",
      );
    }
    return subscription;
  }

  private async aggregate(
    client: PoolClient,
    organizationId: string,
    subscription: SubscriptionRow,
  ) {
    const result = await client.query<AggregateRow>(
      `SELECT
         COUNT(*)::int AS runs_used,
         COALESCE(SUM(requested_items),0)::int AS items_used
       FROM modo_intelligence_usage
       WHERE organization_id=$1 AND created_at >= $2 AND created_at < $3`,
      [organizationId, subscription.period_start, subscription.period_end],
    );
    return result.rows[0] || { runs_used: 0, items_used: 0 };
  }

  private async runningCount(client: PoolClient, organizationId: string) {
    const result = await client.query<{ count: number }>(
      `SELECT COUNT(*)::int AS count
       FROM modo_intelligence_missions
       WHERE organization_id=$1
         AND status='running'
         AND updated_at > NOW() - INTERVAL '15 minutes'`,
      [organizationId],
    );
    return Number(result.rows[0]?.count || 0);
  }

  private snapshot(
    subscription: SubscriptionRow,
    aggregate: AggregateRow,
    runningNow: number,
  ): IntelligenceQuotaSnapshot {
    const limits = intelligencePlanLimits[subscription.plan_slug];
    const runsUsed = Number(aggregate.runs_used || 0);
    const itemsUsed = Number(aggregate.items_used || 0);
    return {
      plan: subscription.plan_slug,
      periodStart: subscription.period_start.toISOString(),
      periodEnd: subscription.period_end.toISOString(),
      ...limits,
      runsUsed,
      itemsUsed,
      runsRemaining: Math.max(0, limits.monthlyRuns - runsUsed),
      itemsRemaining: Math.max(0, limits.monthlyItems - itemsUsed),
      runningNow,
    };
  }

  private assertRequestedItems(quota: IntelligenceQuotaSnapshot, requestedItems: number) {
    if (!Number.isInteger(requestedItems) || requestedItems < 1) {
      throw new IntelligenceQuotaError(
        "INTELLIGENCE_INVALID_LIMIT",
        400,
        "O limite da missão precisa ser um número inteiro positivo.",
      );
    }
    if (requestedItems > quota.maxItemsPerRun) {
      throw new IntelligenceQuotaError(
        "INTELLIGENCE_RUN_LIMIT_EXCEEDED",
        422,
        `Seu plano permite até ${quota.maxItemsPerRun} registros por missão.`,
      );
    }
  }

  private assertConcurrentCapacity(quota: IntelligenceQuotaSnapshot) {
    if (quota.runningNow >= quota.maxConcurrentRuns) {
      throw new IntelligenceQuotaError(
        "INTELLIGENCE_CONCURRENT_LIMIT",
        409,
        "Já existe uma pesquisa em andamento. Aguarde a conclusão antes de iniciar outra.",
      );
    }
  }

  private assertCapacity(quota: IntelligenceQuotaSnapshot, requestedItems: number) {
    this.assertRequestedItems(quota, requestedItems);
    if (quota.runsRemaining < 1) {
      throw new IntelligenceQuotaError(
        "INTELLIGENCE_MONTHLY_RUNS_EXHAUSTED",
        429,
        "O limite de pesquisas de inteligência deste ciclo foi atingido.",
      );
    }
    if (requestedItems > quota.itemsRemaining) {
      throw new IntelligenceQuotaError(
        "INTELLIGENCE_MONTHLY_ITEMS_EXHAUSTED",
        429,
        `Restam ${quota.itemsRemaining} registros de inteligência neste ciclo.`,
      );
    }
    this.assertConcurrentCapacity(quota);
  }

  private memoryUsage(organizationId: string): IntelligenceQuotaSnapshot {
    let period = this.memoryPeriods.get(organizationId);
    const now = new Date();
    if (!period || now >= period.end) {
      period = {
        start: now,
        end: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000),
      };
      this.memoryPeriods.set(organizationId, period);
    }
    const entries = this.memoryReservations.filter(
      (item) =>
        item.organizationId === organizationId &&
        item.createdAt >= period!.start &&
        item.createdAt < period!.end,
    );
    const limits = intelligencePlanLimits.trial;
    const runsUsed = entries.length;
    const itemsUsed = entries.reduce((sum, item) => sum + item.requestedItems, 0);
    return {
      plan: "trial",
      periodStart: period.start.toISOString(),
      periodEnd: period.end.toISOString(),
      ...limits,
      runsUsed,
      itemsUsed,
      runsRemaining: Math.max(0, limits.monthlyRuns - runsUsed),
      itemsRemaining: Math.max(0, limits.monthlyItems - itemsUsed),
      runningNow: 0,
    };
  }
}
