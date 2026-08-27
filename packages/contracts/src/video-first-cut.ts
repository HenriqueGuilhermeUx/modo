import type { VideoScene, VideoSceneMotion, VideoScenePace, VideoSceneTransition } from "./video.js";

export type VideoCreativeProfile = "editorial" | "premium" | "human" | "dynamic";
export type VideoCreativeProfileChoice = "auto" | VideoCreativeProfile;
export type VideoFirstCutCheckStatus = "pass" | "warn";

export type VideoFirstCutCheck = {
  key: "hook" | "visual_diversity" | "visual_coverage" | "cta" | "text_density" | "rhythm" | "transitions";
  label: string;
  status: VideoFirstCutCheckStatus;
  detail: string;
};

export type VideoFirstCutQuality = {
  score: number;
  status: "strong" | "ready" | "needs_attention";
  summary: string;
  checks: VideoFirstCutCheck[];
};

const overrideSignatures: Record<VideoCreativeProfile, {
  motion: VideoSceneMotion;
  pace: VideoScenePace;
  transition: VideoSceneTransition;
}> = {
  editorial: { motion: "static", pace: "steady", transition: "wipe" },
  premium: { motion: "zoom_out", pace: "calm", transition: "zoom" },
  human: { motion: "pan_right", pace: "calm", transition: "slide" },
  dynamic: { motion: "push_in", pace: "dynamic", transition: "fade" },
};

export function videoCreativeProfileSignature(profile: VideoCreativeProfile) {
  return overrideSignatures[profile];
}

export function videoAutoSceneSignature(scene: Pick<VideoScene, "visualType">) {
  const pace: VideoScenePace = scene.visualType === "broll_video" || scene.visualType === "kinetic_text"
    ? "dynamic"
    : scene.visualType === "interface" || scene.visualType === "data_card"
      ? "calm"
      : "steady";
  return { motion: "push_in" as const, pace, transition: "cut" as const };
}

export function explicitVideoCreativeProfile(scene?: Pick<VideoScene, "motion" | "pace" | "transition"> | null): VideoCreativeProfile | null {
  if (!scene) return null;
  for (const [profile, signature] of Object.entries(overrideSignatures) as Array<[VideoCreativeProfile, typeof overrideSignatures[VideoCreativeProfile]]>) {
    if (scene.motion === signature.motion && scene.pace === signature.pace && scene.transition === signature.transition) return profile;
  }
  return null;
}

export function inferVideoCreativeProfile(scenes: VideoScene[]): VideoCreativeProfile {
  const explicit = explicitVideoCreativeProfile(scenes[0]);
  if (explicit) return explicit;
  const corpus = scenes.map((scene) => `${scene.headline} ${scene.visual} ${scene.caption}`).join(" ").toLocaleLowerCase("pt-BR");
  const broll = scenes.filter((scene) => scene.visualType === "broll_video").length;
  const kinetic = scenes.filter((scene) => scene.visualType === "kinetic_text").length;
  if (/(premium|sofisticad|exclusiv|luxo|alto padr[aã]o|arquitet|est[eé]tica|elegan)/i.test(corpus)) return "premium";
  if (broll >= Math.max(2, Math.ceil(scenes.length / 3)) || /(pessoa|cliente|equipe|fam[ií]lia|bastidor|atendimento|profissional)/i.test(corpus)) return "human";
  if (kinetic >= Math.max(2, Math.ceil(scenes.length / 2)) || /(lan[cç]amento|oferta|promo[cç][aã]o|agora|r[aá]pid|novidade|urgente|desafio)/i.test(corpus)) return "dynamic";
  return "editorial";
}

function qualityStatus(score: number): VideoFirstCutQuality["status"] {
  if (score >= 88) return "strong";
  if (score >= 72) return "ready";
  return "needs_attention";
}

export function evaluateVideoFirstCut(scenes: VideoScene[]): VideoFirstCutQuality {
  if (!scenes.length) {
    return {
      score: 0,
      status: "needs_attention",
      summary: "O primeiro corte ainda não possui cenas suficientes para avaliação.",
      checks: [],
    };
  }

  let score = 100;
  const checks: VideoFirstCutCheck[] = [];
  const hookLength = scenes[0].headline.trim().length;
  const hookOk = hookLength >= 8 && hookLength <= 110;
  if (!hookOk) score -= 14;
  checks.push({ key: "hook", label: "Gancho", status: hookOk ? "pass" : "warn", detail: hookOk ? "A abertura é curta o suficiente para leitura móvel." : "Encurte ou fortaleça a headline da primeira cena." });

  const uniqueVisuals = new Set(scenes.map((scene) => scene.visualType)).size;
  const diversityOk = scenes.length < 3 || uniqueVisuals >= 2;
  if (!diversityOk) score -= 13;
  checks.push({ key: "visual_diversity", label: "Variedade visual", status: diversityOk ? "pass" : "warn", detail: diversityOk ? `${uniqueVisuals} tratamentos visuais evitam repetição.` : "O vídeo repete o mesmo tratamento visual em todas as cenas." });

  const richVisuals = scenes.filter((scene) => Boolean(scene.imageUrl || scene.videoUrl) || ["interface", "data_card"].includes(scene.visualType)).length;
  const coverageOk = richVisuals >= Math.max(1, Math.floor(scenes.length / 2));
  if (!coverageOk) score -= 12;
  checks.push({ key: "visual_coverage", label: "Cobertura visual", status: coverageOk ? "pass" : "warn", detail: coverageOk ? `${richVisuals}/${scenes.length} cenas têm matéria visual rica ou composição estruturada.` : "Inclua imagem, B-roll, interface ou data card em mais cenas." });

  const last = scenes[scenes.length - 1];
  const ctaLength = last.headline.trim().length;
  const ctaOk = ctaLength >= 4 && ctaLength <= 120;
  if (!ctaOk) score -= 12;
  checks.push({ key: "cta", label: "Fechamento", status: ctaOk ? "pass" : "warn", detail: ctaOk ? "A última cena termina com uma chamada legível." : "A chamada final precisa ficar mais clara e direta." });

  const denseScenes = scenes.filter((scene) => scene.caption.length > 260 || scene.headline.length > 130).length;
  const densityOk = denseScenes === 0;
  if (!densityOk) score -= Math.min(16, denseScenes * 6);
  checks.push({ key: "text_density", label: "Densidade de texto", status: densityOk ? "pass" : "warn", detail: densityOk ? "As cenas cabem em leitura e locução de vídeo curto." : `${denseScenes} cena(s) estão densas para consumo móvel.` });

  const paces = new Set(scenes.map((scene) => scene.pace || "steady"));
  const rhythmOk = scenes.length < 4 || paces.size >= 2;
  if (!rhythmOk) score -= 9;
  checks.push({ key: "rhythm", label: "Ritmo", status: rhythmOk ? "pass" : "warn", detail: rhythmOk ? "O corte alterna energia sem perder coerência." : "Varie o ritmo de ao menos uma cena para evitar monotonia." });

  const transitions = new Set(scenes.slice(1).map((scene) => scene.transition || "fade"));
  const transitionsOk = scenes.length < 5 || transitions.size >= 2;
  if (!transitionsOk) score -= 8;
  checks.push({ key: "transitions", label: "Transições", status: transitionsOk ? "pass" : "warn", detail: transitionsOk ? "As passagens entre cenas têm variação controlada." : "As transições estão repetitivas para este número de cenas." });

  score = Math.max(0, Math.min(100, Math.round(score)));
  const status = qualityStatus(score);
  return {
    score,
    status,
    summary: status === "strong"
      ? "Primeiro corte forte: pronto para revisão humana, sem reconstruir o vídeo."
      : status === "ready"
        ? "Primeiro corte utilizável: revise os avisos antes da aprovação final."
        : "O corte precisa de alguns ajustes antes de ser tratado como pronto.",
    checks,
  };
}
