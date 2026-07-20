import { randomUUID } from "node:crypto";
import pg, { type Pool } from "pg";
import { PlatformAdminError } from "./platform-admin-service.js";

const { Pool: PgPool } = pg;

interface Options {
  databaseUrl?: string;
  databaseSsl?: boolean;
}

export class AdminCreditService {
  private readonly pool?: Pool;

  constructor(options: Options = {}) {
    if (options.databaseUrl) {
      this.pool = new PgPool({
        connectionString: options.databaseUrl,
        ssl: options.databaseSsl ? { rejectUnauthorized: false } : undefined,
        max: 3,
      });
    }
  }

  async close() {
    await this.pool?.end();
  }

  async adjust(accountId: string, credits: number, reason: string) {
    const pool = this.requirePool();
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const subscription = await client.query<{ period_start: Date }>(
        `SELECT period_start FROM modo_subscriptions WHERE account_id=$1 FOR UPDATE`,
        [accountId],
      );
      if (!subscription.rowCount) {
        throw new PlatformAdminError("SUBSCRIPTION_NOT_FOUND", 404, "Assinatura da organização não encontrada.");
      }
      await client.query(
        `INSERT INTO modo_credit_ledger(
          id,account_id,entry_type,credits,reference_id,period_start,metadata
        ) VALUES($1,$2,'adjustment',$3,$4,$5,$6::jsonb)`,
        [
          randomUUID(),
          accountId,
          credits,
          `admin:${randomUUID()}`,
          subscription.rows[0].period_start,
          JSON.stringify({ reason, source: "platform_admin" }),
        ],
      );
      await client.query("COMMIT");
      return { accountId, credits, reason, adjusted: true };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  private requirePool() {
    if (!this.pool) throw new PlatformAdminError("ADMIN_DATABASE_REQUIRED", 503, "Ajustes administrativos exigem PostgreSQL.");
    return this.pool;
  }
}
