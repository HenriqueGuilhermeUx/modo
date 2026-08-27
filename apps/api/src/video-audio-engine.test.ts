import { describe, expect, it } from "vitest";
import {
  chooseVideoSoundtrackProfile,
  createVideoSoundtrackDataUri,
  soundtrackVolumeAtFrame,
} from "./video-audio-engine.js";

describe("MODO Video V1.6 audio engine", () => {
  it("escolhe perfil de soundtrack pela direção visual", () => {
    expect(chooseVideoSoundtrackProfile([
      { visualType: "broll_video", startFrame: 0, endFrame: 150 },
      { visualType: "broll_video", startFrame: 150, endFrame: 300 },
      { visualType: "data_card", startFrame: 300, endFrame: 450 },
    ])).toBe("warm");

    expect(chooseVideoSoundtrackProfile([
      { visualType: "kinetic_text", startFrame: 0, endFrame: 150 },
      { visualType: "kinetic_text", startFrame: 150, endFrame: 300 },
    ])).toBe("pulse");

    expect(chooseVideoSoundtrackProfile([
      { visualType: "interface", startFrame: 0, endFrame: 150 },
      { visualType: "data_card", startFrame: 150, endFrame: 300 },
    ])).toBe("focus");
  });

  it("gera WAV nativo determinístico e cacheável", () => {
    const first = createVideoSoundtrackDataUri("warm");
    const second = createVideoSoundtrackDataUri("warm");
    expect(first.startsWith("data:audio/wav;base64,UklGR")).toBe(true);
    expect(first.length).toBeGreaterThan(100_000);
    expect(second).toBe(first);
  });

  it("faz ducking quando a locução está ativa", () => {
    const scenes = [
      { startFrame: 0, endFrame: 150, audioUrl: "data:audio/mpeg;base64,abc" },
      { startFrame: 150, endFrame: 300, audioUrl: null },
    ];
    const underVoice = soundtrackVolumeAtFrame({ frame: 90, totalFrames: 300, scenes, baseVolume: 0.2 });
    const withoutVoice = soundtrackVolumeAtFrame({ frame: 210, totalFrames: 300, scenes, baseVolume: 0.2 });
    expect(underVoice).toBeLessThan(withoutVoice);
    expect(withoutVoice).toBeCloseTo(0.2, 4);
  });
});
