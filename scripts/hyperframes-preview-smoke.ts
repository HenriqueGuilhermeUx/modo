import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { exportVideoProjectHyperframesPreview } from "../apps/api/src/services/hyperframes-project-preview.js";

const directory = resolve(process.argv[2] || "tmp/hyperframes-smoke");

/** Entirely synthetic existing MODO project, no customer data or provider calls. */
const fakeProject = {
  id: "11111111-1111-4111-8111-111111111111",
  organizationId: "demo-only",
  brandId: "22222222-2222-4222-8222-222222222222",
  contentRequestId: "33333333-3333-4333-8333-333333333333",
  durationSeconds: 15,
  aspectRatio: "9:16",
  fps: 30,
  voiceover: false,
  voiceProvider: null,
  scenes: [
    {
      index: 1, startFrame: 0, endFrame: 75,
      headline: "Sua marca em modo presença.",
      caption: "Direção e criação inteligentes.",
      visualType: "kinetic_text", assetSource: "native",
      imageUrl: null, videoUrl: null, motion: "static", transition: "cut",
    },
    {
      index: 2, startFrame: 75, endFrame: 150,
      headline: "Um passo de cada vez.",
      caption: "Demonstração técnica sem dados reais.",
      visualType: "kinetic_text", assetSource: "native",
      imageUrl: null, videoUrl: null, motion: "static", transition: "cut",
    },
  ],
} as Parameters<typeof exportVideoProjectHyperframesPreview>[0];

const result = exportVideoProjectHyperframesPreview(fakeProject, "MODO DEMO");
if (result.publishingAllowed || result.assetRenderingEnabled ||
    result.organizationId !== "demo-only") {
  throw new Error("HYPERFRAMES_SYNTHETIC_SCOPE_VIOLATION");
}

async function main() {
  await mkdir(directory, { recursive: true });
  await writeFile(resolve(directory, result.filename), result.html, { encoding: "utf8", mode: 0o600 });
  process.stdout.write(JSON.stringify({
    directory, filename: result.filename,
    durationSeconds: result.durationSeconds,
    fps: result.fps, resolution: [result.width, result.height],
    sampleOnly: true, sourcedFrom: "existing-modo-project-adapter",
    publishingAllowed: result.publishingAllowed,
  }) + "\n");
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
