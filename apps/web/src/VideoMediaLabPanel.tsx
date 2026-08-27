import type { VideoProject, VideoScene } from "@modo/contracts/video";
import { useEffect, useMemo, useState } from "react";
import { updateVideoSceneMedia, uploadVideoSceneMedia } from "./video-api";
import "./video-v17.css";

type MediaState = {
  focalX: number;
  focalY: number;
  zoom: number;
  trimStartSeconds: number;
  durationSeconds: number | null;
};

function numberParam(url: URL, key: string, fallback: number) {
  const value = Number(url.searchParams.get(key));
  return Number.isFinite(value) ? value : fallback;
}

export function readSceneMediaState(scene: Pick<VideoScene, "imageUrl" | "videoUrl">): MediaState {
  const source = scene.videoUrl || scene.imageUrl;
  if (!source) return { focalX: 50, focalY: 50, zoom: 1, trimStartSeconds: 0, durationSeconds: null };
  try {
    const url = new URL(source);
    const duration = numberParam(url, "mldur", Number.NaN);
    return {
      focalX: Math.min(100, Math.max(0, numberParam(url, "mlfx", 50))),
      focalY: Math.min(100, Math.max(0, numberParam(url, "mlfy", 50))),
      zoom: Math.min(2.5, Math.max(1, numberParam(url, "mlz", 1))),
      trimStartSeconds: Math.min(120, Math.max(0, numberParam(url, "mltrim", 0))),
      durationSeconds: Number.isFinite(duration) && duration > 0 ? duration : null,
    };
  } catch {
    return { focalX: 50, focalY: 50, zoom: 1, trimStartSeconds: 0, durationSeconds: null };
  }
}

function fileToBase64(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Não foi possível ler este arquivo."));
    reader.onload = () => {
      const value = String(reader.result || "");
      const comma = value.indexOf(",");
      if (comma < 0) reject(new Error("Não foi possível preparar este arquivo."));
      else resolve(value.slice(comma + 1));
    };
    reader.readAsDataURL(file);
  });
}

function videoDuration(file: File) {
  return new Promise<number>((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement("video");
    video.preload = "metadata";
    video.onloadedmetadata = () => {
      const duration = video.duration;
      URL.revokeObjectURL(url);
      if (!Number.isFinite(duration) || duration <= 0) reject(new Error("Não foi possível identificar a duração do MP4."));
      else resolve(duration);
    };
    video.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Este MP4 não pôde ser aberto pelo navegador."));
    };
    video.src = url;
  });
}

function formatMb(bytes: number) {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

interface Props {
  projectId: string;
  scene: VideoScene;
  disabled?: boolean;
  onProject: (project: VideoProject) => void;
  onError: (message: string) => void;
}

export default function VideoMediaLabPanel({ projectId, scene, disabled, onProject, onError }: Props) {
  const initial = useMemo(() => readSceneMediaState(scene), [scene.imageUrl, scene.videoUrl]);
  const [open, setOpen] = useState(false);
  const [focalX, setFocalX] = useState(initial.focalX);
  const [focalY, setFocalY] = useState(initial.focalY);
  const [zoom, setZoom] = useState(initial.zoom);
  const [trimStartSeconds, setTrimStartSeconds] = useState(initial.trimStartSeconds);
  const [file, setFile] = useState<File | null>(null);
  const [working, setWorking] = useState(false);

  useEffect(() => {
    setFocalX(initial.focalX);
    setFocalY(initial.focalY);
    setZoom(initial.zoom);
    setTrimStartSeconds(initial.trimStartSeconds);
  }, [initial.focalX, initial.focalY, initial.zoom, initial.trimStartSeconds]);

  const source = scene.videoUrl || scene.imageUrl;
  const sceneSeconds = Math.max(1 / 30, (scene.endFrame - scene.startFrame) / 30);
  const maxTrim = scene.videoUrl && initial.durationSeconds
    ? Math.max(0, initial.durationSeconds - sceneSeconds)
    : 0;
  const previewStyle = {
    objectPosition: `${focalX}% ${focalY}%`,
    transform: `scale(${zoom})`,
    transformOrigin: `${focalX}% ${focalY}%`,
  };

  async function upload() {
    if (!file) return;
    setWorking(true);
    onError("");
    try {
      const allowed = ["image/png", "image/jpeg", "image/webp", "video/mp4"];
      if (!allowed.includes(file.type)) throw new Error("Use PNG, JPEG, WebP ou MP4.");
      const isVideo = file.type === "video/mp4";
      const maxBytes = isVideo ? 24 * 1024 * 1024 : 12 * 1024 * 1024;
      if (file.size > maxBytes) {
        throw new Error(isVideo ? "O MP4 deve ter no máximo 24 MB." : "A imagem deve ter no máximo 12 MB.");
      }
      const durationSeconds = isVideo ? await videoDuration(file) : null;
      if (durationSeconds && durationSeconds + 0.05 < sceneSeconds) {
        throw new Error(`Este MP4 tem ${durationSeconds.toFixed(1)}s, mas a cena precisa de ${sceneSeconds.toFixed(1)}s.`);
      }
      const dataBase64 = await fileToBase64(file);
      const project = await uploadVideoSceneMedia(projectId, scene.index, {
        fileName: file.name,
        mimeType: file.type as "image/png" | "image/jpeg" | "image/webp" | "video/mp4",
        dataBase64,
        durationSeconds,
      });
      onProject(project);
      setFile(null);
      setOpen(false);
    } catch (caught) {
      onError(caught instanceof Error ? caught.message : "Não foi possível enviar esta mídia.");
    } finally {
      setWorking(false);
    }
  }

  async function applyFraming() {
    if (!source) return;
    setWorking(true);
    onError("");
    try {
      const project = await updateVideoSceneMedia(projectId, scene.index, {
        focalX,
        focalY,
        zoom,
        ...(scene.videoUrl && initial.durationSeconds ? { trimStartSeconds } : {}),
      });
      onProject(project);
      setOpen(false);
    } catch (caught) {
      onError(caught instanceof Error ? caught.message : "Não foi possível aplicar o enquadramento.");
    } finally {
      setWorking(false);
    }
  }

  return (
    <div className={`video-v17-media-lab ${open ? "open" : ""}`}>
      <button className="button button-outline video-v17-media-button" disabled={disabled || working} onClick={() => setOpen((value) => !value)}>
        {open ? "Fechar Media Lab" : "Mídia própria / enquadrar"}
      </button>

      {open && (
        <div className="video-v17-media-panel">
          <div className="video-v17-media-heading">
            <div><strong>Media Lab da cena {String(scene.index).padStart(2, "0")}</strong><small>Troque a matéria-prima ou ajuste só a janela de exibição.</small></div>
            {scene.assetSource === "upload" && <span>Mídia própria</span>}
          </div>

          {source && (
            <div className="video-v17-framing-preview">
              {scene.videoUrl
                ? <video src={scene.videoUrl} muted playsInline preload="metadata" style={previewStyle} />
                : <img src={scene.imageUrl || ""} alt="" style={previewStyle} />}
              <div className="video-v17-safe-frame"><i /></div>
            </div>
          )}

          <div className="video-v17-upload-row">
            <label className="video-v17-file-picker">
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp,video/mp4"
                disabled={working}
                onChange={(event) => setFile(event.target.files?.[0] || null)}
              />
              <span>{file ? file.name : "Escolher imagem ou MP4"}</span>
              <small>{file ? formatMb(file.size) : "PNG/JPEG/WebP até 12 MB · MP4 até 24 MB"}</small>
            </label>
            <button className="button button-primary" disabled={!file || working} onClick={() => void upload()}>{working ? "Enviando..." : "Usar nesta cena"}</button>
          </div>

          {source && (
            <div className="video-v17-framing-controls">
              <label><span>Foco horizontal <b>{Math.round(focalX)}%</b></span><input type="range" min="0" max="100" step="1" value={focalX} disabled={working} onChange={(event) => setFocalX(Number(event.target.value))} /></label>
              <label><span>Foco vertical <b>{Math.round(focalY)}%</b></span><input type="range" min="0" max="100" step="1" value={focalY} disabled={working} onChange={(event) => setFocalY(Number(event.target.value))} /></label>
              <label><span>Zoom <b>{zoom.toFixed(2)}×</b></span><input type="range" min="1" max="2.5" step="0.05" value={zoom} disabled={working} onChange={(event) => setZoom(Number(event.target.value))} /></label>
              {scene.videoUrl && initial.durationSeconds ? (
                <label><span>Início do take <b>{trimStartSeconds.toFixed(1)}s</b></span><input type="range" min="0" max={Math.max(0, maxTrim)} step="0.1" value={Math.min(trimStartSeconds, maxTrim)} disabled={working || maxTrim <= 0} onChange={(event) => setTrimStartSeconds(Number(event.target.value))} /><small>O Media Lab impede cortar além do tempo necessário para preencher a cena.</small></label>
              ) : scene.videoUrl ? (
                <div className="video-v17-trim-note">Trim fica disponível para MP4 enviado pelo Media Lab, cuja duração é conhecida.</div>
              ) : null}
            </div>
          )}

          {source && (
            <div className="video-v17-media-actions">
              <button className="button button-primary" disabled={working} onClick={() => void applyFraming()}>{working ? "Renderizando..." : "Aplicar enquadramento"}</button>
              <button className="button button-outline" disabled={working} onClick={() => { setFocalX(50); setFocalY(50); setZoom(1); setTrimStartSeconds(0); }}>Centralizar</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
