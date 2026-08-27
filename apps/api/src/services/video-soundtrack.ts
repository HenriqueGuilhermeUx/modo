import type { VideoSoundtrackStyle } from "@modo/contracts/video";

const SAMPLE_RATE = 16_000;
const CHANNELS = 1;
const BITS_PER_SAMPLE = 16;

function clamp(value: number, min = -1, max = 1) {
  return Math.max(min, Math.min(max, value));
}

function fadeEnvelope(time: number, duration: number) {
  const fade = Math.min(1, time / 0.8, Math.max(0, duration - time) / 1.2);
  return Math.max(0, fade);
}

function sampleFor(style: VideoSoundtrackStyle, time: number, duration: number) {
  const tau = Math.PI * 2;
  const fade = fadeEnvelope(time, duration);

  if (style === "ambient") {
    const lfo = 0.7 + Math.sin(tau * 0.08 * time) * 0.12;
    const chord =
      Math.sin(tau * 110 * time) * 0.36 +
      Math.sin(tau * 164.81 * time) * 0.22 +
      Math.sin(tau * 220 * time) * 0.16;
    return clamp(chord * lfo * 0.38 * fade);
  }

  if (style === "cinematic") {
    const progress = duration > 0 ? time / duration : 0;
    const swell = 0.45 + progress * 0.45;
    const pulsePosition = time % 1.5;
    const impact = Math.exp(-pulsePosition * 6) * Math.sin(tau * 62 * time) * 0.42;
    const bed =
      Math.sin(tau * 82.41 * time) * 0.34 +
      Math.sin(tau * 123.47 * time) * 0.2 +
      Math.sin(tau * 164.81 * time) * 0.12;
    return clamp((bed * swell + impact) * 0.42 * fade);
  }

  const beatSeconds = 0.5;
  const beatPosition = time % beatSeconds;
  const kick = Math.exp(-beatPosition * 13) * Math.sin(tau * (72 - beatPosition * 28) * time) * 0.58;
  const bass = Math.sin(tau * 110 * time) * 0.24;
  const air = Math.sin(tau * 220 * time) * 0.08;
  return clamp((kick + bass + air) * 0.42 * fade);
}

export function createProceduralSoundtrackWav(input: {
  durationSeconds: number;
  style: VideoSoundtrackStyle;
}) {
  const durationSeconds = Math.max(1, Math.min(60, input.durationSeconds));
  const frameCount = Math.ceil(durationSeconds * SAMPLE_RATE);
  const bytesPerSample = BITS_PER_SAMPLE / 8;
  const dataSize = frameCount * CHANNELS * bytesPerSample;
  const buffer = Buffer.alloc(44 + dataSize);

  buffer.write("RIFF", 0, "ascii");
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write("WAVE", 8, "ascii");
  buffer.write("fmt ", 12, "ascii");
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(CHANNELS, 22);
  buffer.writeUInt32LE(SAMPLE_RATE, 24);
  buffer.writeUInt32LE(SAMPLE_RATE * CHANNELS * bytesPerSample, 28);
  buffer.writeUInt16LE(CHANNELS * bytesPerSample, 32);
  buffer.writeUInt16LE(BITS_PER_SAMPLE, 34);
  buffer.write("data", 36, "ascii");
  buffer.writeUInt32LE(dataSize, 40);

  for (let frame = 0; frame < frameCount; frame += 1) {
    const time = frame / SAMPLE_RATE;
    const value = sampleFor(input.style, time, durationSeconds);
    buffer.writeInt16LE(Math.round(value * 32767), 44 + frame * 2);
  }

  return buffer;
}

export function soundtrackDataUrl(input: {
  durationSeconds: number;
  style: VideoSoundtrackStyle;
}) {
  const data = createProceduralSoundtrackWav(input);
  return `data:audio/wav;base64,${data.toString("base64")}`;
}
