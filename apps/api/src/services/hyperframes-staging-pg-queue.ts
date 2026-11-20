import type { Pool, PoolClient } from "pg";
import {
  assertRecoveryIdempotentReuse,
  claimRecoveryLease,
  createRecoveryJob,
  failRecoveryLease,
  finishRecoveryLease,
  heartbeatRecoveryLease,
  type RecoveryIntent,
  type RecoveryJob,
} from "./hyperframes-staging-recovery-protocol.js";

const TABLE = "modo_hyperframes_staging.render_jobs";
const DATABASE = "modo_hyperframes_staging";
type JobRow = { document: RecoveryJob; version: number };
type ClockRow = { name: string; ms: string };

function enabled() {
  if (process.env.NODE_ENV === "production" ||
      process.env.MODO_HYPERFRAMES_RECOVERY_MODE !== "isolated-staging" ||
      process.env.MODO_HYPERFRAMES_DB_MODE !== "isolated-staging") {
    throw new Error("HYPERFRAMES_STAGING_PG_DISABLED");
  }
}
async function trustedNow(client: PoolClient): Promise<number> {
  const { rows } = await client.query<ClockRow>(
    "SELECT current_database() AS name, floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint AS ms",
  );
  if (rows[0]?.name !== DATABASE) {
    throw new Error("HYPERFRAMES_STAGING_PG_WRONG_DATABASE");
  }
  const ms = Number(rows[0].ms);
  if (!Number.isSafeInteger(ms) || ms <= 0) {
    throw new Error("HYPERFRAMES_STAGING_PG_INVALID_CLOCK");
  }
  return ms;
}

/**
 * True PostgreSQL persistence for strictly isolated staging, with no HTTP
 * route, worker, object store, Publisher V2 or production integration.
 *
 * Caller MUST supply the server-authenticated organization identity.
 * It must also use a dedicated staging-only PostgreSQL credential/cluster.
 * The SQL migration is manual; nothing here provisions or alters a DB.
 *
 * Each state transition is serialized by FOR UPDATE SKIP LOCKED and guarded
 * with organization + expected version. A successful update commits before a
 * caller may act on its lease. Stale workers cannot acknowledge newer leases.
 */
export class HyperframesStagingPgQueue {
  constructor(private readonly pool: Pool) {}

  /** Durable idempotency is scoped to (organization, client request key). */
  async enqueue(
    intent: RecoveryIntent, authorizedOrganizationId: string,
  ): Promise<RecoveryJob> {
    enabled();
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const now = await trustedNow(client);
      const proposed = createRecoveryJob(intent, authorizedOrganizationId, now);
      const inserted = await client.query<JobRow>(
        `INSERT INTO ${TABLE}
          (job_id, organization_id, project_id, idempotency_key, request_sha256,
           version, status, attempts, lease_expires_ms, document, created_ms, updated_ms)
         VALUES ($1::uuid,$2,$3,$4,$5,0,'queued',0,NULL,$6::jsonb,$7,$7)
         ON CONFLICT (organization_id,idempotency_key) DO NOTHING
         RETURNING document,version`,
        [proposed.jobId, proposed.organizationId, proposed.projectId,
         proposed.idempotencyKey, proposed.requestSha256,
         JSON.stringify(proposed), now],
      );
      if (inserted.rowCount === 1) {
        await client.query("COMMIT");
        return inserted.rows[0].document;
      }
      const existing = await client.query<JobRow>(
        `SELECT document,version FROM ${TABLE}
         WHERE organization_id=$1 AND idempotency_key=$2`,
        [authorizedOrganizationId, intent.idempotencyKey],
      );
      if (existing.rowCount !== 1) {
        throw new Error("HYPERFRAMES_STAGING_PG_IDEMPOTENCY_UNAVAILABLE");
      }
      const matching = assertRecoveryIdempotentReuse(
        existing.rows[0].document, intent, authorizedOrganizationId,
      );
      await client.query("COMMIT");
      return matching;
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
  }

  async get(jobId: string, authorizedOrganizationId: string):
    Promise<RecoveryJob | null> {
    enabled();
    const client = await this.pool.connect();
    try {
      await trustedNow(client);
      if (!authorizedOrganizationId) return null;
      const data = await client.query<JobRow>(
        `SELECT document,version FROM ${TABLE}
         WHERE job_id=$1::uuid AND organization_id=$2`,
        [jobId, authorizedOrganizationId],
      );
      return data.rows[0]?.document ?? null;
    } finally {
      client.release();
    }
  }

  private async transition(
    jobId: string, authorizedOrganizationId: string,
    transform: (record: RecoveryJob, now: number) => RecoveryJob | null,
  ): Promise<RecoveryJob | null> {
    enabled();
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const now = await trustedNow(client);
      if (!authorizedOrganizationId) {
        await client.query("ROLLBACK");
        return null;
      }
      const locked = await client.query<JobRow>(
        `SELECT document,version FROM ${TABLE}
         WHERE job_id=$1::uuid AND organization_id=$2
         FOR UPDATE SKIP LOCKED`,
        [jobId, authorizedOrganizationId],
      );
      if (locked.rowCount !== 1) {
        await client.query("ROLLBACK");
        return null;
      }
      const original = locked.rows[0].document;
      const next = transform(original, now);
      if (!next) {
        await client.query("ROLLBACK");
        return null;
      }
      if (next.organizationId !== authorizedOrganizationId ||
          next.jobId !== original.jobId ||
          next.version !== locked.rows[0].version + 1 ||
          next.published !== false || next.previewOnly !== true) {
        throw new Error("HYPERFRAMES_STAGING_PG_INVALID_TRANSITION");
      }
      const result = await client.query(
        `UPDATE ${TABLE} SET
           document=$1::jsonb,version=$2,status=$3,attempts=$4,
           lease_expires_ms=$5,updated_ms=$6
         WHERE job_id=$7::uuid AND organization_id=$8 AND version=$9
         RETURNING job_id`,
        [JSON.stringify(next), next.version, next.status, next.attempts,
         next.lease?.expiresAt ?? null, next.updatedAt,
         next.jobId, authorizedOrganizationId, original.version],
      );
      if (result.rowCount !== 1) {
        throw new Error("HYPERFRAMES_STAGING_PG_VERSION_CONFLICT");
      }
      await client.query("COMMIT");
      return next;
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
  }

  async claim(jobId: string, authorizedOrganizationId: string,
    workerId: string, durationMs: number): Promise<RecoveryJob | null> {
    return this.transition(jobId, authorizedOrganizationId, (r, now) =>
      claimRecoveryLease(r, authorizedOrganizationId, workerId, now, durationMs));
  }

  async heartbeat(jobId: string, authorizedOrganizationId: string,
    workerId: string, fence: string, durationMs: number):
    Promise<RecoveryJob | null> {
    return this.transition(jobId, authorizedOrganizationId, (r, now) =>
      heartbeatRecoveryLease(r, authorizedOrganizationId, workerId, fence,
        now, durationMs));
  }

  async finish(jobId: string, authorizedOrganizationId: string,
    workerId: string, fence: string,
    artifact: Readonly<{ storageKey: string; sha256: string; bytes: number }>):
    Promise<RecoveryJob | null> {
    return this.transition(jobId, authorizedOrganizationId, (r, now) =>
      finishRecoveryLease(r, authorizedOrganizationId, workerId, fence,
        now, artifact));
  }

  async fail(jobId: string, authorizedOrganizationId: string,
    workerId: string, fence: string): Promise<RecoveryJob | null> {
    return this.transition(jobId, authorizedOrganizationId, (r, now) =>
      failRecoveryLease(r, authorizedOrganizationId, workerId, fence, now));
  }
}
