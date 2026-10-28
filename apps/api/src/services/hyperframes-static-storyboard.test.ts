import { describe, expect, it } from "vitest";
import type { VideoProject } from "@modo/contracts/video";
import { buildStaticStoryboardPlan } from "./hyperframes-static-storyboard.js";

const syntheticProject = (): VideoProject => ({
  id: "11111111-1111-4111-8111-111111111111",
  organizationId: "synthetic-organization-only",
  durationSeconds: 5, aspectRatio: "9:16",
  fps: 30, voiceover: false, voiceProvider: null,
  scenes: [
    { index: 1, startFrame: 0, endFrame: 31,
      headline: "Primeira cena sintética", caption: "Quadros 0 a 30",
      visualType: "kinetic_text", assetSource: "native",
      imageUrl: null, videoUrl: null, motion: "static", transition: "cut" },
    { index: 2, startFrame: 31, endFrame: 95,
      headline: "Segunda cena sintética", caption: "Quadros 31 a 94",
      visualType: "kinetic_text", assetSource: "native",
      imageUrl: null, videoUrl: null, motion: "static", transition: "cut" },
    { index: 3, startFrame: 95, endFrame: 150,
      headline: "Terceira cena sintética", caption: "Quadros 95 a 149",
      visualType: "kinetic_text", assetSource: "native",
      imageUrl: null, videoUrl: null, motion: "static", transition: "cut" },
  ],
} as VideoProject);

describe("MODO static CDP/FFmpeg storyboard pilot", () => {
  it("preserves *integral* 30fps scene boundaries without rounding drift", () => {
    const plan = buildStaticStoryboardPlan(syntheticProject(), "Marca Sintética");
    expect(plan.fps).toBe(30);
    expect(plan.width).toBe(1080);
    expect(plan.height).toBe(1920);
    expect(plan.totalFrames).toBe(150);
    expect(plan.scenes.map(s => [s.startFrame, s.endFrame, s.frames])).toEqual([
      [0, 31, 31], [31, 95, 64], [95, 150, 55],
    ]);
    expect(plan.scenes.map(s => s.headline)).toEqual([
      "Primeira cena sintética", "Segunda cena sintética", "Terceira cena sintética",
    ]);
    expect(plan.html).toContain('data-composition-id="root"');
    expect(plan.html).toContain("Terceira cena sintética");
    expect(plan.previewOnly).toBe(true);
    expect(plan.publishingAllowed).toBe(false);
    expect(plan.renderer).toBe("cdp-ffmpeg-static-pilot");
    expect(plan.planSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(plan)).not.toContain("synthetic-organization-only");
    expect(JSON.stringify(plan)).not.toContain(syntheticProject().id);
  });

  it("binds digest to all scene boundaries and escaped text", () => {
    const a = syntheticProject();
    const base = buildStaticStoryboardPlan(a, "Marca");
    expect(buildStaticStoryboardPlan(syntheticProject(), "Marca").planSha256).toBe(
      base.planSha256);
    a.scenes[0].headline = '<script>alert("x")</script>';
    const changed = buildStaticStoryboardPlan(a, "Marca");
    expect(changed.planSha256).not.toBe(base.planSha256);
    expect(changed.html).not.toContain("<script>");
    expect(changed.html).toContain("&lt;script&gt;");
    const b = syntheticProject();
    b.scenes[0].endFrame = 32;
    b.scenes[1].startFrame = 32;
    expect(buildStaticStoryboardPlan(b, "Marca").planSha256).not.toBe(
      base.planSha256);
  });

  it("rejects unsupported media, motion, audio and malformed timing", () => {
    const p = syntheticProject();
    p.scenes[1].videoUrl = "https://example.com/real.mp4";
    expect(() => buildStaticStoryboardPlan(p, "Marca")).toThrow(/UNSUPPORTED_MEDIA/);
    p.scenes[1].videoUrl = null;
    p.scenes[1].motion = "push_in";
    expect(() => buildStaticStoryboardPlan(p, "Marca")).toThrow(/UNSUPPORTED_MEDIA/);
    p.scenes[1].motion = "static";
    p.voiceover = true;
    expect(() => buildStaticStoryboardPlan(p, "Marca")).toThrow(/UNSUPPORTED_PROJECT/);
    p.voiceover = false;
    p.scenes[1].startFrame = 30;
    expect(() => buildStaticStoryboardPlan(p, "Marca")).toThrow(/UNSUPPORTED_TIMELINE/);
    p.scenes[1].startFrame = 31;
    p.durationSeconds = 6;
    expect(() => buildStaticStoryboardPlan(p, "Marca")).toThrow(/UNSUPPORTED_TOTAL/);
  });
});
