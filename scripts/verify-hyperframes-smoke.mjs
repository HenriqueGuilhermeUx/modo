import { execFileSync } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { resolve } from "node:path";

const input = resolve(process.argv[2] || "");
if (!process.argv[2] || !existsSync(input)) {
  throw new Error("HYPERFRAMES_TEST_VIDEO_MISSING");
}
const file = statSync(input);
if (file.size < 4000 || file.size > 40_000_000) {
  throw new Error("HYPERFRAMES_TEST_UNEXPECTED_FILE_SIZE");
}

function execute(program, args) {
  return execFileSync(program, args, {
    encoding: "utf8",
    timeout: 30000,
    maxBuffer: 1_000_000,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

const probe = JSON.parse(execute("ffprobe", [
  "-v", "error", "-show_entries",
  "stream=index,codec_type,codec_name,width,height,r_frame_rate:format=duration",
  "-of", "json", input,
]));
const track = probe.streams?.find((stream) => stream.codec_type === "video");
if (!track || track.width !== 1080 || track.height !== 1920 ||
    track.r_frame_rate !== "30/1") {
  throw new Error("HYPERFRAMES_TEST_UNEXPECTED_VIDEO_PROPERTIES");
}
const duration = Number(probe.format?.duration);
if (!Number.isFinite(duration) || duration < 4.9 || duration > 5.1) {
  throw new Error("HYPERFRAMES_TEST_UNEXPECTED_DURATION");
}

// Compare decoded frames from different scenes. A valid MP4 consisting of
// a frozen/black frame must NOT be accepted as a successful visual rendering.
function frameDigest(seconds) {
  const result = execute("ffmpeg", [
    "-nostdin", "-hide_banner", "-loglevel", "error", "-ss", String(seconds),
    "-i", input, "-frames:v", "1", "-an", "-f", "framemd5", "-",
  ]);
  const line = result.split("\n").find((s) => /^\d+,/.test(s.trim()));
  if (!line) throw new Error("HYPERFRAMES_TEST_FRAME_MISSING");
  const digest = line.split(",").at(-1)?.trim();
  if (!/^[a-f0-9]{32}$/i.test(digest || "")) {
    throw new Error("HYPERFRAMES_TEST_BAD_FRAME_DIGEST");
  }
  return digest;
}

const first = frameDigest(1);
const second = frameDigest(4);
if (first === second) throw new Error("HYPERFRAMES_TEST_STATIC_VIDEO");
process.stdout.write(JSON.stringify({
  status: "pass", video: "synthetic",
  seconds: duration, width: track.width, height: track.height,
  fps: 30, scenesDiffer: true, codec: track.codec_name,
}) + "\n");
