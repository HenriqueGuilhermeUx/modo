import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import type { HyperframesStagingTools } from "./hyperframes-staging-worker.js";
import { HyperframesStagingPgQueue } from "./hyperframes-staging-pg-queue.js";
import { HyperframesStagingPgSnapshots } from "./hyperframes-staging-pg-snapshots.js";
import { HyperframesStagingPgArtifacts } from "./hyperframes-staging-pg-artifacts.js";
import { resumeStagingHyperframesPgJob } from "./hyperframes-staging-pg-recovery.js";
import type { StagingRunOutcome } from "./hyperframes-staging-pg-render-runner.js";
import { renderHyperframesStagingPreview } from "./hyperframes-staging-worker.js";

const AUDIENCE = "modo-hyperframes-isolated-staging-v1";
const ISSUER = "modo-hyperframes-staging-scheduler";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const DIGEST = /^[0-9a-f]{64}$/;
const MAX_TTL = 5 * 60_000;
const FUTURE_SKEW = 10_000;
const KEYS = [
  "version", "audience", "issuer", "jobId", "organizationId",
  "workerId", "requestSha256", "nonce", "issuedAt", "expiresAt",
] as const;

export type StagingWorkOrder = Readonly<{
  version: 1;
  audience: typeof AUDIENCE;
  issuer: typeof ISSUER;
  jobId: string;
  organizationId: string;
  workerId: string;
  requestSha256: string;
  nonce: string;
  issuedAt: number;
  expiresAt: number;
}>;

export type SignedStagingWorkOrder = Readonly<{
  payload: StagingWorkOrder;
  signature: string;
}>;

function requireStaging() {
  if (process.env.NODE_ENV === "production" ||
      process.env.MODO_HYPERFRAMES_WORKER_MODE !== "isolated-staging" ||
      process.env.MODO_HYPERFRAMES_RECOVERY_MODE !== "isolated-staging" ||
      process.env.MODO_HYPERFRAMES_DB_MODE !== "isolated-staging" ||
      process.env.MODO_HYPERFRAMES_STORAGE_MODE !== "isolated-staging") {
    throw new Error("HYPERFRAMES_STAGING_WORK_ORDER_DISABLED");
  }
}

function checkKey(value: Uint8Array): Buffer {
  if (!(value instanceof Uint8Array) || value.byteLength < 32 || value.byteLength > 64) {
    throw new Error("HYPERFRAMES_STAGING_WORK_ORDER_INVALID_KEY");
  }
  return Buffer.from(value);
}

function validPayload(value: unknown): value is StagingWorkOrder {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const keys = Object.keys(value);
  if (keys.length !== KEYS.length || !KEYS.every(k => keys.includes(k))) return false;
  const x = value as Partial<StagingWorkOrder>;
  return x.version === 1 && x.audience === AUDIENCE && x.issuer === ISSUER &&
    typeof x.jobId === "string" && UUID.test(x.jobId) &&
    typeof x.organizationId === "string" && ID.test(x.organizationId) &&
    typeof x.workerId === "string" && ID.test(x.workerId) &&
    typeof x.requestSha256 === "string" && DIGEST.test(x.requestSha256) &&
    typeof x.nonce === "string" && UUID.test(x.nonce) &&
    typeof x.issuedAt === "number" && Number.isSafeInteger(x.issuedAt) &&
    typeof x.expiresAt === "number" && Number.isSafeInteger(x.expiresAt) &&
    (x.issuedAt as number) > 0 &&
    (x.expiresAt as number) > (x.issuedAt as number) &&
    (x.expiresAt as number) - (x.issuedAt as number) <= MAX_TTL;
}

function serialize(payload: StagingWorkOrder): string {
  return JSON.stringify(KEYS.map(key => payload[key]));
}
function signedHash(payload: StagingWorkOrder, key: Buffer): Buffer {
  return createHmac("sha256", key)
    .update("hyperframes-staging-work-order-v1\n")
    .update(serialize(payload))
    .digest();
}

/**
 * This function is strictly for a trusted staging scheduler that has ALREADY
 * authenticated the tenant, authorized the job and obtained a separate HMAC
 * signing key. Never call it with browser-controlled tenant/worker identity.
 *
 * HMAC is defense in depth for a one-job handoff. The staging PostgreSQL
 * lease/fence and service-scoped database account remain indispensable.
 * Do NOT reuse the AES content encryption key for signing.
 */
export function signStagingWorkOrder(input: Readonly<{
  jobId: string;
  organizationId: string;
  workerId: string;
  requestSha256: string;
}>, key: Uint8Array, now: number, ttlMs = 60_000): SignedStagingWorkOrder {
  requireStaging();
  const secret = checkKey(key);
  try {
    if (!Number.isSafeInteger(now) || now <= 0 ||
        !Number.isSafeInteger(ttlMs) || ttlMs < 1000 || ttlMs > MAX_TTL) {
      throw new Error("HYPERFRAMES_STAGING_WORK_ORDER_INVALID_TIME");
    }
    const payload = {
      version: 1, audience: AUDIENCE, issuer: ISSUER,
      jobId: input?.jobId, organizationId: input?.organizationId,
      workerId: input?.workerId, requestSha256: input?.requestSha256,
      nonce: randomUUID(), issuedAt: now, expiresAt: now + ttlMs,
    } as StagingWorkOrder;
    if (!validPayload(payload)) {
      throw new Error("HYPERFRAMES_STAGING_WORK_ORDER_INVALID_PAYLOAD");
    }
    return {
      payload,
      signature: signedHash(payload, secret).toString("hex"),
    };
  } finally {
    secret.fill(0);
  }
}

/**
 * Strict signature and deadline validation; reject unknown fields and
 * mismatched identities. The worker MUST also ensure the work order's
 * workerId equals its local independently configured service identity.
 */
export function verifyStagingWorkOrder(
  signed: unknown,
  key: Uint8Array,
  expectedWorkerId: string,
  now: number,
): StagingWorkOrder {
  requireStaging();
  const secret = checkKey(key);
  try {
    if (!Number.isSafeInteger(now) || now <= 0 ||
        !signed || typeof signed !== "object" || Array.isArray(signed)) {
      throw new Error("HYPERFRAMES_STAGING_WORK_ORDER_INVALID");
    }
    const envelope = signed as Partial<SignedStagingWorkOrder>;
    if (Object.keys(envelope).length !== 2 ||
        !Object.keys(envelope).every(k => k === "payload" || k === "signature") ||
        !validPayload(envelope.payload) ||
        typeof envelope.signature !== "string" ||
        !/^[0-9a-f]{64}$/.test(envelope.signature) ||
        envelope.payload.workerId !== expectedWorkerId ||
        envelope.payload.issuedAt > now + FUTURE_SKEW ||
        envelope.payload.expiresAt <= now) {
      throw new Error("HYPERFRAMES_STAGING_WORK_ORDER_INVALID");
    }
    const supplied = Buffer.from(envelope.signature, "hex");
    const calculated = signedHash(envelope.payload, secret);
    try {
      if (!timingSafeEqual(supplied, calculated)) {
        throw new Error("HYPERFRAMES_STAGING_WORK_ORDER_INVALID");
      }
    } finally {
      supplied.fill(0);
      calculated.fill(0);
    }
    return { ...envelope.payload };
  } finally {
    secret.fill(0);
  }
}

/**
 * Authenticated single-job dispatch, without a public listener/poller.
 * The DB row's immutable digest is checked again before decrypting the
 * source and claiming the lease. Nothing is published or served by URL.
 */
export async function runSignedStagingWorkOrder(input: Readonly<{
  signed: SignedStagingWorkOrder;
  signingKey: Uint8Array;
  localWorkerId: string;
  now: number;
  queue: HyperframesStagingPgQueue;
  snapshots: HyperframesStagingPgSnapshots;
  artifacts: HyperframesStagingPgArtifacts;
  tools: HyperframesStagingTools;
  render?: typeof renderHyperframesStagingPreview;
}>): Promise<StagingRunOutcome> {
  const payload = verifyStagingWorkOrder(
    input.signed, input.signingKey, input.localWorkerId, input.now);
  const row = await input.queue.get(payload.jobId, payload.organizationId);
  if (!row || row.requestSha256 !== payload.requestSha256 ||
      row.organizationId !== payload.organizationId) {
    throw new Error("HYPERFRAMES_STAGING_WORK_ORDER_JOB_MISMATCH");
  }
  return resumeStagingHyperframesPgJob({
    jobId: payload.jobId, authorizedOrganizationId: payload.organizationId,
    workerId: payload.workerId, queue: input.queue, snapshots: input.snapshots,
    artifacts: input.artifacts, tools: input.tools, render: input.render,
  });
}
