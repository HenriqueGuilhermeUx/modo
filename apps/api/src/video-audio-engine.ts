export type VideoSoundtrackProfile = "warm" | "focus" | "pulse";

type SoundtrackScene = {
  visualType?: string;
  audioUrl?: string | null;
  startFrame: number;
  endFrame: number;
};

const soundtrackCache = new Map<VideoSoundtrackProfile, string>();

function writeAscii(view: DataView, offset: number, value: string) {
  for (let index = 0; index < value.length; index += 1) {
    view.setUint8(offset + index, value.charCodeAt(index));
  }
}

function encodeBase64(bytes: Uint8Array) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  let result = "";
  for (let index = 0; index < bytes.length; index += 3) {
    const a = bytes[index] ?? 0;
    const b = bytes[index + 1] ?? 0;
    const c = bytes[index + 2] ?? 0;
    const triplet = (a << 16) | (b << 8) | c;
    result += alphabet[(triplet >> 18) & 63];
    result += alphabet[(triplet >> 12) & 63];
    result += index + 1 < bytes.length ? alphabet[(triplet >> 6) & 63] : "=";
    result += index + 2 < bytes.length ? alphabet[triplet & 63] : "=";
  }
  return result;
}

function profileFrequencies(profile: VideoSoundtrackProfile) {
  if (profile === "warm") return [110, 164.81, 220];
  if (profile === "focus") return [98, 146.83, 196];
  return [130.81, 196, 261.63];
}

export function chooseVideoSoundtrackProfile(scenes: SoundtrackScene[]): VideoSoundtrackProfile {
  const broll = scenes.filter((scene) => scene.visualType === "broll_video").length;
  const kinetic = scenes.filter((scene) => scene.visualType === "kinetic_text").length;
  const structured = scenes.filter((scene) => scene.visualType === "interface" || scene.visualType === "data_card").length;
  if (broll >= Math.max(1, structured)) return "warm";
  if (kinetic >= 2) return "pulse";
  return "focus";
}

export function createVideoSoundtrackDataUri(profile: VideoSoundtrackProfile) {
  const cached = soundtrackCache.get(profile);
  if (cached) return cached;

  const sampleRate = 11025;
  const seconds = 4;
  const sampleCount = sampleRate * seconds;
  const bytesPerSample = 2;
  const buffer = new ArrayBuffer(44 + sampleCount * bytesPerSample);
  const view = new DataView(buffer);

  writeAscii(view, 0, "RIFF");
  view.setUint32(4, 36 + sampleCount * bytesPerSample, true);
  writeAscii(view, 8, "WAVE");
  writeAscii(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * bytesPerSample, true);
  view.setUint16(32, bytesPerSample, true);
  view.setUint16(34, 16, true);
  writeAscii(view, 36, "data");
  view.setUint32(40, sampleCount * bytesPerSample, true);

  const frequencies = profileFrequencies(profile);
  const bpm = profile === "pulse" ? 104 : profile === "warm" ? 88 : 96;
  const beatHz = bpm / 60;

  for (let index = 0; index < sampleCount; index += 1) {
    const time = index / sampleRate;
    const edgeFade = Math.min(1, time / 0.08, (seconds - time) / 0.08);
    const pulse = 0.72 + Math.max(0, Math.sin(Math.PI * 2 * beatHz * time)) * (profile === "pulse" ? 0.28 : 0.12);
    const pad =
      Math.sin(Math.PI * 2 * frequencies[0] * time) * 0.52 +
      Math.sin(Math.PI * 2 * frequencies[1] * time) * 0.28 +
      Math.sin(Math.PI * 2 * frequencies[2] * time) * 0.2;
    const shimmer = Math.sin(Math.PI * 2 * frequencies[2] * 2 * time + Math.sin(time * 0.7)) * 0.08;
    const value = Math.max(-1, Math.min(1, (pad + shimmer) * pulse * edgeFade * 0.34));
    view.setInt16(44 + index * bytesPerSample, Math.round(value * 32767), true);
  }

  const uri = `data:audio/wav;base64,${encodeBase64(new Uint8Array(buffer))}`;
  soundtrackCache.set(profile, uri);
  return uri;
}

export function soundtrackVolumeAtFrame(input: {
  frame: number;
  totalFrames: number;
  scenes: SoundtrackScene[];
  baseVolume?: number;
}) {
  const baseVolume = input.baseVolume ?? 0.13;
  const fadeFrames = Math.min(30, Math.max(1, Math.floor(input.totalFrames / 8)));
  const fadeIn = Math.min(1, input.frame / fadeFrames);
  const fadeOut = Math.min(1, Math.max(0, input.totalFrames - input.frame) / fadeFrames);
  const voiceActive = input.scenes.some(
    (scene) => Boolean(scene.audioUrl) && input.frame >= scene.startFrame && input.frame < scene.endFrame,
  );
  const duck = voiceActive ? 0.28 : 1;
  return Math.max(0, Math.min(1, baseVolume * fadeIn * fadeOut * duck));
}
