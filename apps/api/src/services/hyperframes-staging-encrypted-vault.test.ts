import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import { HyperframesStagingEncryptedVault } from "./hyperframes-staging-encrypted-vault.js";

const previous = {
  node: process.env.NODE_ENV,
  worker: process.env.MODO_HYPERFRAMES_WORKER_MODE,
  storage: process.env.MODO_HYPERFRAMES_STORAGE_MODE,
};
const demo = (video = Buffer.alloc(5000, 9)) => ({
  jobId: "11111111-1111-4111-8111-111111111111",
  organizationId: "sandbox-only",
  authorizedOrganizationId: "sandbox-only",
  projectId: "22222222-2222-4222-8222-222222222222",
  video,
});
function vault(options: Partial<ConstructorParameters<typeof HyperframesStagingEncryptedVault>[0]> = {}) {
  return new HyperframesStagingEncryptedVault({ key: randomBytes(32), ...options });
}

describe("HyperFrames authenticated private encrypted preview vault", () => {
  beforeEach(() => {
    process.env.NODE_ENV = "test";
    process.env.MODO_HYPERFRAMES_WORKER_MODE = "isolated-staging";
    process.env.MODO_HYPERFRAMES_STORAGE_MODE = "isolated-staging";
  });
  afterEach(() => {
    for (const [name, value] of [
      ["NODE_ENV", previous.node],
      ["MODO_HYPERFRAMES_WORKER_MODE", previous.worker],
      ["MODO_HYPERFRAMES_STORAGE_MODE", previous.storage],
    ] as const) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });

  it("encrypts at rest in RAM, authenticates tenants and never publishes URLs", () => {
    const secret = randomBytes(32);
    const x = vault({ key: secret });
    const original = Buffer.alloc(5000, 9);
    const metadata = x.put(demo(original));
    secret.fill(0); // prove the original key is not retained by reference
    original[0] = 0; // prove the original plaintext cannot mutate stored bytes
    expect(metadata.encrypted).toBe(true);
    expect(metadata.published).toBe(false);
    expect(metadata.previewOnly).toBe(true);
    expect(metadata.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(metadata).not.toHaveProperty("url");
    expect(x.metadata(metadata.jobId, "other-tenant")).toBeNull();
    expect(x.read(metadata.jobId, "other-tenant")).toBeNull();
    expect(x.forget(metadata.jobId, "other-tenant")).toBe(false);
    const first = x.read(metadata.jobId, "sandbox-only");
    expect(first?.length).toBe(5000);
    expect(first?.[0]).toBe(9);
    first![0] = 1;
    expect(x.read(metadata.jobId, "sandbox-only")?.[0]).toBe(9);
    expect(x.forget(metadata.jobId, "sandbox-only")).toBe(true);
    expect(x.read(metadata.jobId, "sandbox-only")).toBeNull();
    x.close();
  });

  it("fails closed when either staging gate is off or production is enabled", () => {
    const x = vault();
    delete process.env.MODO_HYPERFRAMES_STORAGE_MODE;
    expect(() => x.put(demo())).toThrow(/VAULT_DISABLED/);
    process.env.MODO_HYPERFRAMES_STORAGE_MODE = "isolated-staging";
    process.env.NODE_ENV = "production";
    expect(() => x.put(demo())).toThrow(/VAULT_DISABLED/);
    process.env.NODE_ENV = "test";
    x.close();
    expect(() => x.put(demo())).toThrow(/VAULT_DISABLED/);
  });

  it("rejects forged tenant, invalid identifiers, duplicate job and key lengths", () => {
    expect(() => vault({ key: randomBytes(16) })).toThrow(/INVALID_KEY/);
    const x = vault();
    expect(() => x.put({ ...demo(), authorizedOrganizationId: "other-tenant" }))
      .toThrow(/TENANT_OR_ID_DENIED/);
    expect(() => x.put({ ...demo(), jobId: "../../other" }))
      .toThrow(/TENANT_OR_ID_DENIED/);
    x.put(demo());
    expect(() => x.put(demo())).toThrow(/DUPLICATE_JOB/);
    x.close();
  });

  it("rejects ciphertext and authenticated metadata tampering", () => {
    const x = vault();
    const desc = x.put(demo());
    const internal = x as unknown as {
      entries: Map<string, {
        ciphertext: Buffer;
        descriptor: { organizationId: string };
      }>;
    };
    const entry = internal.entries.get(desc.jobId)!;
    entry.ciphertext[0] ^= 0x01;
    expect(() => x.read(desc.jobId, "sandbox-only"))
      .toThrow(/ARTIFACT_INTEGRITY_FAILED/);
    entry.ciphertext[0] ^= 0x01;
    entry.descriptor.organizationId = "other-tenant";
    expect(() => x.read(desc.jobId, "other-tenant"))
      .toThrow(/ARTIFACT_INTEGRITY_FAILED/);
    x.close();
  });

  it("bounds memory and rejects oversized videos or overly long retention", () => {
    expect(() => vault({ retentionMs: 20 * 60_000 })).toThrow(/INVALID_LIMITS/);
    expect(() => vault({ maxStoredBytes: 1_000_000_000 })).toThrow(/INVALID_LIMITS/);
    const x = vault({ maxStoredBytes: 5000 });
    x.put(demo());
    expect(() => x.put({ ...demo(), jobId: "second-job" }))
      .toThrow(/VAULT_CAPACITY/);
    expect(() => x.put({
      ...demo(), jobId: "third-job", video: Buffer.alloc(3000, 9),
    })).toThrow(/INVALID_VIDEO_SIZE/);
    x.close();
  });

  it("expires artifacts based on injected monotonic staging clock and closes cleanly", () => {
    let now = 1_000_000;
    const x = vault({ now: () => now, retentionMs: 1000 });
    const meta = x.put(demo());
    expect(meta.expiresAt).toBe(now + 1000);
    now += 999;
    expect(x.read(meta.jobId, "sandbox-only")?.length).toBe(5000);
    now += 1;
    expect(x.read(meta.jobId, "sandbox-only")).toBeNull();
    expect(x.metadata(meta.jobId, "sandbox-only")).toBeNull();
    x.close();
  });
});
