import { randomUUID } from "node:crypto";

const SHA256 = /^[0-9a-f]{64}$/;
const IDENTIFIER = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/;
const IDEMPOTENCY_KEY = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{7,127}$/;
const MAX_ATTEMPTS = 3;
const MAX_LEASE_MS = 60_000;

type JobStatus = "queued" | "running" | "succeeded" | "failed";

export type RecoveryLease = Readonly<{
  workerId: string;
  fence: string;
  expiresAt: number;
}>;

export type RecoveryJob = Readonly<{
  jobId: string;
  organizationId: string;
  projectId: string;
  idempotencyKey: string;
  requestSha256: string;
  status: JobStatus;
  attempts: number;
  version: number;
  createdAt: number;
  updatedAt: number;
  lease: RecoveryLease | null;
  // Never an external URL, source media, plaintext MP4 or publisher task.
  artifact: null | Readonly<{ storageKey: string; sha256: string; bytes: number }>;
  failureCode: null | "RENDER_FAILED" | "RETRY_LIMIT_REACHED";
  previewOnly: true;
  published: false;
}>;

export type RecoveryIntent = Readonly<{
  organizationId: string;
  projectId: string;
  idempotencyKey: string;
  requestSha256: string;
}>;

function staging(): void {
  if (process.env.NODE_ENV === "production" ||
      process.env.MODO_HYPERFRAMES_RECOVERY_MODE !== "isolated-staging") {
    throw new Error("HYPERFRAMES_RECOVERY_DISABLED");
  }
}

function timestamp(now: number): void {
  if (!Number.isSafeInteger(now) || now < 0) {
    throw new Error("HYPERFRAMES_RECOVERY_INVALID_TIME");
  }
}

function tenant(record: RecoveryJob, authorizedOrganizationId: string): void {
  if (!record || !authorizedOrganizationId ||
      record.organizationId !== authorizedOrganizationId) {
    throw new Error("HYPERFRAMES_RECOVERY_TENANT_DENIED");
  }
}

function intentValid(input: RecoveryIntent): void {
  if (!input || !IDENTIFIER.test(input.organizationId) ||
      !IDENTIFIER.test(input.projectId) ||
      !IDEMPOTENCY_KEY.test(input.idempotencyKey) ||
      !SHA256.test(input.requestSha256)) {
    throw new Error("HYPERFRAMES_RECOVERY_INVALID_INTENT");
  }
}

/**
 * Database-neutral reference protocol for a future durable staging queue.
 *
 * PURE transition functions are NOT themselves a durable queue. The eventual
 * database adapter MUST atomically apply each returned transition with
 * WHERE organization_id = ... AND job_id = ... AND version = previous.version,
 * verify that exactly one row changed, and use its own trusted clock. All
 * idempotency checks must use a UNIQUE (organization_id, idempotency_key)
 * constraint. Fencing must also protect the final object-storage promotion.
 */
export function createRecoveryJob(
  intent: RecoveryIntent,
  authorizedOrganizationId: string,
  now: number,
): RecoveryJob {
  staging();
  intentValid(intent);
  if (intent.organizationId !== authorizedOrganizationId) {
    throw new Error("HYPERFRAMES_RECOVERY_TENANT_DENIED");
  }
  timestamp(now);
  return {
    jobId: randomUUID(),
    ...intent,
    status: "queued",
    attempts: 0,
    version: 0,
    createdAt: now,
    updatedAt: now,
    lease: null,
    artifact: null,
    failureCode: null,
    previewOnly: true,
    published: false,
  };
}

/**
 * A server-side idempotent create adapter can return an existing row ONLY
 * when the authorized tenant, immutable request and project still match.
 * This is an equality gate, not a replacement for the DB UNIQUE constraint.
 */
export function assertRecoveryIdempotentReuse(
  existing: RecoveryJob,
  intent: RecoveryIntent,
  authorizedOrganizationId: string,
): RecoveryJob {
  staging();
  tenant(existing, authorizedOrganizationId);
  intentValid(intent);
  if (existing.organizationId !== intent.organizationId ||
      existing.projectId !== intent.projectId ||
      existing.idempotencyKey !== intent.idempotencyKey ||
      existing.requestSha256 !== intent.requestSha256) {
    throw new Error("HYPERFRAMES_RECOVERY_IDEMPOTENCY_CONFLICT");
  }
  return existing;
}

/**
 * Returns null for active leases and terminal jobs. After an expired lease,
 * a new lease has a fresh random fence. A stale worker cannot heartbeat,
 * finish or release it. After three attempts a job fails closed.
 *
 * The caller must perform an atomic compare-and-swap against record.version
 * before handing the lease to a renderer.
 */
export function claimRecoveryLease(
  record: RecoveryJob,
  authorizedOrganizationId: string,
  workerId: string,
  now: number,
  durationMs: number,
): RecoveryJob | null {
  staging();
  tenant(record, authorizedOrganizationId);
  timestamp(now);
  if (!IDENTIFIER.test(workerId) ||
      !Number.isSafeInteger(durationMs) ||
      durationMs < 1000 || durationMs > MAX_LEASE_MS) {
    throw new Error("HYPERFRAMES_RECOVERY_INVALID_LEASE");
  }
  if (record.status === "succeeded" || record.status === "failed") return null;
  if (record.status === "running" &&
      record.lease && now < record.lease.expiresAt) return null;
  if (record.attempts >= MAX_ATTEMPTS) {
    return {
      ...record,
      status: "failed",
      lease: null,
      failureCode: "RETRY_LIMIT_REACHED",
      version: record.version + 1,
      updatedAt: now,
    };
  }
  return {
    ...record,
    status: "running",
    attempts: record.attempts + 1,
    lease: { workerId, fence: randomUUID(), expiresAt: now + durationMs },
    version: record.version + 1,
    updatedAt: now,
    failureCode: null,
  };
}

function ownsActiveLease(
  record: RecoveryJob,
  authorizedOrganizationId: string,
  workerId: string,
  fence: string,
  now: number,
): boolean {
  tenant(record, authorizedOrganizationId);
  timestamp(now);
  return record.status === "running" &&
    record.lease?.workerId === workerId &&
    record.lease?.fence === fence &&
    now < record.lease.expiresAt;
}

export function heartbeatRecoveryLease(
  record: RecoveryJob,
  authorizedOrganizationId: string,
  workerId: string,
  fence: string,
  now: number,
  durationMs: number,
): RecoveryJob | null {
  staging();
  if (!Number.isSafeInteger(durationMs) ||
      durationMs < 1000 || durationMs > MAX_LEASE_MS) {
    throw new Error("HYPERFRAMES_RECOVERY_INVALID_LEASE");
  }
  if (!ownsActiveLease(record, authorizedOrganizationId, workerId, fence, now)) {
    return null;
  }
  return {
    ...record,
    lease: { ...record.lease!, expiresAt: now + durationMs },
    version: record.version + 1,
    updatedAt: now,
  };
}

export function finishRecoveryLease(
  record: RecoveryJob,
  authorizedOrganizationId: string,
  workerId: string,
  fence: string,
  now: number,
  result: Readonly<{ storageKey: string; sha256: string; bytes: number }>,
): RecoveryJob | null {
  staging();
  if (!ownsActiveLease(record, authorizedOrganizationId, workerId, fence, now)) {
    return null;
  }
  if (!result || !IDENTIFIER.test(result.storageKey) ||
      !SHA256.test(result.sha256) ||
      !Number.isSafeInteger(result.bytes) ||
      result.bytes < 4000 || result.bytes > 25_000_000) {
    throw new Error("HYPERFRAMES_RECOVERY_INVALID_ARTIFACT");
  }
  return {
    ...record,
    status: "succeeded",
    lease: null,
    artifact: { ...result },
    failureCode: null,
    version: record.version + 1,
    updatedAt: now,
  };
}

export function failRecoveryLease(
  record: RecoveryJob,
  authorizedOrganizationId: string,
  workerId: string,
  fence: string,
  now: number,
): RecoveryJob | null {
  staging();
  if (!ownsActiveLease(record, authorizedOrganizationId, workerId, fence, now)) {
    return null;
  }
  return {
    ...record,
    status: record.attempts >= MAX_ATTEMPTS ? "failed" : "queued",
    lease: null,
    artifact: null,
    failureCode: record.attempts >= MAX_ATTEMPTS ?
      "RETRY_LIMIT_REACHED" : "RENDER_FAILED",
    version: record.version + 1,
    updatedAt: now,
  };
}
