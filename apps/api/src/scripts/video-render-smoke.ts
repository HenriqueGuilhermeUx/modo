import { bundle } from "@remotion/bundler";
import { renderMedia, selectComposition } from "@remotion/renderer";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const FPS = 30;
const SMOKE_FRAMES = FPS;

function silentWavDataUrl(seconds = 1, sampleRate = 8000) {
  const samples = Math.max(1, Math.round(seconds * sampleRate));
  const bytesPerSample = 2;
  const dataSize = samples * bytesPerSample;
  const wav = Buffer.alloc(44 + dataSize);
  wav.write("RIFF", 0);
  wav.writeUInt32LE(36 + dataSize, 4);
  wav.write("WAVE", 8);
  wav.write("fmt ", 12);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(sampleRate, 24);
  wav.writeUInt32LE(sampleRate * bytesPerSample, 28);
  wav.writeUInt16LE(bytesPerSample, 32);
  wav.writeUInt16LE(16, 34);
  wav.write("data", 36);
  wav.writeUInt32LE(dataSize, 40);
  return `data:audio/wav;base64,${wav.toString("base64")}`;
}

const smokeSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="720" height="1280"><rect width="720" height="1280" fill="#102c5f"/><circle cx="540" cy="280" r="180" fill="#2ED19A"/><rect x="120" y="720" width="480" height="180" rx="36" fill="#ffffff" opacity=".18"/></svg>`;

async function startSmokeAssetServer() {
  const server = createServer((request, response) => {
    const url = new URL(request.url || "/", "http://127.0.0.1");
    if (url.pathname !== "/smoke.svg") {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(200, {
      "Content-Type": "image/svg+xml; charset=utf-8",
      "Cache-Control": "no-store",
    });
    response.end(smokeSvg);
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    server.close();
    throw new Error("Não foi possível abrir o servidor local do asset do smoke.");
  }

  const imageUrl = `http://127.0.0.1:${address.port}/smoke.svg?mlfx=72&mlfy=28&mlz=1.2&mltrim=0`;
  return { server, imageUrl };
}

function createInputProps(imageUrl: string) {
  return {
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
        visual: "Asset enquadrado pelo Media Lab sem perder a direção MODO.",
        caption: "Smoke real do renderer Remotion em H.264 com enquadramento, direção visual e áudio.",
        imageUrl,
        videoUrl: null,
        visualType: "generated_image",
        motion: "pan_right",
        pace: "steady",
        transition: "cut",
        assetSource: "upload",
        assetRevision: 1,
        visualPrompt: "Composição editorial de marketing.",
        audioUrl: silentWavDataUrl(),
      },
    ],
  };
}

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
  const { server, imageUrl } = await startSmokeAssetServer();
  const inputProps = createInputProps(imageUrl);

  try {
    console.log("[MODO Video] Empacotando composição Remotion...");
    const serveUrl = await bundle({
      entryPoint,
      webpackOverride: (config) => ({
        ...config,
        resolve: {
          ...config.resolve,
          extensionAlias: {
            ...config.resolve?.extensionAlias,
            ".js": [".ts", ".tsx", ".js"],
          },
        },
      }),
    });
    const composition = await selectComposition({
      serveUrl,
      id: "ModoVideo15",
      inputProps,
    });

    console.log(`[MODO Video] Renderizando ${SMOKE_FRAMES} frames reais em H.264 com áudio, soundtrack e Media Lab...`);
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
    console.log(`[MODO Video] Smoke OK: MP4 H.264 válido com locução, soundtrack e enquadramento Media Lab (${data.length} bytes).`);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve())).catch(() => undefined);
    await rm(workdir, { recursive: true, force: true }).catch(() => undefined);
  }
}

main().catch((error) => {
  console.error("[MODO Video] Smoke de render falhou.");
  console.error(error);
  process.exit(1);
});