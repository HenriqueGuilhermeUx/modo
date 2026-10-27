import { createHash } from "node:crypto";
import type { VideoProject } from "@modo/contracts/video";
import {
  renderHyperframesStagingPreview,
  type HyperframesStagingTools,
} from "./hyperframes-staging-worker.js";
import { HyperframesStagingPgQueue } from "./hyperframes-staging-pg-queue.js";
import { HyperframesStagingPgArtifacts } from "./hyperframes-staging-pg-artifacts.js";
import type { RecoveryJob } from "./hyperframes-staging-recovery-protocol.js";

type Render = typeof renderHyperframesStagingPreview;
type Output = Awaited<ReturnType<Render>>;

function enabled() {
  if (process.env.NODE_ENV === "production" ||
      process.env.MODO_HYPERFRAMES_WORKER_MODE !== "isolated-staging" ||
      process.env.MODO_HYPERFRAMES_RECOVERY_MODE !== "isolated-staging" ||
      process.env.MODO_HYPERFRAMES_DB_MODE !== "isolated-staging" ||
      process.env.MODO_HYPERFRAMES_STORAGE_MODE !== "isolated-staging") {
    throw new Error("HYPERFRAMES_STAGING_PG_RUNNER_DISABLED");
  }
}

/**
 * Canonical intent for explicit staging enqueue and dispatch. The source
 * VideoProject is never persisted in the staging database. On recovery,
 * a separate authenticated scheduler must reload the exact immutable input
 * and verify this digest before a worker can claim the task again.
 */
export function stagingRenderRequestSha256(
  project: VideoProject,
  brandName: string,
): string {
  if (!project || typeof project.id !== "string" || !project.id ||
      typeof project.organizationId !== "string" || !project.organizationId ||
      typeof brandName !== "string" || !brandName.trim() ||
      brandName.length > 120) {
    throw new Error("HYPERFRAMES_STAGING_PG_RUNNER_INVALID_REQUEST");
  }
  let serialized: string;
  try {
    serialized = JSON.stringify([
      "modo-hyperframes-render-request-v1",
      project.organizationId,
      project.id,
      brandName,
      project,
    ]);
  } catch {
    throw new Error("HYPERFRAMES_STAGING_PG_RUNNER_INVALID_REQUEST");
  }
  if (typeof serialized !== "string" || serialized.length > 150_000) {
    throw new Error("HYPERFRAMES_STAGING_PG_RUNNER_INVALID_REQUEST");
  }
  return createHash("sha256").update(serialized).digest("hex");
}

export type StagingRunOutcome =
  | Readonly<{ kind: "unclaimed"; job: null }>
  | Readonly<{ kind: "completed"; job: RecoveryJob }>
  | Readonly<{ kind: "failed"; job: RecoveryJob | null }>
  | Readonly<{ kind: "lost-lease"; job: null }>;

function validatedResult(
  result: Output, project: VideoProject, organizationId: string,
): boolean {
  return !!result &&
    result.projectId === project.id &&
    result.organizationId === organizationId &&
    result.previewOnly === true &&
    result.published === false &&
    result.mimeType === "video/mp4" &&
    Buffer.isBuffer(result.video) &&
    result.video.byteLength >= 4000 &&
    result.video.byteLength <= 25_000_000 &&
    result.video.subarray(4, 8).toString("ascii") === "ftyp" &&
    result.bytes === result.video.byteLength &&
    /^[a-f0-9]{64}$/.test(result.sha256) &&
    createHash("sha256").update(result.video).digest("hex") === result.sha256 &&
    result.width === 1080 && result.height === 1920 &&
    Number.isFinite(result.durationSeconds) &&
    result.durationSeconds >= 1 && result.durationSeconds <= 60;
}

/**
 * One explicitly addressed job, not a polling daemon or an exposed route.
 *
 * Authentication MUST already be performed in the trusted staging scheduler,
 * which supplies authorizedOrganizationId, workerId, and the exact project.
 * The run refuses a content digest mismatch BEFORE claiming the lease.
 *
 * The underlying CLI may keep computing after a lease is lost. This runner
 * guarantees no stale worker can publish encrypted bytes to PostgreSQL, not
 * that subprocess CPU is instantly cancelled. The CLI itself must be run in
 * a resource-limited, network-restricted staging sandbox.
 */
export async function processStagingHyperframesPgJob(input: Readonly<{
  jobId: string;
  project: VideoProject;
  brandName: string;
  authorizedOrganizationId: string;
  workerId: string;
  queue: HyperframesStagingPgQueue;
  artifacts: HyperframesStagingPgArtifacts;
  tools: HyperframesStagingTools;
  render?: Render;
  leaseMs?: number;
  heartbeatMs?: number;
}>): Promise<StagingRunOutcome> {
  enabled();
  if (!input || !input.authorizedOrganizationId ||
      !input.project || input.project.organizationId !== input.authorizedOrganizationId ||
      !input.jobId || !input.workerId ||
      !input.queue || !input.artifacts || !input.tools) {
    throw new Error("HYPERFRAMES_STAGING_PG_RUNNER_TENANT_DENIED");
  }
  const digest = stagingRenderRequestSha256(input.project, input.brandName);
  const job = await input.queue.get(input.jobId, input.authorizedOrganizationId);
  if (!job) return { kind: "unclaimed", job: null };
  if (job.organizationId !== input.authorizedOrganizationId ||
      job.projectId !== input.project.id ||
      job.requestSha256 !== digest) {
    throw new Error("HYPERFRAMES_STAGING_PG_RUNNER_REQUEST_MISMATCH");
  }

  const leaseMs = input.leaseMs ?? 60_000;
  const heartbeatMs = input.heartbeatMs ?? 15_000;
  if (!Number.isSafeInteger(leaseMs) || leaseMs < 1000 || leaseMs > 60_000 ||
      !Number.isSafeInteger(heartbeatMs) || heartbeatMs < 25 ||
      heartbeatMs >= leaseMs / 2) {
    throw new Error("HYPERFRAMES_STAGING_PG_RUNNER_INVALID_LEASE_CONFIG");
  }

  const claim = await input.queue.claim(
    input.jobId, input.authorizedOrganizationId, input.workerId, leaseMs);
  if (!claim?.lease) return { kind: "unclaimed", job: null };
  const fence = claim.lease.fence;

  let leaseLost = false;
  let heartbeatInFlight: Promise<void> | null = null;
  const renewal = () => {
    if (heartbeatInFlight || leaseLost) return;
    heartbeatInFlight = (async () => {
      try {
        const renewed = await input.queue.heartbeat(
          input.jobId, input.authorizedOrganizationId,
          input.workerId, fence, leaseMs);
        if (!renewed) leaseLost = true;
      } catch {
        // Fail closed on a DB/network error. Never commit after uncertain lease.
        leaseLost = true;
      }
    })().finally(() => { heartbeatInFlight = null; });
  };
  // The claimed lease is persisted before any subprocess is started.
  const timer = setInterval(renewal, heartbeatMs);
  timer.unref();

  let rendered: Output | null = null;
  let renderFailed = false;
  try {
    try {
      const renderer = input.render ?? renderHyperframesStagingPreview;
      rendered = await renderer(
        input.project, input.brandName, input.tools,
        input.authorizedOrganizationId);
      if (!validatedResult(rendered, input.project, input.authorizedOrganizationId)) {
        throw new Error("HYPERFRAMES_STAGING_PG_RUNNER_INVALID_VIDEO");
      }
    } catch {
      // Never expose stderr, source HTML, tokens or subprocess exceptions.
      renderFailed = true;
    }
  } finally {
    clearInterval(timer);
    // Allow a running renewal to finish before attempting a fenced write.
    if (heartbeatInFlight) await heartbeatInFlight;
  }

  if (leaseLost) {
    rendered?.video.fill(0);
    return { kind: "lost-lease", job: null };
  }

  if (renderFailed || !rendered) {
    const failed = await input.queue.fail(
      input.jobId, input.authorizedOrganizationId, input.workerId, fence);
    rendered?.video.fill(0);
    return failed ? { kind: "failed", job: failed } :
      { kind: "lost-lease", job: null };
  }

  try {
    const completed = await input.artifacts.finishWithVideo({
      jobId: input.jobId,
      authorizedOrganizationId: input.authorizedOrganizationId,
      workerId: input.workerId,
      fence,
      video: rendered.video,
    });
    return completed ? { kind: "completed", job: completed } :
      { kind: "lost-lease", job: null };
  } finally {
    // The renderer's mutable plaintext must not be kept beyond this attempt.
    rendered.video.fill(0);
  }
}
