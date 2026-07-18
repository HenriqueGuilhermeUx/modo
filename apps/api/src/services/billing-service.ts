import {
  contentCreditCost,
  planEntitlements,
  type BillingUsage,
  type ContentUnitType,
  type CreditConsumeRequest,
  type PlanSlug,
  type UsageByType,
} from "@modo/contracts";
import { randomUUID } from "node:crypto";
import pg from "pg";
import type { Pool, PoolClient } from "pg";

const { Pool: PgPool } = pg;

interface BillingServiceOptions {
  databaseUrl?: string;
  databaseSsl?: boolean;
}

interface MemorySubscription {
  accountId: string;
  plan: PlanSlug;
  periodStart: Date;
  periodEnd: Date;
}

interface MemoryLedgerEntry {
  id: string;
  accountId: string;
  entryType: "grant" | "usage" | "adjustment";
  credits: number;
  contentType?: ContentUnitType;
  referenceId: string;
  periodStart: Date;
  metadata: Record<string, unknown>;
  createdAt: Date;
}

interface SubscriptionRow {
  account_id: string;
  plan_slug: PlanSlug;
  period_start: Date;
  period_end: Date;
}

interface UsageAggregateRow {
  credits_granted: number;
  credits_used: number;
  static_post: number;
  story: number;
  carousel: number;
  short_video_script: number;
  channel_adaptation: number;
}

export class BillingError extends Error {
  constructor(
    public readonly code: string,
    public readonly statusCode: number,
    message: string,
  ) {
    super(message);
    this.name = "BillingError";
  }
}

function addBillingMonth(date: Date) {
  const next = new Date(date.getTime());
  const originalDay = next.getUTCDate();
  next.setUTCDate(1);
  next.setUTCMonth(next.getUTCMonth() + 1);
  const lastDay = new Date(
    Date.UTC(next.getUTCFullYear(), next.getUTCMonth() + 1, 0),
  ).getUTCDate();
  next.setUTCDate(Math.min(originalDay, lastDay));
  return next;
}

function emptyUsageByType(): UsageByType {
  return {
    static_post: 0,
    story: 0,
    carousel: 0,
    short_video_script: 0,
    channel_adaptation: 0,
  };
}

export class BillingService {
  private readonly pool?: Pool;
  private readonly subscriptions = new Map<string, MemorySubscription>();
  private readonly memoryLedger: MemoryLedgerEntry[] = [];

  constructor(options: BillingServiceOptions = {}) {
    if (options.databaseUrl) {
      this.pool = new PgPool({
        connectionString: options.databaseUrl,
        ssl: options.databaseSsl ? { rejectUnauthorized: false } : undefined,
        max: 5,
      });
    }
  }

  get storage(): "memory" | "postgres" {
    return this.pool ? "postgres" : "memory";
  }

  async initialize() {
    if (!this.pool) return;

    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS modo_subscriptions (
        account_id TEXT PRIMARY KEY,
        plan_slug TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'active',
        period_start TIMESTAMPTZ NOT NULL,
        period_end TIMESTAMPTZ NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS modo_credit_ledger (
        id TEXT PRIMARY KEY,
        account_id TEXT NOT NULL REFERENCES modo_subscriptions(account_id) ON DELETE CASCADE,
        entry_type TEXT NOT NULL,
        credits INTEGER NOT NULL,
        content_type TEXT,
        reference_id TEXT NOT NULL,
        period_start TIMESTAMPTZ NOT NULL,
        metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE(account_id, entry_type, reference_id)
      );

      CREATE INDEX IF NOT EXISTS modo_credit_ledger_account_period_idx
        ON modo_credit_ledger(account_id, period_start);
    `);
  }

  async close() {
    await this.pool?.end();
  }

  async createOrUpdateDemoSubscription(
    accountId: string,
    plan: PlanSlug,
  ): Promise<BillingUsage> {
    if (this.pool) return this.createOrUpdatePostgresSubscription(accountId, plan);
    return this.createOrUpdateMemorySubscription(accountId, plan);
  }

  async getUsage(accountId: string): Promise<BillingUsage> {
    if (this.pool) return this.getPostgresUsage(accountId);
    return this.getMemoryUsage(accountId);
  }

  async consume(accountId: string, input: CreditConsumeRequest): Promise<BillingUsage> {
    if (this.pool) return this.consumePostgres(accountId, input);
    return this.consumeMemory(accountId, input);
  }

  private createOrUpdateMemorySubscription(accountId: string, plan: PlanSlug) {
    const now = new Date();
    const subscription: MemorySubscription = {
      accountId,
      plan,
      periodStart: now,
      periodEnd: addBillingMonth(now),
    };
    this.subscriptions.set(accountId, subscription);
    this.memoryLedger.push({
      id: randomUUID(),
      accountId,
      entryType: "grant",
      credits: planEntitlements[plan].monthlyCredits,
      referenceId: `period:${now.toISOString()}`,
      periodStart: now,
      metadata: { plan },
      createdAt: now,
    });
    return this.buildMemoryUsage(subscription);
  }

  private ensureMemoryCurrentPeriod(subscription: MemorySubscription) {
    const now = new Date();
    while (now >= subscription.periodEnd) {
      subscription.periodStart = new Date(subscription.periodEnd.getTime());
      subscription.periodEnd = addBillingMonth(subscription.periodEnd);
      this.memoryLedger.push({
        id: randomUUID(),
        accountId: subscription.accountId,
        entryType: "grant",
        credits: planEntitlements[subscription.plan].monthlyCredits,
        referenceId: `period:${subscription.periodStart.toISOString()}`,
        periodStart: new Date(subscription.periodStart.getTime()),
        metadata: { plan: subscription.plan, renewal: true },
        createdAt: now,
      });
    }
    return subscription;
  }

  private getMemorySubscription(accountId: string) {
    const subscription = this.subscriptions.get(accountId);
    if (!subscription) {
      throw new BillingError(
        "SUBSCRIPTION_NOT_FOUND",
        404,
        "Assinatura não encontrada para esta conta.",
      );
    }
    return this.ensureMemoryCurrentPeriod(subscription);
  }

  private buildMemoryUsage(subscription: MemorySubscription): BillingUsage {
    const entries = this.memoryLedger.filter(
      (entry) =>
        entry.accountId === subscription.accountId &&
        entry.periodStart.getTime() === subscription.periodStart.getTime(),
    );
    const usageByType = emptyUsageByType();
    let creditsGranted = 0;
    let creditsUsed = 0;

    for (const entry of entries) {
      if (entry.credits > 0) creditsGranted += entry.credits;
      if (entry.credits < 0) creditsUsed += Math.abs(entry.credits);
      if (entry.entryType === "usage" && entry.contentType) {
        usageByType[entry.contentType] += 1;
      }
    }

    return {
      accountId: subscription.accountId,
      plan: subscription.plan,
      storage: "memory",
      periodStart: subscription.periodStart.toISOString(),
      periodEnd: subscription.periodEnd.toISOString(),
      creditsGranted,
      creditsUsed,
      creditsRemaining: Math.max(0, creditsGranted - creditsUsed),
      usageByType,
      entitlements: planEntitlements[subscription.plan],
    };
  }

  private getMemoryUsage(accountId: string) {
    return this.buildMemoryUsage(this.getMemorySubscription(accountId));
  }

  private consumeMemory(accountId: string, input: CreditConsumeRequest) {
    const subscription = this.getMemorySubscription(accountId);
    const existing = this.memoryLedger.find(
      (entry) =>
        entry.accountId === accountId &&
        entry.entryType === "usage" &&
        entry.referenceId === input.referenceId,
    );
    if (existing) return this.buildMemoryUsage(subscription);

    const usage = this.buildMemoryUsage(subscription);
    this.assertCapacity(usage, input.contentType);
    this.memoryLedger.push({
      id: randomUUID(),
      accountId,
      entryType: "usage",
      credits: -contentCreditCost[input.contentType],
      contentType: input.contentType,
      referenceId: input.referenceId,
      periodStart: new Date(subscription.periodStart.getTime()),
      metadata: input.metadata ?? {},
      createdAt: new Date(),
    });
    return this.buildMemoryUsage(subscription);
  }

  private async createOrUpdatePostgresSubscription(accountId: string, plan: PlanSlug) {
    const client = await this.requirePool().connect();
    try {
      await client.query("BEGIN");
      const periodStart = new Date();
      const periodEnd = addBillingMonth(periodStart);
      await client.query(
        `INSERT INTO modo_subscriptions(account_id, plan_slug, status, period_start, period_end)
         VALUES ($1, $2, 'active', $3, $4)
         ON CONFLICT (account_id) DO UPDATE SET
           plan_slug = EXCLUDED.plan_slug,
           status = 'active',
           period_start = EXCLUDED.period_start,
           period_end = EXCLUDED.period_end,
           updated_at = NOW()`,
        [accountId, plan, periodStart, periodEnd],
      );
      await this.insertPostgresGrant(client, accountId, plan, periodStart, false);
      const usage = await this.buildPostgresUsage(client, {
        account_id: accountId,
        plan_slug: plan,
        period_start: periodStart,
        period_end: periodEnd,
      });
      await client.query("COMMIT");
      return usage;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  private async getPostgresUsage(accountId: string) {
    const client = await this.requirePool().connect();
    try {
      await client.query("BEGIN");
      const subscription = await this.lockAndRenewPostgresSubscription(client, accountId);
      const usage = await this.buildPostgresUsage(client, subscription);
      await client.query("COMMIT");
      return usage;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  private async consumePostgres(accountId: string, input: CreditConsumeRequest) {
    const client = await this.requirePool().connect();
    try {
      await client.query("BEGIN");
      const subscription = await this.lockAndRenewPostgresSubscription(client, accountId);
      const existing = await client.query(
        `SELECT id FROM modo_credit_ledger
         WHERE account_id = $1 AND entry_type = 'usage' AND reference_id = $2
         LIMIT 1`,
        [accountId, input.referenceId],
      );
      if (existing.rowCount) {
        const usage = await this.buildPostgresUsage(client, subscription);
        await client.query("COMMIT");
        return usage;
      }

      const currentUsage = await this.buildPostgresUsage(client, subscription);
      this.assertCapacity(currentUsage, input.contentType);
      await client.query(
        `INSERT INTO modo_credit_ledger(
          id, account_id, entry_type, credits, content_type, reference_id, period_start, metadata
        ) VALUES ($1, $2, 'usage', $3, $4, $5, $6, $7::jsonb)`,
        [
          randomUUID(),
          accountId,
          -contentCreditCost[input.contentType],
          input.contentType,
          input.referenceId,
          subscription.period_start,
          JSON.stringify(input.metadata ?? {}),
        ],
      );
      const usage = await this.buildPostgresUsage(client, subscription);
      await client.query("COMMIT");
      return usage;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  private async lockAndRenewPostgresSubscription(client: PoolClient, accountId: string) {
    const result = await client.query<SubscriptionRow>(
      `SELECT account_id, plan_slug, period_start, period_end
       FROM modo_subscriptions
       WHERE account_id = $1 AND status = 'active'
       FOR UPDATE`,
      [accountId],
    );
    if (!result.rowCount) {
      throw new BillingError(
        "SUBSCRIPTION_NOT_FOUND",
        404,
        "Assinatura não encontrada para esta conta.",
      );
    }

    const subscription = result.rows[0];
    let periodStart = new Date(subscription.period_start.getTime());
    let periodEnd = new Date(subscription.period_end.getTime());
    const now = new Date();
    let renewed = false;

    while (now >= periodEnd) {
      periodStart = new Date(periodEnd.getTime());
      periodEnd = addBillingMonth(periodEnd);
      renewed = true;
    }

    if (renewed) {
      await client.query(
        `UPDATE modo_subscriptions
         SET period_start = $2, period_end = $3, updated_at = NOW()
         WHERE account_id = $1`,
        [accountId, periodStart, periodEnd],
      );
      await this.insertPostgresGrant(
        client,
        accountId,
        subscription.plan_slug,
        periodStart,
        true,
      );
    }

    return {
      ...subscription,
      period_start: periodStart,
      period_end: periodEnd,
    };
  }

  private async insertPostgresGrant(
    client: PoolClient,
    accountId: string,
    plan: PlanSlug,
    periodStart: Date,
    renewal: boolean,
  ) {
    await client.query(
      `INSERT INTO modo_credit_ledger(
        id, account_id, entry_type, credits, reference_id, period_start, metadata
      ) VALUES ($1, $2, 'grant', $3, $4, $5, $6::jsonb)
      ON CONFLICT (account_id, entry_type, reference_id) DO NOTHING`,
      [
        randomUUID(),
        accountId,
        planEntitlements[plan].monthlyCredits,
        `period:${periodStart.toISOString()}`,
        periodStart,
        JSON.stringify({ plan, renewal }),
      ],
    );
  }

  private async buildPostgresUsage(
    client: PoolClient,
    subscription: SubscriptionRow,
  ): Promise<BillingUsage> {
    const result = await client.query<UsageAggregateRow>(
      `SELECT
        COALESCE(SUM(CASE WHEN credits > 0 THEN credits ELSE 0 END), 0)::int AS credits_granted,
        COALESCE(-SUM(CASE WHEN credits < 0 THEN credits ELSE 0 END), 0)::int AS credits_used,
        COUNT(*) FILTER (WHERE entry_type = 'usage' AND content_type = 'static_post')::int AS static_post,
        COUNT(*) FILTER (WHERE entry_type = 'usage' AND content_type = 'story')::int AS story,
        COUNT(*) FILTER (WHERE entry_type = 'usage' AND content_type = 'carousel')::int AS carousel,
        COUNT(*) FILTER (WHERE entry_type = 'usage' AND content_type = 'short_video_script')::int AS short_video_script,
        COUNT(*) FILTER (WHERE entry_type = 'usage' AND content_type = 'channel_adaptation')::int AS channel_adaptation
       FROM modo_credit_ledger
       WHERE account_id = $1 AND period_start = $2`,
      [subscription.account_id, subscription.period_start],
    );
    const aggregate = result.rows[0];
    const creditsGranted = Number(aggregate.credits_granted);
    const creditsUsed = Number(aggregate.credits_used);
    const usageByType: UsageByType = {
      static_post: Number(aggregate.static_post),
      story: Number(aggregate.story),
      carousel: Number(aggregate.carousel),
      short_video_script: Number(aggregate.short_video_script),
      channel_adaptation: Number(aggregate.channel_adaptation),
    };

    return {
      accountId: subscription.account_id,
      plan: subscription.plan_slug,
      storage: "postgres",
      periodStart: subscription.period_start.toISOString(),
      periodEnd: subscription.period_end.toISOString(),
      creditsGranted,
      creditsUsed,
      creditsRemaining: Math.max(0, creditsGranted - creditsUsed),
      usageByType,
      entitlements: planEntitlements[subscription.plan_slug],
    };
  }

  private assertCapacity(usage: BillingUsage, contentType: ContentUnitType) {
    const cost = contentCreditCost[contentType];
    if (usage.creditsRemaining < cost) {
      throw new BillingError(
        "INSUFFICIENT_CREDITS",
        409,
        `Saldo insuficiente. Este item exige ${cost} crédito(s) e restam ${usage.creditsRemaining}.`,
      );
    }
    if (
      contentType === "carousel" &&
      usage.usageByType.carousel >= usage.entitlements.maxCarouselsPerMonth
    ) {
      throw new BillingError(
        "CAROUSEL_LIMIT_REACHED",
        409,
        "O limite mensal de carrosséis deste plano foi atingido.",
      );
    }
    if (
      contentType === "short_video_script" &&
      usage.usageByType.short_video_script >=
        usage.entitlements.maxShortVideoScriptsPerMonth
    ) {
      throw new BillingError(
        "VIDEO_SCRIPT_LIMIT_REACHED",
        409,
        "O limite mensal de roteiros de vídeo deste plano foi atingido.",
      );
    }
  }

  private requirePool() {
    if (!this.pool) throw new Error("PostgreSQL não configurado.");
    return this.pool;
  }
}
