import { createHash, randomBytes } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { VideoProject } from "@modo/contracts/video";
import pg, { type Pool } from "pg";
import { HyperframesStagingPgQueue } from "./hyperframes-staging-pg-queue.js";
import { HyperframesStagingPgArtifacts } from "./hyperframes-staging-pg-artifacts.js";
import { processStagingHyperframesPgJob, stagingRenderRequestSha256 } from "./hyperframes-staging-pg-render-runner.js";

const dbUrl = process.env.MODO_HYPERFRAMES_PG_TEST_DATABASE_URL;
const original = {
  node: process.env.NODE_ENV,
  worker: process.env.MODO_HYPERFRAMES_WORKER_MODE,
  recovery: process.env.MODO_HYPERFRAMES_RECOVERY_MODE,
  database: process.env.MODO_HYPERFRAMES_DB_MODE,
  storage: process.env.MODO_HYPERFRAMES_STORAGE_MODE,
};
const project = (id: string, organizationId = "worker-tenant-a") => ({
  id, organizationId, durationSeconds: 15, aspectRatio: "9:16",
  fps: 30, voiceover: false, voiceProvider: null, scenes: [{
    index: 1, startFrame: 0, endFrame: 225,
    headline: "Demonstração sem cliente", caption: "Apenas vídeo sintético.",
    visualType: "kinetic_text", assetSource: "native",
    imageUrl: null, videoUrl: null,
    motion: "static", transition: "cut",
  }, {
    index: 2, startFrame: 225, endFrame: 450,
    headline: "Segunda cena", caption: "Sem acesso externo.",
    visualType: "kinetic_text", assetSource: "native",
    imageUrl: null, videoUrl: null,
    motion: "static", transition: "cut",
  }],
}) as unknown as VideoProject;
const syntheticVideo = () => {
  const video = Buffer.alloc(5000, 17);
  video.write("ftyp", 4, "ascii");
  return video;
};
const render = async (source: VideoProject) => {
  const video = syntheticVideo();
  return {
    projectId: source.id, organizationId: source.organizationId,
    mimeType: "video/mp4" as const, video,
    sha256: createHash("sha256").update(video).digest("hex"),
    bytes: video.length, width: 1080, height: 1920, durationSeconds: 15,
    previewOnly: true as const, published: false as const,
  };
};
const tools = { hyperframesExecutable: "/usr/local/bin/hyperframes",
  ffprobeExecutable: "/usr/bin/ffprobe" };
let pool: Pool;
let queue: HyperframesStagingPgQueue;
let artifacts: HyperframesStagingPgArtifacts;
let key: Buffer;
const schedule = async (id: string, brandName = "Marca Sintética") => {
  const input = project(id);
  const job = await queue.enqueue({
    organizationId: input.organizationId, projectId: input.id,
    idempotencyKey: "idempotency-" + id,
    requestSha256: stagingRenderRequestSha256(input, brandName),
  }, "worker-tenant-a");
  return { job, input, brandName };
};
const execute = (
  fixture: Awaited<ReturnType<typeof schedule>>,
  renderer: typeof render = render,
  options: Partial<{ workerId: string; leaseMs: number; heartbeatMs: number }> = {},
) => processStagingHyperframesPgJob({
  jobId: fixture.job.jobId, project: fixture.input,
  brandName: fixture.brandName, authorizedOrganizationId: "worker-tenant-a",
  workerId: options.workerId || "worker-synthetic",
  leaseMs: options.leaseMs, heartbeatMs: options.heartbeatMs,
  queue, artifacts, tools, render: renderer,
});

describe.skipIf(!dbUrl)("HyperFrames isolated PostgreSQL worker runner integration", () => {
  beforeAll(async () => {
    const { Pool: PgPool } = pg;
    pool = new PgPool({ connectionString: dbUrl, ssl: false, max: 8 });
    const result = await pool.query("SELECT current_database() AS name");
    if (result.rows[0]?.name !== "modo_hyperframes_staging") {
      throw new Error("HYPERFRAMES_PG_RUNNER_TEST_WRONG_DATABASE");
    }
  });
  beforeEach(async () => {
    process.env.NODE_ENV = "test";
    process.env.MODO_HYPERFRAMES_WORKER_MODE = "isolated-staging";
    process.env.MODO_HYPERFRAMES_RECOVERY_MODE = "isolated-staging";
    process.env.MODO_HYPERFRAMES_DB_MODE = "isolated-staging";
    process.env.MODO_HYPERFRAMES_STORAGE_MODE = "isolated-staging";
    await pool.query(
      "DELETE FROM modo_hyperframes_staging.render_jobs WHERE organization_id LIKE $1",
      ["worker-tenant-%"]);
    key = randomBytes(32);
    queue = new HyperframesStagingPgQueue(pool);
    artifacts = new HyperframesStagingPgArtifacts(pool, { key });
  });
  afterEach(() => {
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

  it("renders a synthetic job once, atomically stores encrypted MP4, and reads it back", async () => {
    const task = await schedule("11111111-1111-4111-8111-111111111111");
    const outcome = await execute(task);
    expect(outcome.kind).toBe("completed");
    expect(outcome.job?.status).toBe("succeeded");
    expect(outcome.job?.published).toBe(false);
    expect(outcome.job?.artifact?.bytes).toBe(5000);
    expect(await artifacts.read(task.job.jobId, "worker-tenant-b")).toBeNull();
    expect(await artifacts.read(task.job.jobId, "worker-tenant-a"))
      .toEqual(syntheticVideo());
    const again = await execute(task, async () => {
      throw new Error("renderer should never run twice");
    });
    expect(again.kind).toBe("unclaimed");
    expect((await queue.get(task.job.jobId, "worker-tenant-a"))?.attempts).toBe(1);
  });

  it("integrates the real worker code path with mocked local CLI and ffprobe", async () => {
    const task = await schedule("88888888-8888-4888-8888-888888888888");
    const invoked: string[] = [];
    const simulatedTools = {
      ...tools,
      execute: async (command: string, args: string[], options: {
        cwd: string; env: NodeJS.ProcessEnv;
      }) => {
        expect(options.env.FINSIGHT_INTERNAL_API_KEY).toBeUndefined();
        invoked.push(command + ":" + args[0]);
        if (args[0] === "render") {
          await writeFile(join(options.cwd, "sample.mp4"), syntheticVideo());
        }
        if (command === tools.ffprobeExecutable) {
          return { stdout: JSON.stringify({
            streams: [{
              codec_type: "video", width: 1080, height: 1920,
              r_frame_rate: "30/1",
            }],
            format: { duration: "15.000000" },
          }) };
        }
        return { stdout: "" };
      },
    };
    const outcome = await processStagingHyperframesPgJob({
      jobId: task.job.jobId, project: task.input,
      brandName: task.brandName,
      authorizedOrganizationId: "worker-tenant-a",
      workerId: "worker-pinned-cli-synthetic",
      queue, artifacts, tools: simulatedTools,
    });
    expect(outcome.kind).toBe("completed");
    expect(invoked).toEqual([
      tools.hyperframesExecutable + ":lint",
      tools.hyperframesExecutable + ":check",
      tools.hyperframesExecutable + ":render",
      tools.ffprobeExecutable + ":-v",
    ]);
    expect(await artifacts.read(task.job.jobId, "worker-tenant-a"))
      .toEqual(syntheticVideo());
  });

  it("rejects a changed project or brand before claiming and without executing render", async () => {
    const task = await schedule("22222222-2222-4222-8222-222222222222");
    let called = false;
    const modified = { ...task, brandName: "Marca adversária" };
    await expect(execute(modified, async (p) => {
      called = true;
      return render(p);
    })).rejects.toThrow(/REQUEST_MISMATCH/);
    expect(called).toBe(false);
    expect((await queue.get(task.job.jobId, "worker-tenant-a"))?.attempts).toBe(0);
    await expect(processStagingHyperframesPgJob({
      jobId: task.job.jobId, project: task.input, brandName: task.brandName,
      authorizedOrganizationId: "worker-tenant-b",
      workerId: "worker-synthetic", queue, artifacts, tools, render,
    })).rejects.toThrow(/TENANT_DENIED/);
  });

  it("uses the request snapshot even if the original project is edited during rendering", async () => {
    const task = await schedule("77777777-7777-4777-8777-777777777777");
    const originalHeadline = task.input.scenes[0].headline;
    const result = await execute(task, async (p) => {
      task.input.scenes[0].headline = "Alteração tardia não autorizada";
      expect(p.scenes[0].headline).toBe(originalHeadline);
      expect(stagingRenderRequestSha256(p, task.brandName))
        .toBe(task.job.requestSha256);
      return render(p);
    });
    expect(result.kind).toBe("completed");
    expect(task.input.scenes[0].headline).not.toBe(originalHeadline);
  });

  it("sanitizes renderer errors and allows a retry with a fresh fence", async () => {
    const task = await schedule("33333333-3333-4333-8333-333333333333");
    const failure = await execute(task, async () => {
      throw new Error("an upstream secret should never appear here");
    });
    expect(failure.kind).toBe("failed");
    expect(failure.job?.status).toBe("queued");
    expect(JSON.stringify(failure)).not.toContain("an upstream secret");
    const retry = await execute(task);
    expect(retry.kind).toBe("completed");
    expect(retry.job?.attempts).toBe(2);
  });

  it("rejects stale worker completion after the database lease is reassigned", async () => {
    const task = await schedule("44444444-4444-4444-8444-444444444444");
    let releaseRender: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => { releaseRender = resolve; });
    let begin!: () => void;
    const started = new Promise<void>((resolve) => { begin = resolve; });
    const pending = execute(task, async (p) => {
      begin();
      await gate;
      return render(p);
    });
    await started;
    const running = await queue.get(task.job.jobId, "worker-tenant-a");
    expect(running?.status).toBe("running");
    const manuallyFailed = await queue.fail(
      task.job.jobId, "worker-tenant-a",
      "worker-synthetic", running!.lease!.fence);
    expect(manuallyFailed?.status).toBe("queued");
    const newer = await queue.claim(task.job.jobId, "worker-tenant-a",
      "worker-replacement", 60_000);
    expect(newer?.attempts).toBe(2);
    releaseRender!();
    expect((await pending).kind).toBe("lost-lease");
    expect(await artifacts.read(task.job.jobId, "worker-tenant-a")).toBeNull();
    expect((await queue.get(task.job.jobId, "worker-tenant-a"))?.status)
      .toBe("running");
  });

  it("renews short leases during a long-running render before encrypted commit", async () => {
    const task = await schedule("55555555-5555-4555-8555-555555555555");
    const outcome = await execute(task, async (p) => {
      await new Promise<void>((resolve) => setTimeout(resolve, 1200));
      return render(p);
    }, { leaseMs: 1000, heartbeatMs: 125 });
    expect(outcome.kind).toBe("completed");
    expect(outcome.job?.status).toBe("succeeded");
    expect(outcome.job?.attempts).toBe(1);
  });

  it("fails closed on invalid video metadata and on missing staging flags", async () => {
    const task = await schedule("66666666-6666-4666-8666-666666666666");
    const invalid = await execute(task, async (p) => ({
      ...(await render(p)), organizationId: "worker-tenant-b",
    }));
    expect(invalid.kind).toBe("failed");
    expect(await artifacts.read(task.job.jobId, "worker-tenant-a")).toBeNull();
    delete process.env.MODO_HYPERFRAMES_WORKER_MODE;
    await expect(execute(task)).rejects.toThrow(/RUNNER_DISABLED/);
  });
});
