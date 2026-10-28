import { randomBytes, randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  signStagingWorkOrder, verifyStagingWorkOrder,
} from "./hyperframes-staging-pg-work-order.js";

const original = {
  node: process.env.NODE_ENV,
  worker: process.env.MODO_HYPERFRAMES_WORKER_MODE,
  recovery: process.env.MODO_HYPERFRAMES_RECOVERY_MODE,
  db: process.env.MODO_HYPERFRAMES_DB_MODE,
  storage: process.env.MODO_HYPERFRAMES_STORAGE_MODE,
};
const issued = 1_800_000_000_000;
const data = () => ({
  jobId: randomUUID(),
  organizationId: "synthetic-signed-tenant",
  workerId: "staging-worker-one",
  requestSha256: "a".repeat(64),
});
describe("isolated signed worker job handoffs", () => {
  let secret: Buffer;
  beforeEach(() => {
    process.env.NODE_ENV = "test";
    process.env.MODO_HYPERFRAMES_WORKER_MODE = "isolated-staging";
    process.env.MODO_HYPERFRAMES_RECOVERY_MODE = "isolated-staging";
    process.env.MODO_HYPERFRAMES_DB_MODE = "isolated-staging";
    process.env.MODO_HYPERFRAMES_STORAGE_MODE = "isolated-staging";
    secret = randomBytes(32);
  });
  afterEach(() => {
    secret.fill(0);
    for (const [name, old] of [
      ["NODE_ENV", original.node],
      ["MODO_HYPERFRAMES_WORKER_MODE", original.worker],
      ["MODO_HYPERFRAMES_RECOVERY_MODE", original.recovery],
      ["MODO_HYPERFRAMES_DB_MODE", original.db],
      ["MODO_HYPERFRAMES_STORAGE_MODE", original.storage],
    ] as const) {
      if (old === undefined) delete process.env[name];
      else process.env[name] = old;
    }
  });

  it("binds unique job, tenant, digest, worker and short expiry with a valid signature", () => {
    const task = signStagingWorkOrder(data(), secret, issued);
    const verified = verifyStagingWorkOrder(
      task, secret, "staging-worker-one", issued + 1000);
    expect(verified.jobId).toBe(task.payload.jobId);
    expect(verified.organizationId).toBe("synthetic-signed-tenant");
    expect(verified.requestSha256).toBe("a".repeat(64));
    expect(verified.expiresAt).toBe(issued + 60_000);
    expect(verified.nonce).toMatch(/^[0-9a-f-]{36}$/);
    expect(task.signature).toMatch(/^[0-9a-f]{64}$/);
    expect(signStagingWorkOrder(data(), secret, issued).payload.nonce)
      .not.toBe(task.payload.nonce);
  });

  it("rejects forgery of any signed tenant, worker, digest or job field", () => {
    const x = signStagingWorkOrder(data(), secret, issued);
    for (const changes of [
      { organizationId: "another-tenant" },
      { workerId: "staging-worker-two" },
      { jobId: randomUUID() },
      { requestSha256: "b".repeat(64) },
      { audience: "modo-production" },
      { nonce: randomUUID() },
      { expiresAt: x.payload.expiresAt + 1000 },
    ]) {
      expect(() => verifyStagingWorkOrder(
        { ...x, payload: { ...x.payload, ...changes } },
        secret, "staging-worker-one", issued + 1000,
      )).toThrow(/WORK_ORDER_INVALID/);
    }
    expect(() => verifyStagingWorkOrder(
      x, secret, "staging-worker-two", issued + 1000))
      .toThrow(/WORK_ORDER_INVALID/);
    expect(() => verifyStagingWorkOrder(
      x, randomBytes(32), "staging-worker-one", issued + 1000))
      .toThrow(/WORK_ORDER_INVALID/);
  });

  it("rejects expired or future work orders and overlong signature windows", () => {
    const x = signStagingWorkOrder(data(), secret, issued, 1000);
    expect(() => verifyStagingWorkOrder(
      x, secret, "staging-worker-one", issued + 1000))
      .toThrow(/WORK_ORDER_INVALID/);
    expect(() => verifyStagingWorkOrder(
      x, secret, "staging-worker-one", issued - 10_001))
      .toThrow(/WORK_ORDER_INVALID/);
    expect(() => signStagingWorkOrder(
      data(), secret, issued, 300_001)).toThrow(/INVALID_TIME/);
    expect(() => signStagingWorkOrder(
      data(), secret, Number.NaN)).toThrow(/INVALID_TIME/);
  });

  it("rejects extra JSON fields, malformed signatures, invalid identities and keys", () => {
    const x = signStagingWorkOrder(data(), secret, issued);
    for (const malformed of [
      { ...x, unexpected: true },
      { ...x, payload: { ...x.payload, extra: "misused" } },
      { ...x, signature: "abc" },
      { ...x, signature: "00".repeat(32) },
      null,
      { payload: x.payload },
    ]) {
      expect(() => verifyStagingWorkOrder(
        malformed, secret, "staging-worker-one", issued + 1000))
        .toThrow(/WORK_ORDER_INVALID/);
    }
    expect(() => signStagingWorkOrder(
      { ...data(), organizationId: "../../unsafe" },
      secret, issued)).toThrow(/INVALID_PAYLOAD/);
    expect(() => signStagingWorkOrder(
      data(), randomBytes(16), issued)).toThrow(/INVALID_KEY/);
  });

  it("fails closed outside fully isolated staging, especially in production", () => {
    process.env.NODE_ENV = "production";
    expect(() => signStagingWorkOrder(data(), secret, issued))
      .toThrow(/WORK_ORDER_DISABLED/);
    process.env.NODE_ENV = "test";
    delete process.env.MODO_HYPERFRAMES_DB_MODE;
    expect(() => signStagingWorkOrder(data(), secret, issued))
      .toThrow(/WORK_ORDER_DISABLED/);
  });

  it("does not mutate or zeroize the scheduler's original key", () => {
    const unchanged = Buffer.from(secret);
    const x = signStagingWorkOrder(data(), secret, issued);
    verifyStagingWorkOrder(x, secret, "staging-worker-one", issued);
    expect(secret).toEqual(unchanged);
  });
});
