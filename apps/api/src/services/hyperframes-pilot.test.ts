import { describe, expect, it } from "vitest";
import { buildHyperframesPilot } from "./hyperframes-pilot.js";

describe("HyperFrames isolated export", () => {
  const sample = () => ({
    brandName: "MODO",
    accentColor: "#2ED19A",
    format: "reel" as const,
    scenes: [
      { headline: "Sua marca presente", caption: "Uma mensagem clara", durationSeconds: 3 },
      { headline: "Fale conosco", durationSeconds: 2 },
    ],
  });

  it("exports a timed vertical HTML composition without invoking renderers", () => {
    const out = buildHyperframesPilot(sample());
    expect(out.width).toBe(1080);
    expect(out.height).toBe(1920);
    expect(out.durationSeconds).toBe(5);
    expect(out.html).toContain('data-composition-id="root"');
    expect(out.html).toContain('data-no-timeline');
    expect(out.html).toContain('data-duration="5"');
    expect(out.html).toContain('data-start="3" data-duration="2"');
    expect(out.status).toBe("export-only");
  });

  it("escapes untrusted brand and scene text", () => {
    const out = buildHyperframesPilot({
      ...sample(),
      brandName: '<script>alert(1)</script>',
      scenes: [{ headline: '<img src=x onerror=alert(1)>', durationSeconds: 2 }],
    });
    expect(out.html).not.toContain("<script>");
    expect(out.html).not.toContain("<img src=x");
    expect(out.html).toContain("&lt;script&gt;");
  });

  it("rejects malicious colors, infinite durations and long jobs", () => {
    expect(() => buildHyperframesPilot({ ...sample(), accentColor: "red;position:absolute" })).toThrow();
    expect(() => buildHyperframesPilot({ ...sample(), scenes: [{ headline: "x", durationSeconds: Infinity }] })).toThrow();
    expect(() => buildHyperframesPilot({ ...sample(), scenes: Array.from({length: 6}, () => ({headline:"x",durationSeconds: 12})) })).toThrow();
  });
});
