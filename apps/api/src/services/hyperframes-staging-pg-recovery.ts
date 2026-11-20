import type { HyperframesStagingTools } from "./hyperframes-staging-worker.js";
import { HyperframesStagingPgQueue } from "./hyperframes-staging-pg-queue.js";
import { HyperframesStagingPgArtifacts } from "./hyperframes-staging-pg-artifacts.js";
import { HyperframesStagingPgSnapshots } from "./hyperframes-staging-pg-snapshots.js";
import {
  processStagingHyperframesPgJob,
  type StagingRunOutcome,
} from "./hyperframes-staging-pg-render-runner.js";
import { renderHyperframesStagingPreview } from "./hyperframes-staging-worker.js";

/**
 * Crash-safe manual recovery of one authorized staging job.
 *
 * A trusted scheduler selects an explicit job and organization based on its
 * own service auth. We decrypt its original *immutable* snapshot rather
 * than reading a potentially edited project from the active MODO database.
 * The regular Postgres lease+fencing mechanism decides whether it may run.
 *
 * This is NOT a poller, public API, Render service or publisher integration.
 */
export async function resumeStagingHyperframesPgJob(input: Readonly<{
  jobId: string;
  authorizedOrganizationId: string;
  workerId: string;
  queue: HyperframesStagingPgQueue;
  snapshots: HyperframesStagingPgSnapshots;
  artifacts: HyperframesStagingPgArtifacts;
  tools: HyperframesStagingTools;
  render?: typeof renderHyperframesStagingPreview;
  leaseMs?: number;
  heartbeatMs?: number;
}>): Promise<StagingRunOutcome> {
  if (!input?.authorizedOrganizationId || !input.jobId ||
      !input.workerId || !input.snapshots || !input.queue ||
      !input.artifacts || !input.tools) {
    throw new Error("HYPERFRAMES_STAGING_PG_RECOVERY_INVALID_REQUEST");
  }
  const source = await input.snapshots.load(
    input.jobId, input.authorizedOrganizationId);
  if (!source) return { kind: "unclaimed", job: null };
  return processStagingHyperframesPgJob({
    jobId: input.jobId,
    project: source.project,
    brandName: source.brandName,
    authorizedOrganizationId: input.authorizedOrganizationId,
    workerId: input.workerId,
    queue: input.queue,
    artifacts: input.artifacts,
    tools: input.tools,
    render: input.render,
    leaseMs: input.leaseMs,
    heartbeatMs: input.heartbeatMs,
  });
}
