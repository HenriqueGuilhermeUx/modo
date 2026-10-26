import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { VideoProject } from "@modo/contracts/video";
import { renderHyperframesStagingPreview } from "../apps/api/src/services/hyperframes-staging-worker.js";

function sample(): VideoProject {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    organizationId: "synthetic-no-customer",
    brandId: "22222222-2222-4222-8222-222222222222",
    contentRequestId: "33333333-3333-4333-8333-333333333333",
    durationSeconds: 15, aspectRatio: "9:16", fps: 30,
    captions: true, voiceover: false, voiceProvider: null,
    visualProvider: null, brollProvider: null, status: "ready",
    renderer: "remotion",
    scenes: [
      { index: 1, startFrame: 0, endFrame: 75,
        headline: "Evolução com segurança", caption: "Demonstração do MODO.",
        visual: "Native typography", imageUrl: null, videoUrl: null,
        visualType: "kinetic_text", motion: "static", transition: "cut",
        assetSource: "native", assetRevision: 0, visualPrompt: null,
        stockQuery: null, stockCredit: null },
      { index: 2, startFrame: 75, endFrame: 150,
        headline: "Prévia sem publicação", caption: "Sem acessar clientes.",
        visual: "Native typography", imageUrl: null, videoUrl: null,
        visualType: "kinetic_text", motion: "static", transition: "cut",
        assetSource: "native", assetRevision: 0, visualPrompt: null,
        stockQuery: null, stockCredit: null },
    ],
    outputUrl: null, mimeType: null, error: null,
    createdAt: "2026-10-25T00:00:00Z", updatedAt: "2026-10-25T00:00:00Z",
  };
}

async function main() {
  if (process.env.GITHUB_ACTIONS !== "true" ||
      process.env.MODO_HYPERFRAMES_WORKER_MODE !== "isolated-staging" ||
      process.env.NODE_ENV === "production") {
    throw new Error("STAGING_SMOKE_CI_ONLY");
  }
  const [cli, ffprobe, output] = process.argv.slice(2);
  if (!cli || !ffprobe || !output) throw new Error("STAGING_SMOKE_ARGS_REQUIRED");
  const project = sample();
  const result = await renderHyperframesStagingPreview(project, "MODO SYNTHETIC", {
    hyperframesExecutable: resolve(cli),
    ffprobeExecutable: resolve(ffprobe),
  }, project.organizationId);
  if (result.organizationId !== project.organizationId || !result.previewOnly ||
      result.published !== false || result.bytes < 4000) {
    throw new Error("STAGING_SMOKE_SCOPE_OR_RENDER_INVALID");
  }
  await mkdir(resolve(output, ".."), { recursive: true });
  await writeFile(resolve(output), result.video, { mode: 0o600 });
  process.stdout.write(JSON.stringify({
    result: "ok", file: "sample.mp4", bytes: result.bytes,
    sha256: result.sha256, width: result.width, height: result.height,
    durationSeconds: result.durationSeconds,
    tenant: "synthetic-only", published: false,
  }) + "\n");
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
