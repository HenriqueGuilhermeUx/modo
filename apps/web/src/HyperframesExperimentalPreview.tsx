import { useState } from "react";
import type { VideoProject } from "@modo/contracts/video";
import { getHyperframesHtmlPreview } from "./video-api";

interface Props {
  project: VideoProject;
}

/**
 * Isolated technical pilot. This only downloads an HTML source composition
 * for manual review. No video render, upload, approval, publication or payment.
 */
export default function HyperframesExperimentalPreview({ project }: Props) {
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const supported =
    project.aspectRatio === "9:16" &&
    project.fps === 30 &&
    !project.voiceover &&
    project.scenes.length >= 1 &&
    project.scenes.length <= 8 &&
    project.scenes.every((scene, index, scenes) =>
      scene.visualType === "kinetic_text" &&
      scene.assetSource === "native" &&
      scene.motion === "static" &&
      (scene.transition === "cut" || !scene.transition) &&
      !scene.imageUrl && !scene.videoUrl &&
      scene.headline.length <= 180 && scene.caption.length <= 280 &&
      scene.startFrame === (index ? scenes[index - 1].endFrame : 0) &&
      scene.endFrame > scene.startFrame &&
      scene.endFrame - scene.startFrame >= 30 &&
      scene.endFrame - scene.startFrame <= 360
    );

  async function exportPreview() {
    if (working || !supported) return;
    setWorking(true);
    setError("");
    setMessage("");
    try {
      const preview = await getHyperframesHtmlPreview(project.id);
      if (preview.organizationId !== project.organizationId) {
        throw new Error("A organização do projeto e da prévia não coincidem.");
      }
      const blob = new Blob([preview.html], { type: "text/html;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      try {
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = `modo-hyperframes-preview-${project.id}.html`;
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
      } finally {
        window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      }
      setMessage(`Composição de ${preview.durationSeconds}s exportada para avaliação técnica.`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Falha ao exportar prévia experimental.");
    } finally {
      setWorking(false);
    }
  }

  return (
    <section className="video-hyperframes-experimental" aria-label="Piloto HyperFrames">
      <div className="video-hyperframes-experimental-header">
        <div>
          <small>LAB EXPERIMENTAL · HYPERFRAMES</small>
          <h3>Exportar composição HTML para teste</h3>
          <p>Somente projetos compatíveis com tipografia estática. Não renderiza nem publica vídeo.</p>
        </div>
        <span aria-label="Piloto não publicável">Não publicável</span>
      </div>
      <div className="video-hyperframes-storyboard">
        {project.scenes.map((scene) => (
          <article key={scene.index}>
            <small>Cena {scene.index} · {((scene.endFrame - scene.startFrame) / project.fps).toFixed(1)}s</small>
            <strong>{scene.headline}</strong>
            <p>{scene.caption}</p>
          </article>
        ))}
      </div>
      {!supported && (
        <p role="status" className="video-hyperframes-warning">
          Este vídeo usa recursos ainda não compatíveis com o piloto. O renderizador Remotion permanece inalterado.
        </p>
      )}
      <button type="button" className="button button-secondary"
        disabled={!supported || working} onClick={() => void exportPreview()}>
        {working ? "Preparando composição..." : "Exportar HTML de teste"}
      </button>
      {error && <p role="alert" className="portal-error">{error}</p>}
      {message && <p role="status">{message}</p>}
      <p className="video-hyperframes-disclaimer">
        Arquivo técnico para avaliação isolada. Não contém MP4, direitos de publicação nem autorização de uso de mídia.
      </p>
    </section>
  );
}
