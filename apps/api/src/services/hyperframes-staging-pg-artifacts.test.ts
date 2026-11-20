import { randomBytes } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import pg, { type Pool } from "pg";
import { HyperframesStagingPgQueue } from "./hyperframes-staging-pg-queue.js";
import { HyperframesStagingPgArtifacts } from "./hyperframes-staging-pg-artifacts.js";

const dbUrl = process.env.MODO_HYPERFRAMES_PG_TEST_DATABASE_URL;
const prior = {
  node: process.env.NODE_ENV,
  recovery: process.env.MODO_HYPERFRAMES_RECOVERY_MODE,
  database: process.env.MODO_HYPERFRAMES_DB_MODE,
  storage: process.env.MODO_HYPERFRAMES_STORAGE_MODE,
};
const makeVideo = (length = 5000): Buffer => {
  const buffer = Buffer.alloc(length, 17);
  buffer.write("ftyp", 4, "ascii");
  return buffer;
};
const intent = (key: string, organizationId = "artifact-tenant-a") => ({
  organizationId,
  projectId: "11111111-1111-4111-8111-111111111111",
  idempotencyKey: key,
  requestSha256: "a".repeat(64),
});
const grant = async (q: HyperframesStagingPgQueue, key: string) => {
  const job = await q.enqueue(intent(key), "artifact-tenant-a");
  const lease = await q.claim(job.jobId, "artifact-tenant-a", "worker-a", 60_000);
  if (!lease?.lease) throw new Error("Fixture lease not claimed");
  return lease;
};
let pool: Pool;
let queue: HyperframesStagingPgQueue;
let key: Buffer;
let vault: HyperframesStagingPgArtifacts;

describe.skipIf(!dbUrl)("staging PostgreSQL encrypted MP4 artifacts (isolated database)", () => {
  beforeAll(async () => {
    const { Pool: PgPool } = pg;
    pool = new PgPool({ connectionString: dbUrl, ssl: false, max: 8 });
    const result = await pool.query("SELECT current_database() AS name");
    if (result.rows[0]?.name !== "modo_hyperframes_staging") {
      throw new Error("HYPERFRAMES_PG_ARTIFACTS_TEST_WRONG_DATABASE");
    }
  });
  beforeEach(async () => {
    process.env.NODE_ENV = "test";
    process.env.MODO_HYPERFRAMES_RECOVERY_MODE = "isolated-staging";
    process.env.MODO_HYPERFRAMES_DB_MODE = "isolated-staging";
    process.env.MODO_HYPERFRAMES_STORAGE_MODE = "isolated-staging";
    await pool.query(
      "DELETE FROM modo_hyperframes_staging.render_jobs WHERE organization_id LIKE $1",
      ["artifact-tenant-%"],
    );
    queue = new HyperframesStagingPgQueue(pool);
    key = randomBytes(32);
    vault = new HyperframesStagingPgArtifacts(pool, { key });
  });
  afterEach(() => {
    vault.close();
    key.fill(0);
    for (const [name, original] of [
      ["NODE_ENV", prior.node],
      ["MODO_HYPERFRAMES_RECOVERY_MODE", prior.recovery],
      ["MODO_HYPERFRAMES_DB_MODE", prior.database],
      ["MODO_HYPERFRAMES_STORAGE_MODE", prior.storage],
    ] as const) {
      if (original === undefined) delete process.env[name];
      else process.env[name] = original;
    }
  });
  afterAll(async () => { await pool?.end(); });

  it("commits encrypted MP4 and terminal job together, readable after adapter restart", async () => {
    const claimed = await grant(queue, "artifact-durable-0001");
    const video = makeVideo();
    const final = await vault.finishWithVideo({
      jobId: claimed.jobId, authorizedOrganizationId: "artifact-tenant-a",
      workerId: "worker-a", fence: claimed.lease!.fence, video,
    });
    expect(final?.status).toBe("succeeded");
    expect(final?.published).toBe(false);
    expect(final?.previewOnly).toBe(true);
    expect(final?.artifact?.bytes).toBe(video.length);
    const row = await pool.query(
      "SELECT ciphertext,sha256 FROM modo_hyperframes_staging.render_artifacts WHERE job_id=$1",
      [claimed.jobId],
    );
    expect(row.rowCount).toBe(1);
    expect(Buffer.isBuffer(row.rows[0].ciphertext)).toBe(true);
    expect(row.rows[0].ciphertext.equals(video)).toBe(false);
    const restarted = new HyperframesStagingPgArtifacts(pool, { key });
    expect(await restarted.read(claimed.jobId, "artifact-tenant-a")).toEqual(video);
    restarted.close();
    expect(await vault.read(claimed.jobId, "artifact-tenant-b")).toBeNull();
    expect(await vault.read(claimed.jobId, "")).toBeNull();
    expect(await vault.finishWithVideo({
      jobId: claimed.jobId, authorizedOrganizationId: "artifact-tenant-a",
      workerId: "worker-a", fence: claimed.lease!.fence, video,
    })).toBeNull();
  });

  it("rejects stale lease, wrong tenant and missing metadata without leaking ciphertext", async () => {
    const claimed = await grant(queue, "artifact-fencing-0002");
    const video = makeVideo();
    expect(await vault.finishWithVideo({
      jobId: claimed.jobId, authorizedOrganizationId: "artifact-tenant-b",
      workerId: "worker-a", fence: claimed.lease!.fence, video,
    })).toBeNull();
    expect(await vault.finishWithVideo({
      jobId: claimed.jobId, authorizedOrganizationId: "artifact-tenant-a",
      workerId: "worker-a", fence: "old-or-forged-fence", video,
    })).toBeNull();
    const failed = await queue.fail(claimed.jobId, "artifact-tenant-a",
      "worker-a", claimed.lease!.fence);
    expect(failed?.status).toBe("queued");
    const reclaimed = await queue.claim(
      claimed.jobId, "artifact-tenant-a", "worker-b", 60_000);
    expect(await vault.finishWithVideo({
      jobId: claimed.jobId, authorizedOrganizationId: "artifact-tenant-a",
      workerId: "worker-a", fence: claimed.lease!.fence, video,
    })).toBeNull();
    const good = await vault.finishWithVideo({
      jobId: claimed.jobId, authorizedOrganizationId: "artifact-tenant-a",
      workerId: "worker-b", fence: reclaimed!.lease!.fence, video,
    });
    expect(good?.status).toBe("succeeded");
    const objects = await pool.query(
      "SELECT count(*)::int AS n FROM modo_hyperframes_staging.render_artifacts WHERE job_id=$1",
      [claimed.jobId],
    );
    expect(objects.rows[0].n).toBe(1);
  });

  it("denies reads with wrong key or tampered encrypted bytes and metadata", async () => {
    const claimed = await grant(queue, "artifact-integrity-0003");
    const video = makeVideo();
    await vault.finishWithVideo({
      jobId: claimed.jobId, authorizedOrganizationId: "artifact-tenant-a",
      workerId: "worker-a", fence: claimed.lease!.fence, video,
    });
    const wrongKey = new HyperframesStagingPgArtifacts(
      pool, { key: randomBytes(32) });
    await expect(wrongKey.read(claimed.jobId, "artifact-tenant-a"))
      .rejects.toThrow(/INTEGRITY_FAILED/);
    wrongKey.close();
    await pool.query(
      "UPDATE modo_hyperframes_staging.render_artifacts" +
      " SET ciphertext=overlay(ciphertext placing decode('ff','hex') from 1 for 1)" +
      " WHERE job_id=$1", [claimed.jobId],
    );
    await expect(vault.read(claimed.jobId, "artifact-tenant-a"))
      .rejects.toThrow(/INTEGRITY_FAILED/);
    await expect(vault.read(claimed.jobId, "artifact-tenant-b"))
      .resolves.toBeNull();
  });

  it("deletes tenant-owned ciphertext and clears job metadata permanently", async () => {
    const claimed = await grant(queue, "artifact-delete-0004");
    await vault.finishWithVideo({
      jobId: claimed.jobId, authorizedOrganizationId: "artifact-tenant-a",
      workerId: "worker-a", fence: claimed.lease!.fence, video: makeVideo(),
    });
    expect(await vault.forget(claimed.jobId, "artifact-tenant-b")).toBe(false);
    expect(await vault.forget(claimed.jobId, "artifact-tenant-a")).toBe(true);
    expect(await vault.read(claimed.jobId, "artifact-tenant-a")).toBeNull();
    expect((await queue.get(claimed.jobId, "artifact-tenant-a"))?.artifact).toBeNull();
    expect(await vault.forget(claimed.jobId, "artifact-tenant-a")).toBe(false);
  });

  it("enforces global stored byte quota even when different jobs finish concurrently", async () => {
    vault.close();
    vault = new HyperframesStagingPgArtifacts(pool, {
      key, maxTotalBytes: 6000,
    });
    const a = await grant(queue, "artifact-capacity-0005");
    const b = await grant(queue, "artifact-capacity-0006");
    const mp4 = makeVideo();
    const actions = await Promise.allSettled([a, b].map(j =>
      vault.finishWithVideo({
        jobId: j.jobId, authorizedOrganizationId: "artifact-tenant-a",
        workerId: "worker-a", fence: j.lease!.fence, video: mp4,
      })));
    expect(actions.filter(x => x.status === "fulfilled")).toHaveLength(1);
    expect(actions.filter(x => x.status === "rejected")).toHaveLength(1);
    const rows = await pool.query(
      "SELECT count(*)::int AS n FROM modo_hyperframes_staging.render_artifacts" +
      " WHERE organization_id='artifact-tenant-a'",
    );
    expect(rows.rows[0].n).toBe(1);
    const saved = await Promise.all([a, b].map(j =>
      queue.get(j.jobId, "artifact-tenant-a")));
    expect(saved.filter(x => x?.status === "succeeded")).toHaveLength(1);
    expect(saved.filter(x => x?.status === "running")).toHaveLength(1);
  });

  it("expires previews and prunes old encrypted bytes, denying reads first", async () => {
    const claimed = await grant(queue, "artifact-expiry-0007");
    await vault.finishWithVideo({
      jobId: claimed.jobId, authorizedOrganizationId: "artifact-tenant-a",
      workerId: "worker-a", fence: claimed.lease!.fence, video: makeVideo(),
    });
    await pool.query(
      "UPDATE modo_hyperframes_staging.render_artifacts" +
      " SET expires_ms=created_ms + 1 WHERE job_id=$1",
      [claimed.jobId],
    );
    expect(await vault.read(claimed.jobId, "artifact-tenant-a")).toBeNull();
    expect(await vault.pruneExpired()).toBeGreaterThanOrEqual(1);
    const row = await pool.query(
      "SELECT job_id FROM modo_hyperframes_staging.render_artifacts WHERE job_id=$1",
      [claimed.jobId],
    );
    expect(row.rowCount).toBe(0);
  });

  it("stays disabled in production and refuses unsafe key, size and configuration", async () => {
    expect(() => new HyperframesStagingPgArtifacts(pool, {
      key: randomBytes(16),
    })).toThrow(/INVALID_KEY/);
    expect(() => new HyperframesStagingPgArtifacts(pool, {
      key, retentionMs: 900_001,
    })).toThrow(/INVALID_LIMITS/);
    const job = await grant(queue, "artifact-gates-0008");
    await expect(vault.finishWithVideo({
      jobId: job.jobId, authorizedOrganizationId: "artifact-tenant-a",
      workerId: "worker-a", fence: job.lease!.fence,
      video: Buffer.alloc(5000, 20),
    })).rejects.toThrow(/INVALID_MP4/);
    process.env.NODE_ENV = "production";
    await expect(vault.read(job.jobId, "artifact-tenant-a"))
      .rejects.toThrow(/ARTIFACTS_DISABLED/);
    process.env.NODE_ENV = "test";
    delete process.env.MODO_HYPERFRAMES_STORAGE_MODE;
    await expect(vault.read(job.jobId, "artifact-tenant-a"))
      .rejects.toThrow(/ARTIFACTS_DISABLED/);
  });
});
