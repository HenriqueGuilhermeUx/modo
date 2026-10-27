import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import pg, { type Pool } from "pg";
import { HyperframesStagingPgQueue } from "./hyperframes-staging-pg-queue.js";

const dbUrl = process.env.MODO_HYPERFRAMES_PG_TEST_DATABASE_URL;
const { Pool: PgPool } = pg;
const previous = {
  node: process.env.NODE_ENV,
  recovery: process.env.MODO_HYPERFRAMES_RECOVERY_MODE,
  db: process.env.MODO_HYPERFRAMES_DB_MODE,
};

const base = (key: string, tenant = "sandbox-tenant-a") => ({
  organizationId: tenant,
  projectId: "11111111-1111-4111-8111-111111111111",
  idempotencyKey: key,
  requestSha256: "a".repeat(64),
});
const artifact = {
  storageKey: "33333333-3333-4333-8333-333333333333",
  sha256: "b".repeat(64),
  bytes: 5000,
};
let pool: Pool;
let queue: HyperframesStagingPgQueue;

describe.skipIf(!dbUrl)("Postgres HyperFrames staging recovery (dedicated DB only)", () => {
  beforeAll(async () => {
    pool = new PgPool({ connectionString: dbUrl, ssl: false, max: 8 });
    const check = await pool.query("SELECT current_database() AS name");
    if (check.rows[0].name !== "modo_hyperframes_staging") {
      throw new Error("HYPERFRAMES_TEST_WRONG_DATABASE");
    }
    queue = new HyperframesStagingPgQueue(pool);
  });
  beforeEach(async () => {
    process.env.NODE_ENV = "test";
    process.env.MODO_HYPERFRAMES_RECOVERY_MODE = "isolated-staging";
    process.env.MODO_HYPERFRAMES_DB_MODE = "isolated-staging";
    await pool.query("DELETE FROM modo_hyperframes_staging.render_jobs");
  });
  afterEach(() => {
    if (previous.node === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previous.node;
    if (previous.recovery === undefined) delete process.env.MODO_HYPERFRAMES_RECOVERY_MODE;
    else process.env.MODO_HYPERFRAMES_RECOVERY_MODE = previous.recovery;
    if (previous.db === undefined) delete process.env.MODO_HYPERFRAMES_DB_MODE;
    else process.env.MODO_HYPERFRAMES_DB_MODE = previous.db;
  });
  afterAll(async () => { await pool?.end(); });

  it("persists jobs after adapter re-instantiation and isolates organizations", async () => {
    const initial = await queue.enqueue(base("test-durable-0001"), "sandbox-tenant-a");
    const nextInstance = new HyperframesStagingPgQueue(pool);
    expect((await nextInstance.get(initial.jobId, "sandbox-tenant-a"))?.jobId)
      .toBe(initial.jobId);
    expect(await nextInstance.get(initial.jobId, "sandbox-tenant-b")).toBeNull();
    expect(await nextInstance.claim(initial.jobId, "sandbox-tenant-b", "worker-a", 5000))
      .toBeNull();
    await expect(queue.enqueue(base("test-durable-0002"), "sandbox-tenant-b"))
      .rejects.toThrow(/TENANT_DENIED/);
    expect(initial.previewOnly).toBe(true);
    expect(initial.published).toBe(false);
  });

  it("deduplicates concurrent matching creates and rejects conflicting payloads", async () => {
    const intent = base("test-idempotent-0001");
    const result = await Promise.all(
      Array.from({ length: 5 }, () => queue.enqueue(intent, "sandbox-tenant-a")),
    );
    expect(new Set(result.map(x => x.jobId)).size).toBe(1);
    const count = await pool.query(
      "SELECT count(*)::int AS total FROM modo_hyperframes_staging.render_jobs",
    );
    expect(count.rows[0].total).toBe(1);
    await expect(queue.enqueue({
      ...intent, requestSha256: "c".repeat(64),
    }, "sandbox-tenant-a")).rejects.toThrow(/IDEMPOTENCY_CONFLICT/);
    const other = await queue.enqueue(base("test-idempotent-0001", "sandbox-tenant-b"),
      "sandbox-tenant-b");
    expect(other.jobId).not.toBe(result[0].jobId);
  });

  it("grants at most one competing lease and permanently rejects stale fences", async () => {
    const initial = await queue.enqueue(base("test-claim-0001"), "sandbox-tenant-a");
    const attempts = await Promise.all(
      Array.from({ length: 6 }, (_, i) =>
        queue.claim(initial.jobId, "sandbox-tenant-a", `worker-${i}`, 5000)),
    );
    const winners = attempts.filter(Boolean);
    expect(winners).toHaveLength(1);
    const first = winners[0]!;
    expect(first.status).toBe("running");
    expect(first.attempts).toBe(1);
    const refused = await queue.finish(
      initial.jobId, "sandbox-tenant-a", "different-worker",
      first.lease!.fence, artifact,
    );
    expect(refused).toBeNull();
    const retryable = await queue.fail(
      initial.jobId, "sandbox-tenant-a",
      first.lease!.workerId, first.lease!.fence,
    );
    expect(retryable?.status).toBe("queued");
    const second = await queue.claim(
      initial.jobId, "sandbox-tenant-a", "new-worker", 5000);
    expect(second?.attempts).toBe(2);
    expect(second?.lease?.fence).not.toBe(first.lease!.fence);
    expect(await queue.finish(
      initial.jobId, "sandbox-tenant-a", first.lease!.workerId,
      first.lease!.fence, artifact,
    )).toBeNull();
    const final = await queue.finish(initial.jobId, "sandbox-tenant-a",
      "new-worker", second!.lease!.fence, artifact);
    expect(final?.status).toBe("succeeded");
    expect(final?.published).toBe(false);
    expect(final?.artifact).toEqual(artifact);
    expect(await queue.claim(initial.jobId, "sandbox-tenant-a", "worker-last", 5000))
      .toBeNull();
  });

  it("caps retries and persists a terminal failed state", async () => {
    const initial = await queue.enqueue(base("test-retries-0001"), "sandbox-tenant-a");
    for (let n = 0; n < 3; n++) {
      const leased = await queue.claim(initial.jobId, "sandbox-tenant-a",
        "worker-retry", 5000);
      expect(leased?.attempts).toBe(n + 1);
      const failed = await queue.fail(initial.jobId, "sandbox-tenant-a",
        "worker-retry", leased!.lease!.fence);
      expect(failed?.status).toBe(n === 2 ? "failed" : "queued");
    }
    const last = await queue.get(initial.jobId, "sandbox-tenant-a");
    expect(last?.failureCode).toBe("RETRY_LIMIT_REACHED");
    expect(await queue.claim(initial.jobId, "sandbox-tenant-a", "worker-retry", 5000))
      .toBeNull();
  });

  it("never opens job access in production or with staging switches off", async () => {
    process.env.NODE_ENV = "production";
    await expect(queue.enqueue(base("test-gate-0001"), "sandbox-tenant-a"))
      .rejects.toThrow(/PG_DISABLED/);
    process.env.NODE_ENV = "test";
    delete process.env.MODO_HYPERFRAMES_DB_MODE;
    await expect(queue.enqueue(base("test-gate-0002"), "sandbox-tenant-a"))
      .rejects.toThrow(/PG_DISABLED/);
  });
});
