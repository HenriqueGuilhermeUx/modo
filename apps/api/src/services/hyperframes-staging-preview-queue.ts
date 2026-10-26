import { createHash, randomUUID } from "node:crypto";
import type { VideoProject } from "@modo/contracts/video";
import {
  renderHyperframesStagingPreview,
  type HyperframesStagingTools,
} from "./hyperframes-staging-worker.js";

type RenderResult = Awaited<ReturnType<typeof renderHyperframesStagingPreview>>;
type Renderer = typeof renderHyperframesStagingPreview;
type JobState = "queued" | "running" | "succeeded" | "failed";

export type HyperframesStagingJobView = Readonly<{
  jobId: string;
  projectId: string;
  status: JobState;
  createdAt: number;
  finishedAt: number | null;
  previewOnly: true;
  published: false;
  errorCode: "STAGING_RENDER_FAILED" | null;
  artifact: null | Readonly<{
    mimeType: "video/mp4";
    bytes: number;
    sha256: string;
    width: number;
    height: number;
    durationSeconds: number;
  }>;
}>;

type PendingJob = {
  jobId: string;
  authorizedOrganizationId: string;
  project: VideoProject;
  brandName: string;
  status: JobState;
  createdAt: number;
  finishedAt: number | null;
  errorCode: "STAGING_RENDER_FAILED" | null;
  result: RenderResult | null;
};

/**
 * Opt-in single-process staging queue and tenant-private, ephemeral RAM store.
 *
 * There is deliberately NO route, Redis/database/object-store dependency,
 * publication hook, billing flow or production import. The organization scope
 * must come from an independently authenticated server-side scheduler.
 *
 * Not a durable queue: process restarts discard jobs and artifacts. A future
 * production design requires persistent state, server-side auth, distributed
 * leases, encrypted private object storage, quotas, and deletion policies.
 */
export class HyperframesStagingPreviewQueue {
  private readonly jobs = new Map<string, PendingJob>();
  private readonly pending: string[] = [];
  private running = false;
  private storedBytes = 0;

  constructor(private readonly config: Readonly<{
    tools: HyperframesStagingTools;
    render?: Renderer;
    now?: () => number;
    maxJobs?: number;
    maxStoredBytes?: number;
    completedTtlMs?: number;
  }>) {}

  private now() { return (this.config.now || Date.now)(); }

  private ensureIsolatedStaging() {
    if (process.env.NODE_ENV === "production" ||
        process.env.MODO_HYPERFRAMES_WORKER_MODE !== "isolated-staging" ||
        process.env.MODO_HYPERFRAMES_QUEUE_MODE !== "isolated-staging") {
      throw new Error("HYPERFRAMES_STAGING_QUEUE_DISABLED");
    }
  }

  private purgeExpired() {
    const ttl = this.config.completedTtlMs ?? 10 * 60_000;
    for (const [id, entry] of this.jobs) {
      if (entry.finishedAt !== null && this.now() - entry.finishedAt >= ttl) {
        if (entry.result) this.storedBytes -= entry.result.video.byteLength;
        this.jobs.delete(id);
      }
    }
  }

  private visible(entry: PendingJob): HyperframesStagingJobView {
    const { result } = entry;
    return {
      jobId: entry.jobId,
      projectId: entry.project.id,
      status: entry.status,
      createdAt: entry.createdAt,
      finishedAt: entry.finishedAt,
      previewOnly: true,
      published: false,
      errorCode: entry.errorCode,
      artifact: result ? {
        mimeType: "video/mp4",
        bytes: result.bytes,
        sha256: result.sha256,
        width: result.width,
        height: result.height,
        durationSeconds: result.durationSeconds,
      } : null,
    };
  }

  enqueue(input: Readonly<{
    project: VideoProject;
    brandName: string;
    authorizedOrganizationId: string;
  }>): HyperframesStagingJobView {
    this.ensureIsolatedStaging();
    this.purgeExpired();
    // This is a boundary check, not authentication. The caller must obtain
    // authorizedOrganizationId from trusted server-side identity claims.
    if (!input?.authorizedOrganizationId || !input.project ||
        input.project.organizationId !== input.authorizedOrganizationId) {
      throw new Error("HYPERFRAMES_STAGING_QUEUE_TENANT_DENIED");
    }
    if (typeof input.project.id !== "string" || !input.project.id ||
        typeof input.brandName !== "string" || !input.brandName.trim() ||
        input.brandName.length > 120) {
      throw new Error("HYPERFRAMES_STAGING_QUEUE_INVALID_INPUT");
    }
    const maxJobs = this.config.maxJobs ?? 6;
    if (this.jobs.size >= maxJobs) {
      throw new Error("HYPERFRAMES_STAGING_QUEUE_AT_CAPACITY");
    }
    let copied: VideoProject;
    try { copied = structuredClone(input.project); }
    catch { throw new Error("HYPERFRAMES_STAGING_QUEUE_INVALID_INPUT"); }
    const entry: PendingJob = {
      jobId: randomUUID(),
      authorizedOrganizationId: input.authorizedOrganizationId,
      project: copied,
      brandName: input.brandName,
      status: "queued",
      createdAt: this.now(),
      finishedAt: null,
      errorCode: null,
      result: null,
    };
    this.jobs.set(entry.jobId, entry);
    this.pending.push(entry.jobId);
    // Start on the next microtask, after the caller receives its job ID.
    void Promise.resolve().then(() => this.drain());
    return this.visible(entry);
  }

  status(jobId: string, authorizedOrganizationId: string):
    HyperframesStagingJobView | null {
    this.ensureIsolatedStaging();
    this.purgeExpired();
    const entry = this.jobs.get(jobId);
    if (!entry || !authorizedOrganizationId ||
        entry.authorizedOrganizationId !== authorizedOrganizationId) return null;
    return this.visible(entry);
  }

  /**
   * Returns a defensive copy, never a public URL or the original Buffer.
   * The read is scoped again, independently of the enqueue call.
   */
  readPreview(jobId: string, authorizedOrganizationId: string): Buffer | null {
    this.ensureIsolatedStaging();
    this.purgeExpired();
    const entry = this.jobs.get(jobId);
    if (!entry || !authorizedOrganizationId ||
        entry.authorizedOrganizationId !== authorizedOrganizationId ||
        entry.status !== "succeeded" || !entry.result) return null;
    const expected = createHash("sha256").update(entry.result.video).digest("hex");
    if (expected !== entry.result.sha256 ||
        entry.result.video.byteLength !== entry.result.bytes) {
      throw new Error("HYPERFRAMES_STAGING_ARTIFACT_INTEGRITY_FAILED");
    }
    return Buffer.from(entry.result.video);
  }

  /** Tenant-scoped manual deletion; cannot remove a job while rendering. */
  forget(jobId: string, authorizedOrganizationId: string): boolean {
    this.ensureIsolatedStaging();
    const entry = this.jobs.get(jobId);
    if (!entry || !authorizedOrganizationId ||
        entry.authorizedOrganizationId !== authorizedOrganizationId ||
        entry.status === "queued" || entry.status === "running") return false;
    if (entry.result) this.storedBytes -= entry.result.video.byteLength;
    return this.jobs.delete(jobId);
  }

  private async drain(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      while (this.pending.length) {
        const id = this.pending.shift()!;
        const entry = this.jobs.get(id);
        if (!entry) continue;
        entry.status = "running";
        try {
          this.ensureIsolatedStaging();
          const render = this.config.render || renderHyperframesStagingPreview;
          const result = await render(entry.project, entry.brandName,
            this.config.tools, entry.authorizedOrganizationId);
          if (result.organizationId !== entry.authorizedOrganizationId ||
              result.projectId !== entry.project.id ||
              result.published !== false || result.previewOnly !== true ||
              result.mimeType !== "video/mp4" || !Buffer.isBuffer(result.video) ||
              result.bytes !== result.video.byteLength ||
              result.bytes < 4000 || result.bytes > 25_000_000 ||
              createHash("sha256").update(result.video).digest("hex") !== result.sha256) {
            throw new Error("HYPERFRAMES_STAGING_INVALID_RENDER_RESULT");
          }
          const limit = this.config.maxStoredBytes ?? 50_000_000;
          if (this.storedBytes + result.bytes > limit) {
            throw new Error("HYPERFRAMES_STAGING_STORAGE_CAPACITY");
          }
          // Never retain or expose the renderer's original mutable bytes.
          entry.result = { ...result, video: Buffer.from(result.video) };
          this.storedBytes += result.bytes;
          entry.status = "succeeded";
        } catch {
          // Do not leak sensitive renderer stderr or upstream error messages.
          entry.result = null;
          entry.errorCode = "STAGING_RENDER_FAILED";
          entry.status = "failed";
        } finally {
          entry.finishedAt = this.now();
        }
      }
    } finally {
      this.running = false;
    }
  }
}
