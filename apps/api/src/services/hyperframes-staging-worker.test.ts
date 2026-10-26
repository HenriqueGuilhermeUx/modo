import { describe, expect, it } from "vitest";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { VideoProject } from "@modo/contracts/video";
import { renderHyperframesStagingPreview } from "./hyperframes-staging-worker.js";

const sample = () => ({
  id: "11111111-1111-4111-8111-111111111111",
  organizationId: "sandbox-only",
  durationSeconds: 15,
  aspectRatio: "9:16", fps: 30, voiceover: false, voiceProvider: null,
  scenes: [{
    index: 1, startFrame: 0, endFrame: 225,
    headline: "Apenas demonstração", caption: "Sem cliente real.",
    visualType: "kinetic_text", assetSource: "native",
    imageUrl: null, videoUrl: null, motion: "static", transition: "cut",
  }, {
    index: 2, startFrame: 225, endFrame: 450,
    headline: "Segunda cena", caption: "Sem narração ou assets externos.",
    visualType: "kinetic_text", assetSource: "native",
    imageUrl: null, videoUrl: null, motion: "static", transition: "cut",
  }],
}) as VideoProject;

describe("isolated HyperFrames staging runner", () => {
  const old = process.env.MODO_HYPERFRAMES_WORKER_MODE;
  function restore() {
    if (old === undefined) delete process.env.MODO_HYPERFRAMES_WORKER_MODE;
    else process.env.MODO_HYPERFRAMES_WORKER_MODE = old;
  }

  it("fails closed without explicitly enabled staging mode", async () => {
    delete process.env.MODO_HYPERFRAMES_WORKER_MODE;
    await expect(renderHyperframesStagingPreview(sample(), "Marca", {
      hyperframesExecutable: "/usr/local/bin/hyperframes",
      ffprobeExecutable: "/usr/bin/ffprobe",
    }, "sandbox-only")).rejects.toThrow(/WORKER_DISABLED/);
    restore();
  });

  it("validates output metadata, keeps tenant context, and uses no secret env", async () => {
    process.env.MODO_HYPERFRAMES_WORKER_MODE = "isolated-staging";
    const invoked: string[] = [];
    const mock = async (command: string, args: string[], opt: { cwd: string; env: NodeJS.ProcessEnv }) => {
      expect(opt.env.FINSIGHT_INTERNAL_API_KEY).toBeUndefined();
      invoked.push(command + ":" + args[0]);
      if (args[0] === "render") await writeFile(join(opt.cwd, "sample.mp4"), Buffer.alloc(5000, 1));
      if (command.includes("ffprobe")) return {
        stdout: JSON.stringify({ streams: [{
          codec_type: "video", width: 1080, height: 1920, r_frame_rate: "30/1",
        }], format: {duration: "15.000000"} }),
      };
      return { stdout: "" };
    };
    try {
      const result = await renderHyperframesStagingPreview(sample(), "Marca", {
        hyperframesExecutable: "/usr/local/bin/hyperframes",
        ffprobeExecutable: "/usr/bin/ffprobe",
        execute: mock,
      }, "sandbox-only");
      expect(result.organizationId).toBe("sandbox-only");
      expect(result.durationSeconds).toBe(15);
      expect(result.bytes).toBe(5000);
      expect(result.sha256).toMatch(/^[a-f0-9]{64}$/);
      expect(result.published).toBe(false);
      expect(invoked).toEqual([
        "/usr/local/bin/hyperframes:lint",
        "/usr/local/bin/hyperframes:check",
        "/usr/local/bin/hyperframes:render",
        "/usr/bin/ffprobe:-v",
      ]);
    } finally { restore(); }
  });

  it("rejects cross-tenant preview before any subprocess or file creation", async () => {
    process.env.MODO_HYPERFRAMES_WORKER_MODE = "isolated-staging";
    try {
      let invoked = false;
      await expect(renderHyperframesStagingPreview(sample(), "Marca", {
        hyperframesExecutable: "/usr/local/bin/hyperframes",
        ffprobeExecutable: "/usr/bin/ffprobe",
        execute: async () => { invoked = true; return { stdout: "" }; },
      }, "other-organization")).rejects.toThrow(/TENANT_SCOPE_DENIED/);
      expect(invoked).toBe(false);
    } finally { restore(); }
  });

  it("rejects bad properties instead of accepting an invalid render", async () => {
    process.env.MODO_HYPERFRAMES_WORKER_MODE = "isolated-staging";
    const mock = async (_command: string, args: string[], opt: {cwd:string}) => {
      if (args[0] === "render") await writeFile(join(opt.cwd, "sample.mp4"), Buffer.alloc(5000, 1));
      return args[0] === "-v" ? {
        stdout: JSON.stringify({ streams: [{codec_type:"video", width:100, height:100,
          r_frame_rate:"30/1"}],format:{duration:"5.000000"} }),
      } : { stdout: "" };
    };
    try {
      await expect(renderHyperframesStagingPreview(sample(), "Marca", {
        hyperframesExecutable: "/usr/local/bin/hyperframes",
        ffprobeExecutable: "/usr/bin/ffprobe", execute: mock,
      }, "sandbox-only")).rejects.toThrow(/INVALID_VIDEO_PROPERTIES/);
    } finally { restore(); }
  });
});
