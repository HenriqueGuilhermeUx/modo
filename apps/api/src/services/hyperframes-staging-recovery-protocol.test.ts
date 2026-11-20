import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  assertRecoveryIdempotentReuse,
  claimRecoveryLease,
  createRecoveryJob,
  failRecoveryLease,
  finishRecoveryLease,
  heartbeatRecoveryLease,
  type RecoveryJob,
} from "./hyperframes-staging-recovery-protocol.js";

const originalMode = process.env.MODO_HYPERFRAMES_RECOVERY_MODE;
const originalNode = process.env.NODE_ENV;
const hash = "a".repeat(64);
const result = {
  storageKey: "33333333-3333-4333-8333-333333333333",
  sha256: "b".repeat(64),
  bytes: 5000,
};
const input = {
  organizationId: "sandbox-only",
  projectId: "11111111-1111-4111-8111-111111111111",
  idempotencyKey: "idempotency-demo-0001",
  requestSha256: hash,
};
const make = () => createRecoveryJob(input, "sandbox-only", 10_000);
const claim = (job: RecoveryJob, now = 11_000, worker = "renderer-A") =>
  claimRecoveryLease(job, "sandbox-only", worker, now, 10_000);
const simulatedCAS = (original: RecoveryJob, next: RecoveryJob, current: RecoveryJob) => {
  if (original.version !== current.version) return null;
  if (original.jobId !== current.jobId ||
      original.organizationId !== current.organizationId) return null;
  return next;
};

describe("staging-only durable-recovery transition protocol", () => {
  beforeEach(() => {
    process.env.NODE_ENV = "test";
    process.env.MODO_HYPERFRAMES_RECOVERY_MODE = "isolated-staging";
  });
  afterEach(() => {
    if (originalNode === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalNode;
    if (originalMode === undefined) delete process.env.MODO_HYPERFRAMES_RECOVERY_MODE;
    else process.env.MODO_HYPERFRAMES_RECOVERY_MODE = originalMode;
  });

  it("requires staging and never permits production", () => {
    delete process.env.MODO_HYPERFRAMES_RECOVERY_MODE;
    expect(make).toThrow(/RECOVERY_DISABLED/);
    process.env.MODO_HYPERFRAMES_RECOVERY_MODE = "isolated-staging";
    process.env.NODE_ENV = "production";
    expect(make).toThrow(/RECOVERY_DISABLED/);
  });

  it("creates a metadata-only job scoped to a known tenant and request digest", () => {
    const j = make();
    expect(j.jobId).toMatch(/^[0-9a-f-]{36}$/);
    expect(j.status).toBe("queued");
    expect(j.previewOnly).toBe(true);
    expect(j.published).toBe(false);
    expect(j.attempts).toBe(0);
    expect(j.version).toBe(0);
    expect(j.lease).toBeNull();
    expect(j).not.toHaveProperty("video");
    expect(j).not.toHaveProperty("html");
    expect(() => createRecoveryJob(input, "cross-tenant", 10_000))
      .toThrow(/TENANT_DENIED/);
    expect(() => createRecoveryJob(
      { ...input, requestSha256: "bad" }, "sandbox-only", 10_000,
    )).toThrow(/INVALID_INTENT/);
  });

  it("requires tenant-key plus immutable payload equality for idempotent reuse", () => {
    const job = make();
    expect(assertRecoveryIdempotentReuse(job, input, "sandbox-only")).toBe(job);
    for (const inputChange of [
      { idempotencyKey: "idempotency-demo-0002" },
      { projectId: "22222222-2222-4222-8222-222222222222" },
      { requestSha256: "c".repeat(64) },
      { organizationId: "other-tenant" },
    ]) {
      expect(() => assertRecoveryIdempotentReuse(
        job, { ...input, ...inputChange }, "sandbox-only",
      )).toThrow(/IDEMPOTENCY_CONFLICT/);
    }
    expect(() => assertRecoveryIdempotentReuse(job, input, "other-tenant"))
      .toThrow(/TENANT_DENIED/);
  });

  it("leases only one worker until expiration and rejects old fencing tokens", () => {
    const initial = make();
    const first = claim(initial)!;
    expect(first.status).toBe("running");
    expect(first.attempts).toBe(1);
    expect(first.version).toBe(initial.version + 1);
    expect(claim(first, 12_000, "renderer-B")).toBeNull();

    // The database adapter must atomically apply a compare-and-swap.
    const concurrent = claim(initial, 11_100, "renderer-B")!;
    expect(simulatedCAS(initial, first, initial)).toEqual(first);
    expect(simulatedCAS(initial, concurrent, first)).toBeNull();

    const second = claim(first, 21_000, "renderer-B")!;
    expect(second.attempts).toBe(2);
    expect(second.lease?.fence).not.toBe(first.lease?.fence);
    expect(heartbeatRecoveryLease(
      second, "sandbox-only", "renderer-A", first.lease!.fence, 21_001, 10_000,
    )).toBeNull();
    expect(finishRecoveryLease(
      second, "sandbox-only", "renderer-A", first.lease!.fence, 21_001, result,
    )).toBeNull();
    expect(failRecoveryLease(
      second, "sandbox-only", "renderer-A", first.lease!.fence, 21_001,
    )).toBeNull();

    const renewed = heartbeatRecoveryLease(
      second, "sandbox-only", "renderer-B", second.lease!.fence, 21_500, 10_000,
    )!;
    expect(renewed.version).toBe(second.version + 1);
    expect(renewed.lease?.expiresAt).toBe(31_500);
    expect(renewed.lease?.fence).toBe(second.lease?.fence);
    expect(heartbeatRecoveryLease(
      renewed, "sandbox-only", "renderer-B", renewed.lease!.fence, 31_500, 10_000,
    )).toBeNull();
  });

  it("accepts a single fenced completion with sanitized private artifact metadata", () => {
    const leased = claim(make())!;
    expect(() => finishRecoveryLease(
      leased, "sandbox-only", "renderer-A", leased.lease!.fence, 12_000,
      { ...result, storageKey: "../escaped" },
    )).toThrow(/INVALID_ARTIFACT/);
    expect(() => finishRecoveryLease(
      leased, "sandbox-only", "renderer-A", leased.lease!.fence, 12_000,
      { ...result, sha256: "invalid" },
    )).toThrow(/INVALID_ARTIFACT/);
    const done = finishRecoveryLease(
      leased, "sandbox-only", "renderer-A", leased.lease!.fence, 12_000, result,
    )!;
    expect(done.status).toBe("succeeded");
    expect(done.lease).toBeNull();
    expect(done.artifact).toEqual(result);
    expect(done.previewOnly).toBe(true);
    expect(done.published).toBe(false);
    expect(claim(done, 13_000)).toBeNull();
    expect(finishRecoveryLease(
      done, "sandbox-only", "renderer-A", leased.lease!.fence, 13_000, result,
    )).toBeNull();
    expect(failRecoveryLease(
      done, "sandbox-only", "renderer-A", leased.lease!.fence, 13_000,
    )).toBeNull();
  });

  it("bounds retries at three and strips renderer errors from public state", () => {
    let j = make();
    for (let attempt = 1; attempt <= 3; attempt++) {
      const leased = claim(j, 10_000 + attempt * 1_000)!;
      expect(leased.attempts).toBe(attempt);
      j = failRecoveryLease(
        leased, "sandbox-only", "renderer-A",
        leased.lease!.fence, 10_000 + attempt * 1_000 + 10,
      )!;
      expect(j.status).toBe(attempt === 3 ? "failed" : "queued");
      expect(j.failureCode).toBe(attempt === 3 ?
        "RETRY_LIMIT_REACHED" : "RENDER_FAILED");
      expect(j.lease).toBeNull();
    }
    expect(claim(j, 20_000)).toBeNull();
    expect(JSON.stringify(j)).not.toContain("stderr");
  });

  it("does not accept cross-tenant lease calls, invalid worker names or timestamps", () => {
    const j = make();
    expect(() => claimRecoveryLease(j, "other-tenant", "renderer", 11_000, 10_000))
      .toThrow(/TENANT_DENIED/);
    expect(() => claimRecoveryLease(j, "sandbox-only", "../../bad", 11_000, 10_000))
      .toThrow(/INVALID_LEASE/);
    expect(() => claimRecoveryLease(j, "sandbox-only", "renderer", Number.NaN, 10_000))
      .toThrow(/INVALID_TIME/);
    expect(() => claimRecoveryLease(j, "sandbox-only", "renderer", 11_000, 61_000))
      .toThrow(/INVALID_LEASE/);
  });

  it("expires the third active lease into a fail-closed terminal state", () => {
    const first = claim(make(), 11_000)!;
    const second = claim(first, 21_000, "renderer-B")!;
    const third = claim(second, 31_000, "renderer-C")!;
    expect(third.attempts).toBe(3);
    const terminal = claim(third, 41_000, "renderer-D")!;
    expect(terminal.status).toBe("failed");
    expect(terminal.failureCode).toBe("RETRY_LIMIT_REACHED");
    expect(terminal.attempts).toBe(3);
    expect(terminal.lease).toBeNull();
    expect(claim(terminal, 51_000, "renderer-E")).toBeNull();
  });
});
