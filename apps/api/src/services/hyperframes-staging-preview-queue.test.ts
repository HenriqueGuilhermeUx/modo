import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import type { VideoProject } from "@modo/contracts/video";
import { HyperframesStagingPreviewQueue } from "./hyperframes-staging-preview-queue.js";
import { randomBytes } from "node:crypto";
import { HyperframesStagingEncryptedVault } from "./hyperframes-staging-encrypted-vault.js";

const savedMode = {
  worker: process.env.MODO_HYPERFRAMES_WORKER_MODE,
  queue: process.env.MODO_HYPERFRAMES_QUEUE_MODE,
  node: process.env.NODE_ENV,
};
const tools = {
  hyperframesExecutable: "/usr/local/bin/hyperframes",
  ffprobeExecutable: "/usr/bin/ffprobe",
};
function project(id: string, organizationId = "sandbox-only") {
  return { id, organizationId, scenes: [] } as unknown as VideoProject;
}
function rendered(source: VideoProject) {
  const video = Buffer.alloc(5000, 7);
  return {
    projectId: source.id,
    organizationId: source.organizationId,
    mimeType: "video/mp4" as const,
    video,
    sha256: createHash("sha256").update(video).digest("hex"),
    bytes: video.length,
    width: 1080,
    height: 1920,
    durationSeconds: 15,
    previewOnly: true as const,
    published: false as const,
  };
}
const flush = async () => {
  await new Promise<void>((resolve) => setImmediate(resolve));
  await new Promise<void>((resolve) => setImmediate(resolve));
};
function queue(config: Partial<ConstructorParameters<typeof HyperframesStagingPreviewQueue>[0]> = {}) {
  return new HyperframesStagingPreviewQueue({
    tools,
    render: async (source) => rendered(source),
    ...config,
  });
}

describe("isolated HyperFrames private staging queue", () => {
  beforeEach(() => {
    process.env.NODE_ENV = "test";
    process.env.MODO_HYPERFRAMES_WORKER_MODE = "isolated-staging";
    process.env.MODO_HYPERFRAMES_QUEUE_MODE = "isolated-staging";
  });
  afterEach(() => {
    for (const [key, envName] of [
      ["worker", "MODO_HYPERFRAMES_WORKER_MODE"],
      ["queue", "MODO_HYPERFRAMES_QUEUE_MODE"],
      ["node", "NODE_ENV"],
    ] as const) {
      const value = savedMode[key];
      if (value === undefined) delete process.env[envName];
      else process.env[envName] = value;
    }
  });

  it("requires both staging switches and refuses production", () => {
    const x = queue();
    delete process.env.MODO_HYPERFRAMES_QUEUE_MODE;
    expect(() => x.enqueue({ project: project("one"), brandName: "Sandbox",
      authorizedOrganizationId: "sandbox-only" })).toThrow(/QUEUE_DISABLED/);
    process.env.MODO_HYPERFRAMES_QUEUE_MODE = "isolated-staging";
    process.env.NODE_ENV = "production";
    expect(() => x.enqueue({ project: project("one"), brandName: "Sandbox",
      authorizedOrganizationId: "sandbox-only" })).toThrow(/QUEUE_DISABLED/);
  });

  it("enforces tenant scope on submit, status, download and deletion", async () => {
    const x = queue();
    expect(() => x.enqueue({ project: project("one"), brandName: "Sandbox",
      authorizedOrganizationId: "another-organization" })).toThrow(/TENANT_DENIED/);
    const submitted = x.enqueue({ project: project("one"), brandName: "Sandbox",
      authorizedOrganizationId: "sandbox-only" });
    expect(submitted.status).toBe("queued");
    await flush();
    expect(x.status(submitted.jobId, "another-organization")).toBeNull();
    expect(x.readPreview(submitted.jobId, "another-organization")).toBeNull();
    expect(x.forget(submitted.jobId, "another-organization")).toBe(false);
    const done = x.status(submitted.jobId, "sandbox-only");
    expect(done?.status).toBe("succeeded");
    expect(done?.artifact?.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(done).not.toHaveProperty("video");
    const first = x.readPreview(submitted.jobId, "sandbox-only");
    expect(first?.length).toBe(5000);
    first![0] = 0;
    expect(x.readPreview(submitted.jobId, "sandbox-only")?.[0]).toBe(7);
    expect(x.forget(submitted.jobId, "sandbox-only")).toBe(true);
    expect(x.readPreview(submitted.jobId, "sandbox-only")).toBeNull();
  });

  it("runs one render at a time, clones projects and caps the queue", async () => {
    const seen: string[] = [];
    let releaseFirst: () => void = () => {};
    const firstGate = new Promise<void>((resolve) => { releaseFirst = resolve; });
    const x = queue({
      maxJobs: 2,
      render: async (source) => {
        seen.push(source.id);
        if (seen.length === 1) await firstGate;
        return rendered(source);
      },
    });
    const one = project("one");
    const a = x.enqueue({ project: one, brandName: "Sandbox",
      authorizedOrganizationId: "sandbox-only" });
    const b = x.enqueue({ project: project("two"), brandName: "Sandbox",
      authorizedOrganizationId: "sandbox-only" });
    one.id = "changed-after-enqueue";
    await flush();
    expect(seen).toEqual(["one"]);
    expect(x.status(a.jobId, "sandbox-only")?.status).toBe("running");
    expect(x.status(b.jobId, "sandbox-only")?.status).toBe("queued");
    expect(() => x.enqueue({ project: project("three"), brandName: "Sandbox",
      authorizedOrganizationId: "sandbox-only" })).toThrow(/AT_CAPACITY/);
    releaseFirst();
    await flush();
    expect(seen).toEqual(["one", "two"]);
    expect(x.status(a.jobId, "sandbox-only")?.status).toBe("succeeded");
    expect(x.status(b.jobId, "sandbox-only")?.status).toBe("succeeded");
  });

  it("fails closed for incorrect tenant metadata, checksum and renderer errors", async () => {
    const x = queue({
      render: async (source) => ({
        ...rendered(source),
        organizationId: "different-tenant",
      }),
    });
    const a = x.enqueue({ project: project("one"), brandName: "Sandbox",
      authorizedOrganizationId: "sandbox-only" });
    await flush();
    expect(x.status(a.jobId, "sandbox-only")?.status).toBe("failed");
    expect(x.status(a.jobId, "sandbox-only")?.errorCode).toBe("STAGING_RENDER_FAILED");
    expect(x.readPreview(a.jobId, "sandbox-only")).toBeNull();

    const broken = queue({
      render: async (source) => ({ ...rendered(source), sha256: "00".repeat(32) }),
    });
    const b = broken.enqueue({ project: project("two"), brandName: "Sandbox",
      authorizedOrganizationId: "sandbox-only" });
    await flush();
    expect(broken.status(b.jobId, "sandbox-only")?.status).toBe("failed");

    const throwing = queue({
      render: async () => { throw new Error("secret-service-error-with-token"); },
    });
    const c = throwing.enqueue({ project: project("three"), brandName: "Sandbox",
      authorizedOrganizationId: "sandbox-only" });
    await flush();
    expect(JSON.stringify(throwing.status(c.jobId, "sandbox-only")))
      .not.toContain("secret-service-error");
  });

  it("enforces storage byte quota and automatically expires completed results", async () => {
    let now = 1_000_000;
    const x = queue({ maxStoredBytes: 5500, completedTtlMs: 1000, now: () => now });
    const a = x.enqueue({ project: project("one"), brandName: "Sandbox",
      authorizedOrganizationId: "sandbox-only" });
    const b = x.enqueue({ project: project("two"), brandName: "Sandbox",
      authorizedOrganizationId: "sandbox-only" });
    await flush();
    expect(x.status(a.jobId, "sandbox-only")?.status).toBe("succeeded");
    expect(x.status(b.jobId, "sandbox-only")?.status).toBe("failed");
    now += 1000;
    expect(x.status(a.jobId, "sandbox-only")).toBeNull();
    expect(x.readPreview(a.jobId, "sandbox-only")).toBeNull();
    expect(x.status(b.jobId, "sandbox-only")).toBeNull();
  });
  it("uses opt-in authenticated encryption instead of retaining plaintext output", async () => {
    const previous = process.env.MODO_HYPERFRAMES_STORAGE_MODE;
    process.env.MODO_HYPERFRAMES_STORAGE_MODE = "isolated-staging";
    const encryptedVault = new HyperframesStagingEncryptedVault({
      key: randomBytes(32), retentionMs: 60_000,
    });
    try {
      const x = queue({ encryptedVault });
      const submission = x.enqueue({
        project: project("encrypted-one"),
        brandName: "Sandbox",
        authorizedOrganizationId: "sandbox-only",
      });
      await flush();
      const done = x.status(submission.jobId, "sandbox-only");
      expect(done?.status).toBe("succeeded");
      expect(done?.artifact?.sha256).toMatch(/^[a-f0-9]{64}$/);
      expect(x.status(submission.jobId, "different-organization")).toBeNull();
      const internal = x as unknown as { jobs: Map<string, {
        result: Buffer | null; encrypted: boolean;
      }> };
      const job = internal.jobs.get(submission.jobId)!;
      expect(job.result).toBeNull();
      expect(job.encrypted).toBe(true);
      expect(x.readPreview(submission.jobId, "different-organization")).toBeNull();
      expect(x.readPreview(submission.jobId, "sandbox-only")?.length).toBe(5000);
      expect(x.forget(submission.jobId, "sandbox-only")).toBe(true);
      expect(encryptedVault.read(submission.jobId, "sandbox-only")).toBeNull();
    } finally {
      encryptedVault.close();
      if (previous === undefined) delete process.env.MODO_HYPERFRAMES_STORAGE_MODE;
      else process.env.MODO_HYPERFRAMES_STORAGE_MODE = previous;
    }
  });

});
