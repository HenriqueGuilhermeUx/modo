import { afterEach, describe, expect, it } from "vitest";
import { baseModel, estimateUsd, recordCost, setCostSink } from "./cost-meter.js";

describe("cost-meter", () => {
  afterEach(() => setCostSink((line) => console.info(line)));

  it("normalizes model snapshots", () => {
    expect(baseModel("gpt-image-2-2026-04-21")).toBe("gpt-image-2");
    expect(baseModel("gpt-5-mini")).toBe("gpt-5-mini");
  });

  it("prices text by real tokens", () => {
    // 6.000 entrada * 0,25 + 3.000 saída * 2,00 por 1M = 0,0075
    expect(
      estimateUsd({
        operation: "text",
        model: "gpt-5-mini",
        purpose: "content_static_post",
        ok: true,
        inputTokens: 6000,
        outputTokens: 3000,
      }),
    ).toBeCloseTo(0.0075, 6);
  });

  it("prices images by usage when present and by table otherwise", () => {
    expect(
      estimateUsd({
        operation: "image",
        model: "gpt-image-2-2026-04-21",
        purpose: "content_carousel",
        ok: true,
        inputTokens: 200,
        outputTokens: 1756,
      }),
    ).toBeCloseTo((200 * 5 + 1756 * 30) / 1_000_000, 6);
    expect(
      estimateUsd({
        operation: "image",
        model: "gpt-image-2",
        purpose: "video_scene_first_cut",
        ok: true,
        quality: "low",
        size: "1024x1536",
      }),
    ).toBe(0.005);
  });

  it("estimates TTS by text length and returns zero for failures", () => {
    // 900 caracteres ≈ 60 s ≈ US$ 0,015
    expect(
      estimateUsd({
        operation: "tts",
        model: "gpt-4o-mini-tts",
        purpose: "video_voice",
        ok: true,
        characters: 900,
      }),
    ).toBeCloseTo(0.015, 6);
    expect(estimateUsd({ operation: "image", model: "gpt-image-2", purpose: "x", ok: false })).toBe(
      0,
    );
  });

  it("writes one tagged JSON line per call and never throws", () => {
    const lines: string[] = [];
    setCostSink((line) => lines.push(line));
    recordCost({
      operation: "image",
      model: "gpt-image-2",
      purpose: "content_static_post",
      organizationId: "org_1",
      reference: "content_1",
      quality: "medium",
      size: "1024x1024",
      ok: true,
    });
    expect(lines).toHaveLength(1);
    expect(lines[0].startsWith("[modo-cost] ")).toBe(true);
    const parsed = JSON.parse(lines[0].slice("[modo-cost] ".length));
    expect(parsed).toMatchObject({ reference: "content_1", estimatedUsd: 0.053 });

    setCostSink(() => {
      throw new Error("sink quebrado");
    });
    expect(() =>
      recordCost({ operation: "text", model: "gpt-5-mini", purpose: "scan", ok: true }),
    ).not.toThrow();
  });
});
