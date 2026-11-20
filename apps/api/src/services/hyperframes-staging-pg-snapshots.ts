import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { VideoProjectSchema, type VideoProject } from "@modo/contracts/video";
import type { Pool, PoolClient } from "pg";
import {
  assertRecoveryIdempotentReuse, createRecoveryJob,
  type RecoveryJob,
} from "./hyperframes-staging-recovery-protocol.js";
import { stagingRenderRequestSha256 } from "./hyperframes-staging-pg-render-runner.js";
import { exportVideoProjectHyperframesPreview } from "./hyperframes-project-preview.js";

const DATABASE = "modo_hyperframes_staging";
const JOBS = "modo_hyperframes_staging.render_jobs";
const SNAPSHOTS = "modo_hyperframes_staging.render_snapshots";
const MAX_SNAPSHOT_BYTES = 150_000;
const MAX_TOTAL_BYTES = 5_000_000;
const RETENTION_MS = 60 * 60_000;

type NowRow = { database: string; milliseconds: string };
type JobRow = { document: RecoveryJob };
type SnapshotRow = {
  job_id: string; organization_id: string; project_id: string;
  request_sha256: string; ciphertext: Buffer; iv: Buffer;
  auth_tag: Buffer; byte_length: number; expires_ms: string;
};

function enabled() {
  if (process.env.NODE_ENV === "production" ||
      process.env.MODO_HYPERFRAMES_WORKER_MODE !== "isolated-staging" ||
      process.env.MODO_HYPERFRAMES_RECOVERY_MODE !== "isolated-staging" ||
      process.env.MODO_HYPERFRAMES_DB_MODE !== "isolated-staging" ||
      process.env.MODO_HYPERFRAMES_STORAGE_MODE !== "isolated-staging") {
    throw new Error("HYPERFRAMES_STAGING_PG_SNAPSHOTS_DISABLED");
  }
}
async function nowFromDb(client: PoolClient): Promise<number> {
  const { rows } = await client.query<NowRow>(
    "SELECT current_database() AS database, " +
    "floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint AS milliseconds");
  if (rows[0]?.database !== DATABASE) {
    throw new Error("HYPERFRAMES_STAGING_PG_SNAPSHOTS_WRONG_DATABASE");
  }
  const value = Number(rows[0].milliseconds);
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error("HYPERFRAMES_STAGING_PG_SNAPSHOTS_INVALID_CLOCK");
  }
  return value;
}
function associatedData(record: {
  organizationId: string; projectId: string; jobId: string;
  digest: string; expiresAt: number; bytes: number;
}): Buffer {
  return Buffer.from(JSON.stringify([
    "modo-hyperframes-staging-snapshot-v1",
    record.organizationId, record.projectId, record.jobId,
    record.digest, record.expiresAt, record.bytes,
  ]));
}
function sanitizeSnapshot(project: VideoProject, brandName: string) {
  // Only a strict static-composition VideoProject is eligible for the
  // preview renderer. No external assets, audio, motion or online URLs.
  const parsed = VideoProjectSchema.parse(project);
  exportVideoProjectHyperframesPreview(parsed, brandName);
  return parsed;
}

/**
 * Atomic staging-only source preservation: a queued job and its encrypted
 * immutable render source are committed together or not at all.
 *
 * The caller must provide an independently authenticated tenant. No
 * endpoint, publisher, production database or key-management API is wired.
 */
export class HyperframesStagingPgSnapshots {
  private readonly key: Buffer;
  private closed = false;

  constructor(private readonly pool: Pool, config: Readonly<{ key: Uint8Array }>) {
    if (!(config?.key instanceof Uint8Array) || config.key.byteLength !== 32) {
      throw new Error("HYPERFRAMES_STAGING_PG_SNAPSHOTS_INVALID_KEY");
    }
    this.key = Buffer.from(config.key);
  }
  private active() {
    enabled();
    if (this.closed) throw new Error("HYPERFRAMES_STAGING_PG_SNAPSHOTS_CLOSED");
  }

  async enqueue(input: Readonly<{
    project: VideoProject; brandName: string; idempotencyKey: string;
    authorizedOrganizationId: string;
  }>): Promise<RecoveryJob> {
    this.active();
    if (!input?.authorizedOrganizationId ||
        input.project?.organizationId !== input.authorizedOrganizationId) {
      throw new Error("HYPERFRAMES_STAGING_PG_SNAPSHOTS_TENANT_DENIED");
    }
    let project: VideoProject;
    try {
      project = sanitizeSnapshot(input.project, input.brandName);
    } catch {
      throw new Error("HYPERFRAMES_STAGING_PG_SNAPSHOTS_INVALID_PROJECT");
    }
    const intent = {
      organizationId: input.authorizedOrganizationId, projectId: project.id,
      idempotencyKey: input.idempotencyKey,
      requestSha256: stagingRenderRequestSha256(project, input.brandName),
    };
    const plaintext = Buffer.from(JSON.stringify({
      project, brandName: input.brandName,
    }), "utf8");
    if (plaintext.byteLength < 1 ||
        plaintext.byteLength > MAX_SNAPSHOT_BYTES) {
      plaintext.fill(0);
      throw new Error("HYPERFRAMES_STAGING_PG_SNAPSHOTS_SIZE");
    }
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const now = await nowFromDb(client);
      const proposed = createRecoveryJob(intent, input.authorizedOrganizationId, now);
      const inserted = await client.query<JobRow>(
        "INSERT INTO " + JOBS +
        " (job_id,organization_id,project_id,idempotency_key,request_sha256," +
        " version,status,attempts,lease_expires_ms,document,created_ms,updated_ms)" +
        " VALUES($1::uuid,$2,$3,$4,$5,0,'queued',0,NULL,$6::jsonb,$7,$7)" +
        " ON CONFLICT (organization_id,idempotency_key) DO NOTHING" +
        " RETURNING document",
        [proposed.jobId, proposed.organizationId, proposed.projectId,
          proposed.idempotencyKey, proposed.requestSha256,
          JSON.stringify(proposed), now],
      );
      if (inserted.rowCount !== 1) {
        const existing = await client.query<JobRow>(
          "SELECT document FROM " + JOBS +
          " WHERE organization_id=$1 AND idempotency_key=$2",
          [input.authorizedOrganizationId, input.idempotencyKey],
        );
        if (existing.rowCount !== 1) {
          throw new Error("HYPERFRAMES_STAGING_PG_SNAPSHOTS_IDEMPOTENCY_UNAVAILABLE");
        }
        const reused = assertRecoveryIdempotentReuse(
          existing.rows[0].document, intent, input.authorizedOrganizationId);
        const stored = await client.query(
          "SELECT job_id FROM " + SNAPSHOTS +
          " WHERE job_id=$1::uuid AND organization_id=$2 AND expires_ms>$3",
          [reused.jobId, input.authorizedOrganizationId, now],
        );
        if (stored.rowCount !== 1) {
          throw new Error("HYPERFRAMES_STAGING_PG_SNAPSHOTS_MISSING_SOURCE");
        }
        await client.query("COMMIT");
        return reused;
      }
      // Global transactional capacity lock protects all organizations.
      await client.query("SELECT pg_advisory_xact_lock(714216385)");
      await client.query("DELETE FROM " + SNAPSHOTS + " WHERE expires_ms <= $1", [now]);
      const total = await client.query<{ bytes: string }>(
        "SELECT coalesce(sum(byte_length),0)::bigint AS bytes FROM " + SNAPSHOTS);
      const used = Number(total.rows[0]?.bytes);
      if (!Number.isSafeInteger(used) ||
          used + plaintext.byteLength > MAX_TOTAL_BYTES) {
        throw new Error("HYPERFRAMES_STAGING_PG_SNAPSHOTS_CAPACITY");
      }
      const expiresAt = now + RETENTION_MS;
      const iv = randomBytes(12);
      const cipher = createCipheriv("aes-256-gcm", this.key, iv);
      cipher.setAAD(associatedData({
        jobId: proposed.jobId, organizationId: proposed.organizationId,
        projectId: proposed.projectId, digest: proposed.requestSha256,
        expiresAt, bytes: plaintext.byteLength,
      }));
      const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
      await client.query(
        "INSERT INTO " + SNAPSHOTS +
        " (job_id,organization_id,project_id,request_sha256," +
        " ciphertext,iv,auth_tag,byte_length,created_ms,expires_ms)" +
        " VALUES($1::uuid,$2,$3,$4,$5,$6,$7,$8,$9,$10)",
        [proposed.jobId, proposed.organizationId, proposed.projectId,
          proposed.requestSha256, ciphertext, iv, cipher.getAuthTag(),
          plaintext.byteLength, now, expiresAt],
      );
      await client.query("COMMIT");
      return proposed;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      plaintext.fill(0);
      client.release();
    }
  }

  async load(jobId: string, authorizedOrganizationId: string): Promise<{
    project: VideoProject; brandName: string;
  } | null> {
    this.active();
    if (!authorizedOrganizationId) return null;
    const client = await this.pool.connect();
    try {
      const now = await nowFromDb(client);
      const found = await client.query<SnapshotRow>(
        "SELECT s.job_id,s.organization_id,s.project_id," +
        " s.request_sha256,s.ciphertext,s.iv,s.auth_tag," +
        " s.byte_length,s.expires_ms FROM " + SNAPSHOTS +
        " s JOIN " + JOBS + " j" +
        " ON j.job_id=s.job_id AND j.organization_id=s.organization_id" +
        " WHERE s.job_id=$1::uuid AND s.organization_id=$2" +
        " AND s.expires_ms>$3 AND j.status IN('queued','running')" +
        " AND s.request_sha256=j.request_sha256",
        [jobId, authorizedOrganizationId, now],
      );
      const row = found.rows[0];
      if (!row) return null;
      let plaintext: Buffer | null = null;
      try {
        const decipher = createDecipheriv("aes-256-gcm", this.key, row.iv);
        decipher.setAAD(associatedData({
          jobId: row.job_id, organizationId: row.organization_id,
          projectId: row.project_id, digest: row.request_sha256,
          expiresAt: Number(row.expires_ms), bytes: row.byte_length,
        }));
        decipher.setAuthTag(row.auth_tag);
        plaintext = Buffer.concat([
          decipher.update(row.ciphertext), decipher.final(),
        ]);
        if (plaintext.byteLength !== row.byte_length) {
          throw new Error("snapshot size");
        }
        const data: unknown = JSON.parse(plaintext.toString("utf8"));
        if (!data || typeof data !== "object" ||
            !("project" in data) || !("brandName" in data)) {
          throw new Error("snapshot shape");
        }
        const raw = data as { project: unknown; brandName: unknown };
        if (typeof raw.brandName !== "string") throw new Error("snapshot brand");
        const project = sanitizeSnapshot(raw.project as VideoProject, raw.brandName);
        if (project.id !== row.project_id ||
            project.organizationId !== authorizedOrganizationId ||
            stagingRenderRequestSha256(project, raw.brandName) !== row.request_sha256) {
          throw new Error("snapshot digest");
        }
        return { project, brandName: raw.brandName };
      } catch {
        throw new Error("HYPERFRAMES_STAGING_PG_SNAPSHOTS_INTEGRITY_FAILED");
      } finally {
        plaintext?.fill(0);
      }
    } finally {
      client.release();
    }
  }

  async pruneExpired(): Promise<number> {
    this.active();
    const client = await this.pool.connect();
    try {
      const now = await nowFromDb(client);
      const deleted = await client.query(
        "DELETE FROM " + SNAPSHOTS + " WHERE job_id IN" +
        " (SELECT job_id FROM " + SNAPSHOTS +
        " WHERE expires_ms <= $1 ORDER BY expires_ms" +
        " LIMIT 100 FOR UPDATE SKIP LOCKED)",
        [now],
      );
      return deleted.rowCount ?? 0;
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
