import type { VideoProject } from "@modo/contracts/video";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import VideoFirstCutPanel from "./VideoFirstCutPanel";
import VideoWorkspace from "./VideoWorkspace";
import { getLatestVideoProject, getVideoProject } from "./video-api";
import "./video-v17.css";
import "./video-v18.css";

export default function VideoWorkspaceV18() {
  const contentRequestId = window.location.pathname.split("/").filter(Boolean).pop() || "";
  const [project, setProject] = useState<VideoProject | null>(null);
  const [target, setTarget] = useState<HTMLElement | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    void getLatestVideoProject(contentRequestId).then((value) => {
      if (active) setProject(value);
    }).catch(() => undefined);
    return () => { active = false; };
  }, [contentRequestId]);

  useEffect(() => {
    if (!project || !["queued", "rendering"].includes(project.status)) return;
    const timer = window.setInterval(() => {
      void getVideoProject(project.id).then(setProject).catch(() => undefined);
    }, 2500);
    return () => window.clearInterval(timer);
  }, [project?.id, project?.status]);

  useEffect(() => {
    const attach = () => {
      const layout = document.querySelector(".video-layout");
      if (!layout?.parentElement) return false;
      let root = document.getElementById("modo-video-first-cut-v18-root");
      if (!root) {
        root = document.createElement("div");
        root.id = "modo-video-first-cut-v18-root";
        layout.parentElement.insertBefore(root, layout.nextSibling);
      }
      setTarget(root);
      return true;
    };
    if (attach()) return;
    const timer = window.setInterval(() => {
      if (attach()) window.clearInterval(timer);
    }, 80);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const kicker = document.querySelector<HTMLElement>(".video-hero .section-kicker");
      const title = document.querySelector<HTMLElement>(".video-hero h1");
      const copy = document.querySelector<HTMLElement>(".video-hero p");
      if (kicker) kicker.textContent = "MODO VIDEO · FIRST CUT V1.8";
      if (title) title.textContent = "Do objetivo ao Reel que já nasce editado.";
      if (copy) copy.textContent = "A MODO transforma a estratégia em primeiro corte completo — cenas, imagens e B-roll, narração, trilha, legendas, ritmo e transições. Você só dirige as exceções.";

      const runtimeTitle = document.querySelector<HTMLElement>(".video-runtime-note strong");
      const runtimeCopy = document.querySelector<HTMLElement>(".video-runtime-note p");
      if (runtimeTitle) runtimeTitle.textContent = "V1.8: a MODO entrega o primeiro corte; você intervém onde quiser.";
      if (runtimeCopy) runtimeCopy.textContent = "Direção estética automática, Quality Gate, Media Lab, takes, narração, trilha, ritmo e transições trabalham juntos. Trocar o perfil global não gera nova mídia.";

      const storyboardKicker = document.querySelector<HTMLElement>(".video-storyboard .video-section-heading > small");
      if (storyboardKicker) storyboardKicker.textContent = "STORYBOARD · FIRST CUT V1.8";
    }, 0);
    return () => window.clearTimeout(timer);
  });

  return (
    <>
      <VideoWorkspace />
      {target && project && createPortal(
        <>
          {error && <div className="portal-error">{error}</div>}
          <VideoFirstCutPanel project={project} onProject={setProject} onError={setError} />
          <div className="video-v18-commercial-proof">
            <strong>Você não começa numa timeline vazia.</strong> A MODO produz o primeiro corte e mantém o controle granular: trocar uma cena, usar mídia própria, recuperar um take e aprovar só o que estiver certo.
          </div>
        </>,
        target,
      )}
    </>
  );
}
