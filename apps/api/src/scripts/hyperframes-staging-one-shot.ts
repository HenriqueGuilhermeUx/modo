import { open } from "node:fs/promises";
import { constants } from "node:fs";
import { isAbsolute } from "node:path";
import { timingSafeEqual } from "node:crypto";
import pg from "pg";
import { HyperframesStagingPgQueue } from "../services/hyperframes-staging-pg-queue.js";
import { HyperframesStagingPgSnapshots } from "../services/hyperframes-staging-pg-snapshots.js";
import { HyperframesStagingPgArtifacts } from "../services/hyperframes-staging-pg-artifacts.js";
import {
  runSignedStagingWorkOrder,
  type SignedStagingWorkOrder,
} from "../services/hyperframes-staging-pg-work-order.js";

const REQUIRED = [
  "MODO_HYPERFRAMES_WORKER_MODE", "MODO_HYPERFRAMES_RECOVERY_MODE",
  "MODO_HYPERFRAMES_DB_MODE", "MODO_HYPERFRAMES_STORAGE_MODE",
  "MODO_HYPERFRAMES_ONE_SHOT_MODE",
] as const;

function decodeSecret(name: string): Buffer {
  const raw = process.env[name];
  // Strict RFC4648 padded 32-byte base64, no whitespace or ignored chars.
  if (!raw || !/^[A-Za-z0-9+/]{43}=$/.test(raw)) {
    throw new Error("HYPERFRAMES_ONE_SHOT_MISSING_SECRET");
  }
  const buffer = Buffer.from(raw, "base64");
  if (buffer.byteLength !== 32 || buffer.toString("base64") !== raw) {
    buffer.fill(0);
    throw new Error("HYPERFRAMES_ONE_SHOT_INVALID_SECRET");
  }
  return buffer;
}

function stagingDatabaseUrl(): string {
  const raw = process.env.MODO_HYPERFRAMES_STAGE_DB_URL;
  if (!raw) throw new Error("HYPERFRAMES_ONE_SHOT_DATABASE_REQUIRED");
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new Error("HYPERFRAMES_ONE_SHOT_INVALID_DATABASE");
  }
  if (!["postgres:", "postgresql:"].includes(u.protocol) ||
      decodeURIComponent(u.pathname) !== "/modo_hyperframes_staging" ||
      !u.hostname || !u.username ||
      u.hash) {
    throw new Error("HYPERFRAMES_ONE_SHOT_INVALID_DATABASE");
  }
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(u.hostname);
  // Remote workers must validate the staging DB certificate; never allow
  // sslmode=disable/require or a wildcard trust store on remote addresses.
  if (!loopback && u.searchParams.get("sslmode") !== "verify-full") {
    throw new Error("HYPERFRAMES_ONE_SHOT_DB_TLS_REQUIRED");
  }
  return raw;
}

/**
 * For a container with --network none, PostgreSQL is accessible ONLY via a
 * shared Unix-domain socket. No TCP listener, DNS or external egress needed.
 * The socket is allowlisted, and the worker DB password is stored in a
 * privately mounted regular file with no symlinks.
 *
 * Existing URL mode is kept for disposable GitHub CI and isolated remote
 * staging environments with verified TLS; both modes are mutually exclusive.
 */
async function stagingDatabaseConfig(): Promise<pg.PoolConfig> {
  const socket = process.env.MODO_HYPERFRAMES_STAGE_DB_SOCKET;
  if (!socket) {
    return { connectionString: stagingDatabaseUrl() };
  }
  if (socket !== "/var/run/postgresql" ||
      process.env.MODO_HYPERFRAMES_STAGE_DB_URL ||
      process.env.MODO_HYPERFRAMES_STAGE_DB_USER !== "hf_staging_worker" ||
      process.env.MODO_HYPERFRAMES_STAGE_DB_PASSWORD_FILE !==
        "/run/hyperframes/db-password") {
    throw new Error("HYPERFRAMES_ONE_SHOT_SOCKET_CONFIG_DENIED");
  }
  const handle = await open(
    "/run/hyperframes/db-password", constants.O_RDONLY | constants.O_NOFOLLOW);
  let password = "";
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.size < 16 || info.size > 512 ||
        (info.mode & 0o077) !== 0 ||
        info.uid !== process.getuid()) {
      throw new Error("HYPERFRAMES_ONE_SHOT_UNSAFE_DB_PASSWORD_FILE");
    }
    password = (await handle.readFile({ encoding: "utf8" })).replace(/\\r?\\n$/, "");
    if (password.length < 16 || password.length > 512 ||
        /[\\r\\n\\0]/.test(password)) {
      throw new Error("HYPERFRAMES_ONE_SHOT_INVALID_DB_PASSWORD");
    }
    return {
      host: socket,
      database: "modo_hyperframes_staging",
      user: "hf_staging_worker",
      password,
    };
  } finally {
    await handle.close();
  }
}

async function main() {
  if (process.env.NODE_ENV === "production" ||
      REQUIRED.some(name => process.env[name] !== "isolated-staging")) {
    throw new Error("HYPERFRAMES_ONE_SHOT_DISABLED");
  }
  if (process.argv.length !== 3 || !isAbsolute(process.argv[2])) {
    throw new Error("HYPERFRAMES_ONE_SHOT_EXPECTS_PRIVATE_ABSOLUTE_ORDER_FILE");
  }
  const orderPath = process.argv[2];
  // Open once, refuse symlinks and inspect the SAME inode we read.
  // A stat-then-read path check would allow a swapped symlink to bypass
  // private-order-file policy on a shared staging mount.
  const file = await open(orderPath, constants.O_RDONLY | constants.O_NOFOLLOW);
  let orderJson: string;
  try {
    const details = await file.stat();
    if (!details.isFile() || details.size < 80 || details.size > 8_192 ||
        (details.mode & 0o077) !== 0) {
      throw new Error("HYPERFRAMES_ONE_SHOT_UNSAFE_ORDER_FILE");
    }
    orderJson = await file.readFile({ encoding: "utf8" });
  } finally {
    await file.close();
  }
  const localWorkerId = process.env.MODO_HYPERFRAMES_LOCAL_WORKER_ID;
  const hyperframesExecutable = process.env.MODO_HYPERFRAMES_BIN;
  const ffprobeExecutable = process.env.MODO_HYPERFRAMES_FFPROBE_BIN;
  if (!localWorkerId ||
      !hyperframesExecutable || !isAbsolute(hyperframesExecutable) ||
      !ffprobeExecutable || !isAbsolute(ffprobeExecutable)) {
    throw new Error("HYPERFRAMES_ONE_SHOT_UNPINNED_WORKER");
  }
  const dbConfig = await stagingDatabaseConfig();
  let signingKey: Buffer | null = null;
  let contentKey: Buffer | null = null;
  let snapshots: HyperframesStagingPgSnapshots | null = null;
  let artifacts: HyperframesStagingPgArtifacts | null = null;
  let pool: pg.Pool | null = null;
  try {
    signingKey = decodeSecret("MODO_HYPERFRAMES_SIGNING_KEY_B64");
    contentKey = decodeSecret("MODO_HYPERFRAMES_CONTENT_KEY_B64");
    if (timingSafeEqual(signingKey, contentKey)) {
      throw new Error("HYPERFRAMES_ONE_SHOT_KEY_REUSE_DENIED");
    }
    let signed: SignedStagingWorkOrder;
    try {
      signed = JSON.parse(orderJson) as SignedStagingWorkOrder;
    } catch {
      throw new Error("HYPERFRAMES_ONE_SHOT_INVALID_ORDER_FILE");
    }
    pool = new pg.Pool({
      ...dbConfig,
      max: 2,
      connectionTimeoutMillis: 5_000,
      idleTimeoutMillis: 1_000,
      statement_timeout: 15_000,
      query_timeout: 20_000,
    });
    const queue = new HyperframesStagingPgQueue(pool);
    snapshots = new HyperframesStagingPgSnapshots(pool, { key: contentKey });
    artifacts = new HyperframesStagingPgArtifacts(pool, { key: contentKey });
    const outcome = await runSignedStagingWorkOrder({
      signed, signingKey, localWorkerId, now: Date.now(), queue,
      snapshots, artifacts,
      tools: { hyperframesExecutable, ffprobeExecutable },
    });
    // No MP4, source text, customer metadata, auth keys or stderr in logs.
    process.stdout.write(JSON.stringify({ kind: outcome.kind, previewOnly: true }) + "\n");
    if (outcome.kind === "completed" || outcome.kind === "unclaimed") {
      process.exitCode = 0;
    } else {
      process.exitCode = 2;
    }
  } finally {
    snapshots?.close();
    artifacts?.close();
    signingKey?.fill(0);
    contentKey?.fill(0);
    if (pool) await pool.end();
  }
}

void main().catch((error: unknown) => {
  // Whitelist internal error codes only: PG/CLI exceptions can contain URLs,
  // authentication data or local paths that must never appear in worker logs.
  const code = error instanceof Error &&
    /^HYPERFRAMES_[A-Z0-9_]+$/.test(error.message)
    ? error.message : "HYPERFRAMES_ONE_SHOT_FAILURE";
  process.stderr.write(code + "\n");
  process.exitCode = 1;
});
