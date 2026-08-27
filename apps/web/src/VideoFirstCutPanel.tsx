import type { VideoProject } from "@modo/contracts/video";
import {
  evaluateVideoFirstCut,
  explicitVideoCreativeProfile,
  inferVideoCreativeProfile,
  videoAutoSceneSignature,
  videoCreativeProfileSignature,
  type VideoCreativeProfile,
  type VideoCreativeProfileChoice,
} from "@modo/contracts/video-first-cut";
import { useMemo, useState } from "react";
import { updateVideoScene } from "./video-api";

const profiles: Array<{ id: VideoCreativeProfile; name: string; copy: string }> = [
  { id: "editorial", name: "Editorial", copy: "Clareza, hierarquia e ritmo equilibrado." },
  { id: "premium", name: "Premium", copy: "Mais respiro, contraste e movimento contido." },
  { id: "human", name: "Humano", copy: "Presença, proximidade e leitura mais orgânica." },
  { id: "dynamic", name: "Dinâmico", copy: "Mais energia, escala e entrada de texto." },
];

function statusLabel(status: ReturnType<typeof evaluateVideoFirstCut>["status"]) {
  if (status === "strong") return "Primeiro corte forte";
  if (status === "ready") return "Pronto para revisar";
  return "Pede atenção";
}

export default function VideoFirstCutPanel({
  project,
  onProject,
  onError,
}: {
  project: VideoProject;
  onProject: (project: VideoProject) => void;
  onError: (message: string) => void;
}) {
  const [working, setWorking] = useState(false);
  const quality = useMemo(() => evaluateVideoFirstCut(project.scenes), [project.scenes]);
  const explicit = explicitVideoCreativeProfile(project.scenes[0]);
  const profile = inferVideoCreativeProfile(project.scenes);
  const approved = project.review?.scenes.some((scene) => scene.status === "approved") || project.review?.approvalStatus === "approved";
  const busy = working || ["queued", "rendering"].includes(project.status) || approved;

  async function apply(choice: VideoCreativeProfileChoice) {
    const first = project.scenes[0];
    if (!first || busy) return;
    setWorking(true);
    onError("");
    try {
      const signature = choice === "auto" ? videoAutoSceneSignature(first) : videoCreativeProfileSignature(choice);
      const updated = await updateVideoScene(project.id, first.index, signature);
      onProject(updated);
    } catch (caught) {
      onError(caught instanceof Error ? caught.message : "Não foi possível trocar a direção estética.");
    } finally {
      setWorking(false);
    }
  }

  return (
    <section className="video-v18-first-cut-card">
      <div className="video-v18-first-cut-heading">
        <div>
          <small>FIRST CUT · QUALITY GATE</small>
          <h2>Um Reel que já nasce editado.</h2>
          <p>A MODO escolhe uma linguagem visual para o vídeo inteiro. Você pode manter a direção automática ou trocar o tratamento antes de começar as aprovações.</p>
        </div>
        <div className={`video-v18-score ${quality.status}`}>
          <strong>{quality.score}</strong><span>/100</span><small>{statusLabel(quality.status)}</small>
        </div>
      </div>

      <div className="video-v18-profile-summary">
        <span>Direção atual</span>
        <strong>{profiles.find((item) => item.id === profile)?.name || "Editorial"}</strong>
        <small>{explicit ? "Escolha manual aplicada sem regenerar mídia." : "Escolhida automaticamente pela MODO a partir do conteúdo e das cenas."}</small>
      </div>

      <div className="video-v18-profile-grid">
        <button className={!explicit ? "selected" : ""} disabled={busy} onClick={() => void apply("auto")}>
          <strong>MODO decide</strong><span>Direção automática</span>
        </button>
        {profiles.map((item) => (
          <button key={item.id} className={explicit === item.id ? "selected" : ""} disabled={busy} onClick={() => void apply(item.id)}>
            <strong>{item.name}</strong><span>{item.copy}</span>
          </button>
        ))}
      </div>

      {approved && <div className="video-v18-lock-note"><strong>Direção protegida após aprovação.</strong><span>Para preservar o que já foi aprovado, o estilo global fica travado. Ajustes continuam disponíveis cena por cena.</span></div>}
      {!approved && <div className="video-v18-no-provider-note">Trocar o perfil altera composição, tipografia, overlay e energia do corte. <strong>Não gera nova imagem nem baixa outro B-roll.</strong></div>}

      <div className="video-v18-checks">
        {quality.checks.map((check) => (
          <div key={check.key} className={check.status}>
            <span>{check.status === "pass" ? "✓" : "!"}</span>
            <div><strong>{check.label}</strong><small>{check.detail}</small></div>
          </div>
        ))}
      </div>
      <p className="video-v18-quality-summary">{quality.summary}</p>
    </section>
  );
}
