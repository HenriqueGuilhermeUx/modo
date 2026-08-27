import type { VideoScene } from "@modo/contracts/video";
import {
  evaluateVideoFirstCut,
  explicitVideoCreativeProfile,
  inferVideoCreativeProfile,
  videoCreativeProfileSignature,
} from "@modo/contracts/video-first-cut";
import { describe, expect, it } from "vitest";

function scene(index: number, patch: Partial<VideoScene> = {}): VideoScene {
  return {
    index,
    startFrame: (index - 1) * 180,
    endFrame: index * 180,
    headline: index === 1 ? "Seu próximo cliente precisa entender seu valor." : index === 4 ? "Fale com nossa equipe hoje." : `Cena ${index}`,
    visual: "Pessoa brasileira em um ambiente profissional, composição vertical.",
    caption: "Uma locução curta, clara e adequada ao tempo da cena.",
    imageUrl: index === 2 ? "https://modo.example.com/cena.jpg" : null,
    videoUrl: index === 3 ? "https://modo.example.com/cena.mp4" : null,
    visualType: index === 3 ? "broll_video" : index === 4 ? "kinetic_text" : "generated_image",
    motion: "push_in",
    pace: index === 3 || index === 4 ? "dynamic" : "steady",
    transition: index === 1 ? "cut" : index === 2 ? "fade" : index === 3 ? "slide" : "zoom",
    assetSource: index === 3 ? "stock" : index === 2 ? "generated" : "native",
    assetRevision: 0,
    visualPrompt: "Direção editorial.",
    stockQuery: null,
    stockCredit: null,
    ...patch,
  };
}

describe("MODO Video First Cut V1.8", () => {
  it("infere direção humana quando o storyboard é centrado em pessoas", () => {
    const scenes = [scene(1), scene(2), scene(3), scene(4)];
    expect(inferVideoCreativeProfile(scenes)).toBe("human");
  });

  it("prioriza a assinatura manual do perfil sem depender do texto", () => {
    const signature = videoCreativeProfileSignature("premium");
    const first = scene(1, signature);
    expect(explicitVideoCreativeProfile(first)).toBe("premium");
    expect(inferVideoCreativeProfile([first, scene(2), scene(3), scene(4)])).toBe("premium");
  });

  it("aprova um primeiro corte variado e alerta um storyboard monótono", () => {
    const strong = evaluateVideoFirstCut([scene(1), scene(2), scene(3), scene(4)]);
    expect(strong.score).toBeGreaterThanOrEqual(88);
    expect(strong.status).toBe("strong");

    const weak = evaluateVideoFirstCut([
      scene(1, { headline: "A", visualType: "kinetic_text", imageUrl: null, videoUrl: null, pace: "steady", transition: "fade", caption: "x".repeat(320) }),
      scene(2, { visualType: "kinetic_text", imageUrl: null, videoUrl: null, pace: "steady", transition: "fade" }),
      scene(3, { visualType: "kinetic_text", imageUrl: null, videoUrl: null, pace: "steady", transition: "fade" }),
      scene(4, { headline: "X", visualType: "kinetic_text", imageUrl: null, videoUrl: null, pace: "steady", transition: "fade" }),
      scene(5, { headline: "X", visualType: "kinetic_text", imageUrl: null, videoUrl: null, pace: "steady", transition: "fade" }),
    ]);
    expect(weak.score).toBeLessThan(72);
    expect(weak.status).toBe("needs_attention");
    expect(weak.checks.filter((check) => check.status === "warn").length).toBeGreaterThanOrEqual(4);
  });
});
