import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { finishRecoveryLease, type RecoveryJob } from "./hyperframes-staging-recovery-protocol.js";

const JOBS = "modo_hyperframes_staging.render_jobs";
const ARTIFACTS = "modo_hyperframes_staging.render_artifacts";
const DATABASE = "modo_hyperframes_staging";
const MAX_MP4 = 25_000_000;
type ClockRow = { name: string; ms: string };
type LockedJob = { document: RecoveryJob; version: number };
type StoredRow = {
  job_id: string; organization_id: string; project_id: string;
  storage_key: string; ciphertext: Buffer; iv: Buffer; auth_tag: Buffer;
  sha256: string; byte_length: number; expires_ms: string;
};

function enabled() {
  if (process.env.NODE_ENV === "production" ||
      process.env.MODO_HYPERFRAMES_RECOVERY_MODE !== "isolated-staging" ||
      process.env.MODO_HYPERFRAMES_DB_MODE !== "isolated-staging" ||
      process.env.MODO_HYPERFRAMES_STORAGE_MODE !== "isolated-staging") {
    throw new Error("HYPERFRAMES_STAGING_PG_ARTIFACTS_DISABLED");
  }
}
async function nowFromDb(client: PoolClient): Promise<number> {
  const response = await client.query<ClockRow>(
    "SELECT current_database() AS name, floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint AS ms");
  if (response.rows[0]?.name !== DATABASE) {
    throw new Error("HYPERFRAMES_STAGING_PG_ARTIFACTS_WRONG_DATABASE");
  }
  const n = Number(response.rows[0].ms);
  if (!Number.isSafeInteger(n) || n <= 0) {
    throw new Error("HYPERFRAMES_STAGING_PG_ARTIFACTS_INVALID_CLOCK");
  }
  return n;
}
function sha256(video: Buffer): string {
  return createHash("sha256").update(video).digest("hex");
}
function associatedData(meta: {
  jobId: string; organizationId: string; projectId: string;
  storageKey: string; sha256: string; bytes: number; expiresAt: number;
}): Buffer {
  return Buffer.from(JSON.stringify([
    "modo-hyperframes-staging-pg-aes-gcm-v1", meta.jobId,
    meta.organizationId, meta.projectId, meta.storageKey,
    meta.sha256, meta.bytes, meta.expiresAt,
  ]));
}

/**
 * Staging-only encrypted persistent MP4s in a separate PostgreSQL database.
 * No public API, no Publisher, no Render production import, no object URL.
 * Only a server-authenticated scheduler may provide authorizedOrganizationId.
 *
 * Upstream must validate codec, duration and dimensions with ffprobe. A
 * four-byte ftyp signature alone is NOT sufficient to certify a video.
 * The independent 32-byte key must be managed outside GitHub and the DB.
 */
export class HyperframesStagingPgArtifacts {
  private readonly key: Buffer;
  private readonly retentionMs: number;
  private readonly maxTotalBytes: number;
  private closed = false;

  constructor(private readonly pool: Pool, config: Readonly<{
    key: Uint8Array; retentionMs?: number; maxTotalBytes?: number;
  }>) {
    if (!(config?.key instanceof Uint8Array) || config.key.byteLength !== 32) {
      throw new Error("HYPERFRAMES_STAGING_PG_ARTIFACTS_INVALID_KEY");
    }
    this.retentionMs = config.retentionMs ?? 10 * 60_000;
    this.maxTotalBytes = config.maxTotalBytes ?? 50_000_000;
    if (!Number.isSafeInteger(this.retentionMs) ||
        this.retentionMs < 1000 || this.retentionMs > 900_000 ||
        !Number.isSafeInteger(this.maxTotalBytes) ||
        this.maxTotalBytes < 4000 || this.maxTotalBytes > 100_000_000) {
      throw new Error("HYPERFRAMES_STAGING_PG_ARTIFACTS_INVALID_LIMITS");
    }
    this.key = Buffer.from(config.key);
  }

  private active() {
    enabled();
    if (this.closed) throw new Error("HYPERFRAMES_STAGING_PG_ARTIFACTS_CLOSED");
  }

  /**
   * Atomic state transition + AES-256-GCM ciphertext insertion. The active
   * DB lease fence and version are checked under a row lock; a stale worker
   * cannot commit an object after a newer worker has claimed the job.
   */
  async finishWithVideo(input: Readonly<{
    jobId: string; authorizedOrganizationId: string;
    workerId: string; fence: string; video: Buffer;
  }>): Promise<RecoveryJob | null> {
    this.active();
    if (!input || !Buffer.isBuffer(input.video) ||
        input.video.byteLength < 4000 || input.video.byteLength > MAX_MP4 ||
        input.video.subarray(4, 8).toString("ascii") !== "ftyp") {
      throw new Error("HYPERFRAMES_STAGING_PG_ARTIFACTS_INVALID_MP4");
    }
    if (!input.authorizedOrganizationId) {
      throw new Error("HYPERFRAMES_STAGING_PG_ARTIFACTS_TENANT_DENIED");
    }
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const now = await nowFromDb(client);
      const locked = await client.query<LockedJob>(
        "SELECT document,version FROM " + JOBS +
        " WHERE job_id=$1::uuid AND organization_id=$2 FOR UPDATE SKIP LOCKED",
        [input.jobId, input.authorizedOrganizationId]);
      if (locked.rowCount !== 1) {
        await client.query("ROLLBACK");
        return null;
      }
      const current = locked.rows[0].document;
      const checksum = sha256(input.video);
      const storageKey = randomUUID();
      const next = finishRecoveryLease(current, input.authorizedOrganizationId,
        input.workerId, input.fence, now,
        { storageKey, sha256: checksum, bytes: input.video.byteLength });
      if (!next) {
        await client.query("ROLLBACK");
        return null;
      }
      if (next.version !== locked.rows[0].version + 1 ||
          next.status !== "succeeded" || next.previewOnly !== true ||
          next.published !== false) {
        throw new Error("HYPERFRAMES_STAGING_PG_ARTIFACTS_INVALID_TRANSITION");
      }
      // Global advisory lock serializes capacity across different jobs.
      await client.query("SELECT pg_advisory_xact_lock(714216384)");
      await client.query("DELETE FROM " + ARTIFACTS + " WHERE expires_ms <= $1", [now]);
      const sum = await client.query<{ bytes: string }>(
        "SELECT coalesce(sum(byte_length),0)::bigint AS bytes FROM " + ARTIFACTS);
      const occupied = Number(sum.rows[0]?.bytes);
      if (!Number.isSafeInteger(occupied) ||
          occupied + input.video.byteLength > this.maxTotalBytes) {
        throw new Error("HYPERFRAMES_STAGING_PG_ARTIFACTS_CAPACITY");
      }
      const expiresAt = now + this.retentionMs;
      const iv = randomBytes(12);
      const cipher = createCipheriv("aes-256-gcm", this.key, iv);
      cipher.setAAD(associatedData({
        jobId: current.jobId, organizationId: current.organizationId,
        projectId: current.projectId, storageKey,
        sha256: checksum, bytes: input.video.byteLength, expiresAt,
      }));
      const ciphertext = Buffer.concat([cipher.update(input.video), cipher.final()]);
      const tag = cipher.getAuthTag();
      await client.query(
        "INSERT INTO " + ARTIFACTS +
        " (job_id,organization_id,storage_key,ciphertext,iv,auth_tag," +
        " sha256,byte_length,expires_ms,created_ms)" +
        " VALUES ($1::uuid,$2,$3::uuid,$4,$5,$6,$7,$8,$9,$10)",
        [current.jobId, current.organizationId, storageKey, ciphertext,
          iv, tag, checksum, input.video.byteLength, expiresAt, now]);
      const updated = await client.query(
        "UPDATE " + JOBS +
        " SET document=$1::jsonb,version=$2,status=$3,attempts=$4," +
        " lease_expires_ms=NULL,updated_ms=$5" +
        " WHERE job_id=$6::uuid AND organization_id=$7 AND version=$8" +
        " RETURNING job_id",
        [JSON.stringify(next), next.version, next.status, next.attempts,
          next.updatedAt, next.jobId, input.authorizedOrganizationId, current.version]);
      if (updated.rowCount !== 1) {
        throw new Error("HYPERFRAMES_STAGING_PG_ARTIFACTS_VERSION_CONFLICT");
      }
      await client.query("COMMIT");
      return next;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  /** Enforces tenant scope, job success, TTL, AEAD metadata and checksum. */
  async read(jobId: string, authorizedOrganizationId: string): Promise<Buffer | null> {
    this.active();
    const client = await this.pool.connect();
    try {
      const now = await nowFromDb(client);
      if (!authorizedOrganizationId) return null;
      const found = await client.query<StoredRow>(
        "SELECT a.job_id,a.organization_id,j.project_id,a.storage_key," +
        " a.ciphertext,a.iv,a.auth_tag,a.sha256,a.byte_length,a.expires_ms" +
        " FROM " + ARTIFACTS + " a INNER JOIN " + JOBS + " j" +
        " ON j.job_id=a.job_id AND j.organization_id=a.organization_id" +
        " WHERE a.job_id=$1::uuid AND a.organization_id=$2 AND a.expires_ms>$3" +
        " AND j.status='succeeded'" +
        " AND j.document->'artifact'->>'storageKey'=a.storage_key::text",
        [jobId, authorizedOrganizationId, now]);
      const row = found.rows[0];
      if (!row) return null;
      if (!/^[a-f0-9]{64}$/.test(row.sha256) ||
          !Buffer.isBuffer(row.ciphertext) ||
          !Buffer.isBuffer(row.iv) || !Buffer.isBuffer(row.auth_tag)) {
        throw new Error("HYPERFRAMES_STAGING_PG_ARTIFACTS_INTEGRITY_FAILED");
      }
      try {
        const decipher = createDecipheriv("aes-256-gcm", this.key, row.iv);
        decipher.setAAD(associatedData({
          jobId: row.job_id, organizationId: row.organization_id,
          projectId: row.project_id, storageKey: row.storage_key,
          sha256: row.sha256, bytes: row.byte_length,
          expiresAt: Number(row.expires_ms),
        }));
        decipher.setAuthTag(row.auth_tag);
        const plain = Buffer.concat([decipher.update(row.ciphertext), decipher.final()]);
        if (plain.byteLength !== row.byte_length || sha256(plain) !== row.sha256) {
          plain.fill(0);
          throw new Error("bad checksum");
        }
        return plain;
      } catch {
        throw new Error("HYPERFRAMES_STAGING_PG_ARTIFACTS_INTEGRITY_FAILED");
      }
    } finally {
      client.release();
    }
  }

  /** Permanently drops ciphertext and clears the job pointer. */
  async forget(jobId: string, authorizedOrganizationId: string): Promise<boolean> {
    this.active();
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const now = await nowFromDb(client);
      if (!authorizedOrganizationId) {
        await client.query("ROLLBACK");
        return false;
      }
      const locked = await client.query<LockedJob>(
        "SELECT document,version FROM " + JOBS +
        " WHERE job_id=$1::uuid AND organization_id=$2" +
        " AND status='succeeded' FOR UPDATE SKIP LOCKED",
        [jobId, authorizedOrganizationId]);
      if (locked.rowCount !== 1 || !locked.rows[0].document.artifact) {
        await client.query("ROLLBACK");
        return false;
      }
      const original = locked.rows[0].document;
      const cleared: RecoveryJob = {
        ...original, artifact: null, version: original.version + 1, updatedAt: now,
      };
      await client.query("DELETE FROM " + ARTIFACTS +
        " WHERE job_id=$1::uuid AND organization_id=$2",
        [jobId, authorizedOrganizationId]);
      const updated = await client.query(
        "UPDATE " + JOBS +
        " SET document=$1::jsonb,version=$2,updated_ms=$3" +
        " WHERE job_id=$4::uuid AND organization_id=$5 AND version=$6",
        [JSON.stringify(cleared), cleared.version, now, jobId,
          authorizedOrganizationId, original.version]);
      if (updated.rowCount !== 1) {
        throw new Error("HYPERFRAMES_STAGING_PG_ARTIFACTS_VERSION_CONFLICT");
      }
      await client.query("COMMIT");
      return true;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  /** Schedule explicitly in the future staging worker; no public route. */
  async pruneExpired(): Promise<number> {
    this.active();
    const client = await this.pool.connect();
    try {
      const now = await nowFromDb(client);
      const result = await client.query(
        "DELETE FROM " + ARTIFACTS + " WHERE job_id IN" +
        " (SELECT job_id FROM " + ARTIFACTS +
        " WHERE expires_ms<=$1 ORDER BY expires_ms" +
        " FOR UPDATE SKIP LOCKED LIMIT 100)", [now]);
      return result.rowCount ?? 0;
    } finally {
      client.release();
    }
  }

  close() {
    if (this.closed) return;
    this.key.fill(0);
    this.closed = true;
  }
}
