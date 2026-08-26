import { bundle } from "@remotion/bundler";
import { renderMedia, selectComposition } from "@remotion/renderer";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const FPS = 30;
const SMOKE_FRAMES = FPS;

const inputProps = {
  brandName: "MODO CI",
  title: "MODO Video render smoke",
  accentColor: "#2ED19A",
  captions: true,
  scenes: [
    {
      index: 1,
      startFrame: 0,
      endFrame: 450,
      headline: "A estratégia vira vídeo.",
      visual: "Composição programática MODO sem dependência de mídia externa.",
      caption: "Smoke real do renderer Remotion em H.264.",
      imageUrl: null,
    },
  ],
};

function assertMp4(data: Buffer) {
  if (data.length < 1024) {
    throw new Error(`MP4 do smoke ficou pequeno demais: ${data.length} bytes.`);
  }

  const header = data.subarray(0, Math.min(64, data.length)).toString("latin1");
  if (!header.includes("ftyp")) {
    throw new Error("Saída do renderer não contém a assinatura MP4 'ftyp'.");
  }
}

async function main() {
  const workdir = await mkdtemp(join(tmpdir(), "modo-video-smoke-"));
  const outputLocation = join(workdir, "modo-video-smoke.mp4");
  const entryPoint = fileURLToPath(new URL("../video-remotion-entry.ts", import.meta.url));

  try {
    console.log("[MODO Video] Empacotando composição Remotion...");
    const serveUrl = await bundle({ entryPoint });
    const composition = await selectComposition({
      serveUrl,
      id: "ModoVideo15",
      inputProps,
    });

    console.log(`[MODO Video] Renderizando ${SMOKE_FRAMES} frames reais em H.264...`);
    await renderMedia({
      composition,
      serveUrl,
      codec: "h264",
      pixelFormat: "yuv420p",
      outputLocation,
      inputProps,
      frameRange: [0, SMOKE_FRAMES - 1],
      concurrency: 1,
      logLevel: "warn",
    });

    const data = await readFile(outputLocation);
    assertMp4(data);
    console.log(`[MODO Video] Smoke OK: MP4 H.264 válido (${data.length} bytes).`);
  } finally {
    await rm(workdir, { recursive: true, force: true }).catch(() => undefined);
  }
}

main().catch((error) => {
  console.error("[MODO Video] Smoke de render falhou.");
  console.error(error);
  process.exit(1);
});
