import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { buildHyperframesPilot } from "../apps/api/src/services/hyperframes-pilot.js";

const directory = resolve(process.argv[2] || "tmp/hyperframes-smoke");
const result = buildHyperframesPilot({
  brandName: "MODO DEMO",
  accentColor: "#2ED19A",
  format: "reel",
  scenes: [
    { headline: "Sua marca em modo presenca.", caption: "Direcao e criacao inteligentes.", durationSeconds: 2.5 },
    { headline: "Um passo de cada vez.", caption: "Demonstracao tecnica sem dados reais.", durationSeconds: 2.5 },
  ],
});
async function main() {
  await mkdir(directory, { recursive: true });
  await writeFile(resolve(directory, result.filename), result.html, { encoding: "utf8", mode: 0o600 });
  process.stdout.write(JSON.stringify({
    directory,
    filename: result.filename,
    durationSeconds: result.durationSeconds,
    fps: result.fps,
    resolution: [result.width, result.height],
    sampleOnly: true,
  }) + "\n");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
