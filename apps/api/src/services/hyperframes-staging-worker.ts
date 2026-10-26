import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import { promisify } from "node:util";
import type { VideoProject } from "@modo/contracts/video";
import { exportVideoProjectHyperframesPreview } from "./hyperframes-project-preview.js";

const execFileAsync = promisify(execFile);
const MAX_FILE_BYTES = 25_000_000;
const TIMEOUT_MS = 300_000;
type Exec = (command: string, args: string[], options: {
  cwd: string; timeout: number; maxBuffer: number; env: NodeJS.ProcessEnv; windowsHide: boolean;
}) => Promise<{ stdout: string; stderr?: string }>;

export type HyperframesStagingTools = Readonly<{
  hyperframesExecutable: string;
  ffprobeExecutable: string;
  execute?: Exec;
}>;

/**
 * One-shot offline staging runner. No queue, storage, API route or production
 * imports. The caller must provide preinstalled, pinned executables in an
 * isolated worker image; no network-based npx, shell or asset downloads.
 */
export async function renderHyperframesStagingPreview(
  project: VideoProject,
  brandName: string,
  tools: HyperframesStagingTools,
  authorizedOrganizationId: string,
) {
  // The worker must receive a server-verified tenant scope from its future
  // scheduler; never trust the project payload by itself.
  if (!authorizedOrganizationId || !project ||
      project.organizationId !== authorizedOrganizationId) {
    throw new Error("HYPERFRAMES_WORKER_TENANT_SCOPE_DENIED");
  }
  if (process.env.MODO_HYPERFRAMES_WORKER_MODE !== "isolated-staging" ||
      process.env.NODE_ENV === "production") {
    throw new Error("HYPERFRAMES_WORKER_DISABLED");
  }
  if (!tools || !isAbsolute(tools.hyperframesExecutable) ||
      !isAbsolute(tools.ffprobeExecutable)) {
    throw new Error("HYPERFRAMES_WORKER_EXECUTABLES_NOT_PINNED");
  }
  const preview = exportVideoProjectHyperframesPreview(project, brandName);
  const workdir = await mkdtemp(join(tmpdir(), "modo-hf-stage-"));
  const execute: Exec = tools.execute || ((command, args, options) =>
    execFileAsync(command, args, options).then(({ stdout, stderr }) =>
      ({ stdout: String(stdout), stderr: String(stderr) })));
  // Only pass nonsecret worker variables, never production keys/tokens.
  const environment: NodeJS.ProcessEnv = {
    PATH: process.env.PATH || "/usr/bin:/bin",
    HOME: workdir,
    TMPDIR: workdir,
    LANG: "C.UTF-8",
  };
  const options = {
    cwd: workdir, timeout: TIMEOUT_MS, maxBuffer: 250_000,
    env: environment, windowsHide: true,
  };
  try {
    await writeFile(join(workdir, "index.html"), preview.html,
      { encoding: "utf8", mode: 0o600 });
    await execute(tools.hyperframesExecutable, ["lint"], options);
    await execute(tools.hyperframesExecutable, ["check"], options);
    await execute(tools.hyperframesExecutable,
      ["render", "--quality", "draft", "--output", "sample.mp4"], options);
    const file = join(workdir, "sample.mp4");
    const size = (await stat(file)).size;
    if (size < 4000 || size > MAX_FILE_BYTES) {
      throw new Error("HYPERFRAMES_STAGING_INVALID_MP4_SIZE");
    }
    const probe = await execute(tools.ffprobeExecutable,
      ["-v", "error", "-show_entries",
       "stream=codec_type,width,height,r_frame_rate:format=duration",
       "-of", "json", file], options);
    let details: { streams?: Array<{codec_type?: string;width?: number;height?: number;r_frame_rate?: string}>;
      format?: {duration?: string} };
    try {
      details = JSON.parse(probe.stdout);
    } catch {
      throw new Error("HYPERFRAMES_STAGING_INVALID_FFPROBE");
    }
    // Staging output must be a single video-only stream. A renderer bug or
    // unexpected embedded track must never introduce customer audio, subtitles,
    // attachments or secondary videos into a preview declared silent.
    if (!Array.isArray(details.streams) || details.streams.length !== 1 ||
        details.streams[0]?.codec_type !== "video") {
      throw new Error("HYPERFRAMES_STAGING_UNEXPECTED_MEDIA_STREAMS");
    }
    const stream = details.streams[0];
    const duration = Number(details.format?.duration);
    if (stream.width !== preview.width ||
        stream.height !== preview.height || stream.r_frame_rate !== "30/1" ||
        !Number.isFinite(duration) ||
        Math.abs(duration - preview.durationSeconds) > 0.16) {
      throw new Error("HYPERFRAMES_STAGING_INVALID_VIDEO_PROPERTIES");
    }
    const video = await readFile(file);
    return {
      projectId: project.id,
      organizationId: project.organizationId,
      mimeType: "video/mp4" as const,
      video,
      sha256: createHash("sha256").update(video).digest("hex"),
      bytes: size,
      width: stream.width,
      height: stream.height,
      durationSeconds: duration,
      previewOnly: true as const,
      published: false as const,
    };
  } finally {
    await rm(workdir, { recursive: true, force: true });
  }
}
