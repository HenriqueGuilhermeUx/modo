import { randomBytes } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import pg, { type Pool } from "pg";
import { VideoProjectSchema } from "@modo/contracts/video";
import { HyperframesStagingPgQueue } from "./hyperframes-staging-pg-queue.js";
import { HyperframesStagingPgSnapshots } from "./hyperframes-staging-pg-snapshots.js";
import { HyperframesStagingPgArtifacts } from "./hyperframes-staging-pg-artifacts.js";
import { processStagingHyperframesPgJob } from "./hyperframes-staging-pg-render-runner.js";

const dbUrl = process.env.MODO_HYPERFRAMES_PG_TEST_DATABASE_URL;
const original = {
  node: process.env.NODE_ENV,
  worker: process.env.MODO_HYPERFRAMES_WORKER_MODE,
  recovery: process.env.MODO_HYPERFRAMES_RECOVERY_MODE,
  database: process.env.MODO_HYPERFRAMES_DB_MODE,
  storage: process.env.MODO_HYPERFRAMES_STORAGE_MODE,
};
const tenant = "snapshot-tenant-a";
const project = () => VideoProjectSchema.parse({
  id: "11111111-1111-4111-8111-111111111111",
  organizationId: tenant,
  brandId: "22222222-2222-4222-8222-222222222222",
  contentRequestId: "33333333-3333-4333-8333-333333333333",
  durationSeconds: 15, aspectRatio: "9:16", fps: 30,
  captions: true, voiceover: false, voiceProvider: null,
  visualProvider: null, brollProvider: null,
  status: "queued", renderer: "remotion",
  outputUrl: null, mimeType: null, error: null,
  createdAt: "2026-10-27T00:00:00.000Z",
  updatedAt: "2026-10-27T00:00:00.000Z",
  scenes: [
    {
      index: 1, startFrame: 0, endFrame: 225,
      headline: "Primeira cena", caption: "Somente dados fictícios",
      visual: "Texto para demonstração.",
      imageUrl: null, videoUrl: null,
      visualType: "kinetic_text", motion: "static",
      transition: "cut", assetSource: "native",
    },
    {
      index: 2, startFrame: 225, endFrame: 450,
      headline: "Segunda cena", caption: "Sem vídeo de clientes",
      visual: "Texto fictício.", imageUrl: null, videoUrl: null,
      visualType: "kinetic_text", motion: "static",
      transition: "cut", assetSource: "native",
    },
  ],
});
const video = () => {
  const b = Buffer.alloc(5000, 7);
  b.write("ftyp", 4, "ascii");
  return b;
};
const rendered = async (input: ReturnType<typeof project>) => {
  const bytes = video();
  const { createHash } = await import("node:crypto");
  return {
    projectId: input.id, organizationId: input.organizationId,
    mimeType: "video/mp4" as const, video: bytes,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    bytes: bytes.length, width: 1080, height: 1920,
    durationSeconds: 15, previewOnly: true as const,
    published: false as const,
  };
};
const tools = {
  hyperframesExecutable: "/usr/local/bin/hyperframes",
  ffprobeExecutable: "/usr/bin/ffprobe",
};
let pool: Pool;
let key: Buffer;
let snapshots: HyperframesStagingPgSnapshots;
let artifacts: HyperframesStagingPgArtifacts;
let queue: HyperframesStagingPgQueue;
let counter = 0;
const make = () => snapshots.enqueue({
  project: project(), brandName: "Marca fictícia",
  idempotencyKey: "snapshot-test-" + (++counter),
  authorizedOrganizationId: tenant,
});

describe.skipIf(!dbUrl)("staging encrypted immutable source snapshots", () => {
  beforeAll(async () => {
    const { Pool: PgPool } = pg;
    pool = new PgPool({ connectionString: dbUrl, ssl: false, max: 8 });
    const result = await pool.query("SELECT current_database() AS db");
    if (result.rows[0]?.db !== "modo_hyperframes_staging") {
      throw new Error("HYPERFRAMES_SNAPSHOT_TEST_WRONG_DATABASE");
    }
  });
  beforeEach(async () => {
    process.env.NODE_ENV = "test";
    for (const flag of [
      "MODO_HYPERFRAMES_WORKER_MODE",
      "MODO_HYPERFRAMES_RECOVERY_MODE",
      "MODO_HYPERFRAMES_DB_MODE",
      "MODO_HYPERFRAMES_STORAGE_MODE",
    ]) process.env[flag] = "isolated-staging";
    await pool.query(
      "DELETE FROM modo_hyperframes_staging.render_jobs WHERE organization_id LIKE $1",
      ["snapshot-tenant-%"]);
    key = randomBytes(32);
    snapshots = new HyperframesStagingPgSnapshots(pool, { key });
    artifacts = new HyperframesStagingPgArtifacts(pool, { key });
    queue = new HyperframesStagingPgQueue(pool);
  });
  afterEach(() => {
    snapshots.close();
    artifacts.close();
    key.fill(0);
    for (const [name, value] of [
      ["NODE_ENV", original.node],
      ["MODO_HYPERFRAMES_WORKER_MODE", original.worker],
      ["MODO_HYPERFRAMES_RECOVERY_MODE", original.recovery],
      ["MODO_HYPERFRAMES_DB_MODE", original.database],
      ["MODO_HYPERFRAMES_STORAGE_MODE", original.storage],
    ] as const) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });
  afterAll(async () => { await pool?.end(); });

  it("atomically creates a job with encrypted source and rehydrates on a new instance", async () => {
    const job = await make();
    expect(job.status).toBe("queued");
    const records = await pool.query(
      "SELECT ciphertext,byte_length FROM modo_hyperframes_staging.render_snapshots WHERE job_id=$1",
      [job.jobId],
    );
    expect(records.rowCount).toBe(1);
    expect(records.rows[0].ciphertext.toString("utf8")).not.toContain("Primeira cena");
    const restart = new HyperframesStagingPgSnapshots(pool, { key });
    const data = await restart.load(job.jobId, tenant);
    expect(data?.project).toEqual(project());
    expect(data?.brandName).toBe("Marca fictícia");
    expect(await restart.load(job.jobId, "snapshot-tenant-b")).toBeNull();
    restart.close();
  });

  it("restores exactly the original immutable source, not an edited project", async () => {
    const job = await make();
    const p = project();
    p.scenes[0].headline = "Editado pelo usuário após a criação";
    const saved = await snapshots.load(job.jobId, tenant);
    expect(saved?.project.scenes[0].headline).toBe("Primeira cena");
    expect(saved?.project.scenes[0].headline).not.toBe(p.scenes[0].headline);
    const result = await processStagingHyperframesPgJob({
      jobId: job.jobId,
      project: saved!.project,
      brandName: saved!.brandName,
      authorizedOrganizationId: tenant,
      workerId: "snapshot-worker",
      queue, artifacts, tools,
      render: rendered,
    });
    expect(result.kind).toBe("completed");
    expect(await artifacts.read(job.jobId, tenant)).toEqual(video());
    expect(await snapshots.load(job.jobId, tenant)).toBeNull();
  });

  it("deduplicates matching concurrent source and job creation", async () => {
    const req = {
      project: project(), brandName: "Marca fictícia",
      idempotencyKey: "snapshot-idempotent-001",
      authorizedOrganizationId: tenant,
    };
    const created = await Promise.all(
      Array.from({ length: 4 }, () => snapshots.enqueue(req)),
    );
    expect(new Set(created.map(j => j.jobId)).size).toBe(1);
    const rows = await pool.query(
      "SELECT count(*)::int AS count FROM modo_hyperframes_staging.render_snapshots" +
      " WHERE organization_id=$1",
      [tenant],
    );
    expect(rows.rows[0].count).toBe(1);
    await expect(snapshots.enqueue({
      ...req, brandName: "Marca diferente",
    })).rejects.toThrow(/IDEMPOTENCY_CONFLICT/);
  });

  it("rolls back job creation when source violates tenant or project constraints", async () => {
    await expect(snapshots.enqueue({
      project: project(), brandName: "Marca",
      idempotencyKey: "snapshot-mismatch-001",
      authorizedOrganizationId: "snapshot-tenant-b",
    })).rejects.toThrow(/TENANT_DENIED/);
    const invalid = project();
    invalid.scenes[0].motion = "zoom_out";
    await expect(snapshots.enqueue({
      project: invalid, brandName: "Marca",
      idempotencyKey: "snapshot-incompatible-001",
      authorizedOrganizationId: tenant,
    })).rejects.toThrow(/INVALID_PROJECT/);
    const rows = await pool.query(
      "SELECT count(*)::int AS count FROM modo_hyperframes_staging.render_jobs" +
      " WHERE organization_id LIKE 'snapshot-tenant-%'",
    );
    expect(rows.rows[0].count).toBe(0);
  });

  it("detects tampering and never decrypts another tenant's source", async () => {
    const job = await make();
    const incorrect = new HyperframesStagingPgSnapshots(
      pool, { key: randomBytes(32) });
    await expect(incorrect.load(job.jobId, tenant))
      .rejects.toThrow(/INTEGRITY_FAILED/);
    incorrect.close();
    await pool.query(
      "UPDATE modo_hyperframes_staging.render_snapshots" +
      " SET ciphertext=overlay(ciphertext placing decode('ff','hex') from 1 for 1)" +
      " WHERE job_id=$1", [job.jobId],
    );
    await expect(snapshots.load(job.jobId, tenant))
      .rejects.toThrow(/INTEGRITY_FAILED/);
    expect(await snapshots.load(job.jobId, "snapshot-tenant-b")).toBeNull();
  });

  it("refuses expired snapshots and production mode", async () => {
    const job = await make();
    await pool.query(
      "UPDATE modo_hyperframes_staging.render_snapshots SET expires_ms=created_ms+1" +
      " WHERE job_id=$1", [job.jobId],
    );
    expect(await snapshots.load(job.jobId, tenant)).toBeNull();
    expect(await snapshots.pruneExpired()).toBeGreaterThan(0);
    process.env.NODE_ENV = "production";
    await expect(snapshots.load(job.jobId, tenant))
      .rejects.toThrow(/SNAPSHOTS_DISABLED/);
  });
});
