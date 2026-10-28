import { execFile } from "node:child_process";
import { randomBytes, createHash } from "node:crypto";
import { mkdtemp, chmod, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import pg from "pg";
import { VideoProjectSchema } from "@modo/contracts/video";
import { HyperframesStagingPgSnapshots } from "../services/hyperframes-staging-pg-snapshots.js";
import { HyperframesStagingPgQueue } from "../services/hyperframes-staging-pg-queue.js";
import { HyperframesStagingPgArtifacts } from "../services/hyperframes-staging-pg-artifacts.js";
import { signStagingWorkOrder } from "../services/hyperframes-staging-pg-work-order.js";

const execute = promisify(execFile);
const ORG = "isolated-real-cli-ci";
const PROJECT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const BRAND = "MODO synthetic E2E";
const WORKER = "isolated-ci-worker-one";
// Only fixed, non-sensitive stage names are printed on failure.
let ciStage: "preflight" | "database" | "snapshot" | "signed_order" | "worker" | "artifact" | "replay" | "cleanup" = "preflight";

function requireSafeCI(): string {
  if (process.env.NODE_ENV === "production" ||
      process.env.MODO_HYPERFRAMES_REAL_PG_CI !== "isolated-staging") {
    throw new Error("HYPERFRAMES_REAL_PG_CI_DISABLED");
  }
  for (const flag of [
    "MODO_HYPERFRAMES_WORKER_MODE",
    "MODO_HYPERFRAMES_RECOVERY_MODE",
    "MODO_HYPERFRAMES_DB_MODE",
    "MODO_HYPERFRAMES_STORAGE_MODE",
  ]) {
    if (process.env[flag] !== "isolated-staging") {
      throw new Error("HYPERFRAMES_REAL_PG_CI_DISABLED");
    }
  }
  const url = process.env.MODO_HYPERFRAMES_PG_TEST_DATABASE_URL;
  if (!url) throw new Error("HYPERFRAMES_REAL_PG_CI_NO_DATABASE");
  const parsed = new URL(url);
  if (parsed.hostname !== "127.0.0.1" && parsed.hostname !== "localhost") {
    throw new Error("HYPERFRAMES_REAL_PG_CI_NOT_LOOPBACK");
  }
  if (parsed.pathname !== "/modo_hyperframes_staging") {
    throw new Error("HYPERFRAMES_REAL_PG_CI_WRONG_DATABASE");
  }
  return url;
}

const syntheticProject = VideoProjectSchema.parse({
  id: PROJECT,
  organizationId: ORG,
  brandId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  contentRequestId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  durationSeconds: 15,
  aspectRatio: "9:16",
  fps: 30,
  captions: true,
  voiceover: false,
  voiceProvider: null,
  visualProvider: null,
  brollProvider: null,
  status: "queued",
  renderer: "remotion",
  outputUrl: null,
  mimeType: null,
  error: null,
  createdAt: "2026-10-27T00:00:00.000Z",
  updatedAt: "2026-10-27T00:00:00.000Z",
  scenes: [
    {
      index: 1, startFrame: 0, endFrame: 225,
      headline: "Render real isolado",
      caption: "Composicao sem clientes",
      visual: "Apenas texto gerado para o teste",
      imageUrl: null, videoUrl: null,
      visualType: "kinetic_text", assetSource: "native",
      motion: "static", transition: "cut",
    },
    {
      index: 2, startFrame: 225, endFrame: 450,
      headline: "Criptografia e recovery",
      caption: "Sem publicacao",
      visual: "Validacao automatica",
      imageUrl: null, videoUrl: null,
      visualType: "kinetic_text", assetSource: "native",
      motion: "static", transition: "cut",
    },
  ],
});

async function run() {
  const databaseUrl = requireSafeCI();
  const bin = process.env.MODO_HYPERFRAMES_BIN;
  const ffprobe = process.env.MODO_HYPERFRAMES_FFPROBE_BIN;
  if (!bin?.startsWith("/") || !ffprobe?.startsWith("/")) {
    throw new Error("HYPERFRAMES_REAL_PG_CI_MISSING_PINNED_TOOLS");
  }
  const dir = await mkdtemp(join(tmpdir(), "modo-hf-signed-real-e2e-"));
  const orderPath = join(dir, "private-order.json");
  const contentKey = randomBytes(32);
  const signingKey = randomBytes(32);
  const pool = new pg.Pool({
    connectionString: databaseUrl, max: 4,
    connectionTimeoutMillis: 5000,
  });
  const snapshots = new HyperframesStagingPgSnapshots(pool, { key: contentKey });
  const artifacts = new HyperframesStagingPgArtifacts(pool, { key: contentKey });
  const queue = new HyperframesStagingPgQueue(pool);
  try {
    ciStage = "database";
    const database = await pool.query("SELECT current_database() AS db");
    if (database.rows[0]?.db !== "modo_hyperframes_staging") {
      throw new Error("HYPERFRAMES_REAL_PG_CI_WRONG_DATABASE");
    }
    ciStage = "snapshot";
    const job = await snapshots.enqueue({
      project: syntheticProject,
      brandName: BRAND,
      idempotencyKey: "real-cli-e2e-fixture-20261027",
      authorizedOrganizationId: ORG,
    });
    ciStage = "signed_order";
    const order = signStagingWorkOrder({
      jobId: job.jobId, organizationId: ORG,
      workerId: WORKER, requestSha256: job.requestSha256,
    }, signingKey, Date.now(), 120_000);
    await writeFile(orderPath, JSON.stringify(order), { mode: 0o600 });
    await chmod(orderPath, 0o600);
    const childEnvironment: NodeJS.ProcessEnv = {
      PATH: process.env.PATH || "/usr/bin:/bin",
      HOME: dir,
      LANG: "C.UTF-8",
      NODE_ENV: "test",
      MODO_HYPERFRAMES_ONE_SHOT_MODE: "isolated-staging",
      MODO_HYPERFRAMES_WORKER_MODE: "isolated-staging",
      MODO_HYPERFRAMES_RECOVERY_MODE: "isolated-staging",
      MODO_HYPERFRAMES_DB_MODE: "isolated-staging",
      MODO_HYPERFRAMES_STORAGE_MODE: "isolated-staging",
      MODO_HYPERFRAMES_STAGE_DB_URL: databaseUrl,
      MODO_HYPERFRAMES_LOCAL_WORKER_ID: WORKER,
      MODO_HYPERFRAMES_SIGNING_KEY_B64: signingKey.toString("base64"),
      MODO_HYPERFRAMES_CONTENT_KEY_B64: contentKey.toString("base64"),
      MODO_HYPERFRAMES_BIN: bin,
      MODO_HYPERFRAMES_FFPROBE_BIN: ffprobe,
    };
    // The only process allowed to run the actual CLI. Its script and worker
    // executable paths are absolute and its stdout is restricted/sanitized.
    const worker = resolve("apps/api/dist/scripts/hyperframes-staging-one-shot.js");
    ciStage = "worker";
    const { stdout } = await execute(process.execPath, [worker, orderPath], {
      cwd: process.cwd(), env: childEnvironment,
      timeout: 540_000, maxBuffer: 8_192, windowsHide: true,
    });
    const output: unknown = JSON.parse(stdout.trim());
    if (!output || typeof output !== "object" ||
        !("kind" in output) || output.kind !== "completed") {
      throw new Error("HYPERFRAMES_REAL_PG_CI_INCOMPLETE");
    }
    ciStage = "artifact";
    const status = await queue.get(job.jobId, ORG);
    if (status?.status !== "succeeded" || !status.artifact ||
        status.previewOnly !== true || status.published !== false ||
        status.attempts !== 1 || status.artifact.bytes < 4000 ||
        status.artifact.bytes > 25_000_000) {
      throw new Error("HYPERFRAMES_REAL_PG_CI_BAD_JOB_STATE");
    }
    const bytes = await artifacts.read(job.jobId, ORG);
    if (!bytes || bytes.subarray(4, 8).toString("ascii") !== "ftyp" ||
        createHash("sha256").update(bytes).digest("hex") !== status.artifact.sha256) {
      throw new Error("HYPERFRAMES_REAL_PG_CI_BAD_STORED_MP4");
    }
    bytes.fill(0);
    const noCrossTenant = await artifacts.read(job.jobId, "other-org");
    if (noCrossTenant !== null) {
      throw new Error("HYPERFRAMES_REAL_PG_CI_TENANT_LEAK");
    }
    // A second run with the same signed order must not rerender.
    ciStage = "replay";
    const again = await execute(process.execPath, [worker, orderPath], {
      cwd: process.cwd(), env: childEnvironment, timeout: 15_000,
      maxBuffer: 8_192, windowsHide: true,
    });
    if (JSON.parse(again.stdout.trim()).kind !== "unclaimed" ||
        (await queue.get(job.jobId, ORG))?.attempts !== 1) {
      throw new Error("HYPERFRAMES_REAL_PG_CI_DUPLICATED");
    }
    // Never print client/source content or crypto keys to CI logs.
    process.stdout.write(JSON.stringify({
      passed: true, stagedEncrypted: true, realCli: true,
      previewOnly: true, published: false,
    }) + "\n");
  } finally {
    await pool.query(
      "DELETE FROM modo_hyperframes_staging.render_jobs WHERE organization_id=$1",
      [ORG],
    ).catch(() => undefined);
    snapshots.close();
    artifacts.close();
    contentKey.fill(0);
    signingKey.fill(0);
    await pool.end();
    await rm(dir, { recursive: true, force: true });
  }
}
void run().catch((error: unknown) => {
  const safe = error instanceof Error && /^HYPERFRAMES_[A-Z0-9_]+$/.test(error.message)
    ? error.message : `HYPERFRAMES_REAL_PG_CI_${ciStage.toUpperCase()}_FAILED`;
  // The one-shot executable deliberately emits only whitelisted error codes.
  // Never show a raw execFile error, stderr, stdout, customer payload, path or key.
  const childCode = error && typeof error === "object" && "stderr" in error &&
    typeof error.stderr === "string" && /^HYPERFRAMES_[A-Z0-9_]+\n?$/.test(error.stderr)
    ? error.stderr.trim() : null;
  process.stderr.write(safe + (childCode ? ` (${childCode})` : "") + "\n");
  process.exitCode = 1;
});
