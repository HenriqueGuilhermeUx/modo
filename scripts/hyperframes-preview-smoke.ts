import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { buildHyperframesPilot } from "../apps/api/src/services/hyperframes-pilot.js";

const directory = resolve(process.argv[2] || "tmp/hyperframes-smoke");

/** Lightweight composition smoke; full MODO project fidelity is tested in staging-worker E2E. */
const result = buildHyperframesPilot({
  brandName: "MODO DEMO", accentColor: "#2ED19A", format: "reel",
  scenes: [
    { headline: "Sua marca em modo presença.", caption: "Direção e criação inteligentes.", durationSeconds: 2.5 },
    { headline: "Um passo de cada vez.", caption: "Demonstração técnica sem dados reais.", durationSeconds: 2.5 },
  ],
});
if (result.status !== "export-only") throw new Error("HYPERFRAMES_SMOKE_INVALID_EXPORT");

async function main() {
  await mkdir(directory, { recursive: true });
  await writeFile(resolve(directory, result.filename), result.html, { encoding: "utf8", mode: 0o600 });
  process.stdout.write(JSON.stringify({
    directory, filename: result.filename,
    durationSeconds: result.durationSeconds,
    fps: result.fps, resolution: [result.width, result.height],
    sampleOnly: true, sourcedFrom: "standalone-synthetic-composition",
    publishingAllowed: false,
  }) + "\n");
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
