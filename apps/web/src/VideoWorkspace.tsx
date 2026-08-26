import type { Dashboard } from "@modo/contracts";
import type { ContentRequest } from "@modo/contracts/content";
import type { VideoDurationSeconds, VideoProject, VideoSceneVisualType } from "@modo/contracts/video";
import { useEffect, useMemo, useState } from "react";
import { getContentRequest, getDashboard, getSessionToken } from "./api";
import NativePublisherApprovalAction from "./NativePublisherApprovalAction";
import {
  approveVideoProject,
  approveVideoScene,
  cancelVideoProject,
  createVideoProject,
  getLatestVideoProject,
  getVideoProject,
  regenerateVideoScene,
  retryVideoProject,
} from "./video-api";
import "./video-v13.css";
import "./video-v14.css";

const durations: VideoDurationSeconds[] = [15, 30, 45];

function statusCopy(status: VideoProject["status"]) {
  if (status === "queued") return "Na fila de render";
  if (status === "rendering") return "Montando o vídeo";
  if (status === "ready") return "Vídeo pronto";
  if (status === "failed") return "Render interrompido";
  return "Render cancelado";
}

function seconds(frame: number) {
  return `${(frame / 30).toFixed(frame % 30 === 0 ? 0 : 1)}s`;
}

function visualLabel(type: VideoSceneVisualType) {
  if (type === "brand_asset") return "Asset da marca";
  if (type === "generated_image") return "Imagem editorial";
  if (type === "interface") return "Interface nativa";
  if (type === "data_card") return "Data card";
  return "Kinetic text";
}

export default function VideoWorkspace() {
  const contentRequestId = window.location.pathname.split("/").filter(Boolean).pop() || "";
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [request, setRequest] = useState<ContentRequest | null>(null);
  const [project, setProject] = useState<VideoProject | null>(null);
  const [duration, setDuration] = useState<VideoDurationSeconds>(30);
  const [captions, setCaptions] = useState(true);
  const [voiceover, setVoiceover] = useState(false);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [workingScene, setWorkingScene] = useState<number | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!getSessionToken()) {
      window.location.href = "/app";
      return;
    }
    Promise.all([
      getDashboard(),
      getContentRequest(contentRequestId),
      getLatestVideoProject(contentRequestId),
    ])
      .then(([currentDashboard, currentRequest, currentProject]) => {
        setDashboard(currentDashboard);
        setRequest(currentRequest);
        setProject(currentProject);
        if (currentProject) {
          setDuration(currentProject.durationSeconds);
          setCaptions(currentProject.captions);
          setVoiceover(currentProject.voiceover);
        }
      })
      .catch((caught) => setError(caught instanceof Error ? caught.message : "Não foi possível abrir o MODO Video."))
      .finally(() => setLoading(false));
  }, [contentRequestId]);

  useEffect(() => {
    if (!project || !["queued", "rendering"].includes(project.status)) return;
    const timer = window.setInterval(() => {
      void getVideoProject(project.id)
        .then(setProject)
        .catch(() => undefined);
    }, 2500);
    return () => window.clearInterval(timer);
  }, [project?.id, project?.status]);

  const brand = useMemo(
    () => dashboard?.brands.find((item) => item.id === request?.brandId),
    [dashboard, request],
  );

  const sourceScenes = request?.output?.script || [];
  const valid = request?.contentType === "short_video_script" && sourceScenes.length > 0;
  const approvedSceneCount = project?.review?.scenes.filter((item) => item.status === "approved").length || 0;
  const allScenesApproved = Boolean(project && project.scenes.length > 0 && approvedSceneCount === project.scenes.length);
  const finalVideoApproved = project?.review?.approvalStatus === "approved";

  async function generate() {
    if (!request) return;
    setWorking(true);
    setError("");
    try {
      const created = await createVideoProject({
        contentRequestId: request.id,
        durationSeconds: duration,
        captions,
        voiceover,
      });
      setProject(created);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Não foi possível iniciar o render.");
    } finally {
      setWorking(false);
    }
  }

  async function regenerateScene(sceneIndex: number) {
    if (!project) return;
    setWorkingScene(sceneIndex);
    setError("");
    try {
      setProject(await regenerateVideoScene(project.id, sceneIndex));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Não foi possível regenerar esta cena.");
    } finally {
      setWorkingScene(null);
    }
  }

  async function approveScene(sceneIndex: number) {
    if (!project) return;
    setWorkingScene(sceneIndex);
    setError("");
    try {
      setProject(await approveVideoScene(project.id, sceneIndex));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Não foi possível aprovar esta cena.");
    } finally {
      setWorkingScene(null);
    }
  }

  async function approveFinalVideo() {
    if (!project) return;
    setWorking(true);
    setError("");
    try {
      setProject(await approveVideoProject(project.id));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Não foi possível aprovar o vídeo final.");
    } finally {
      setWorking(false);
    }
  }

  async function retry() {
    if (!project) return;
    setWorking(true);
    setError("");
    try {
      setProject(await retryVideoProject(project.id));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Não foi possível tentar novamente.");
    } finally {
      setWorking(false);
    }
  }

  async function cancel() {
    if (!project) return;
    setWorking(true);
    try {
      setProject(await cancelVideoProject(project.id));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Não foi possível cancelar o render.");
    } finally {
      setWorking(false);
    }
  }

  if (loading) {
    return <main className="portal-loading"><img src="/logo.svg" alt="MODO" /><div className="portal-spinner" /><p>Preparando seu vídeo...</p></main>;
  }

  if (!dashboard || !request) {
    return <main className="portal-loading"><p>{error || "Conteúdo não encontrado."}</p><a className="button button-primary" href="/app/content">Voltar para criar</a></main>;
  }

  if (!valid) {
    return (
      <main className="video-empty-shell">
        <a href="/app/content"><img src="/logo.svg" alt="MODO" /></a>
        <section>
          <small>MODO VIDEO</small>
          <h1>Primeiro, precisamos de um roteiro de vídeo.</h1>
          <p>O compositor não cria um segundo conteúdo por conta própria. Gere um <strong>Vídeo curto</strong> na MODO para que o Director, a memória da marca e o Quality Gate definam a mensagem antes da montagem.</p>
          <a className="button button-primary" href="/app/content">Criar roteiro de vídeo</a>
        </section>
      </main>
    );
  }

  const storyboardScenes = project?.scenes || sourceScenes.slice(0, duration === 15 ? 3 : duration === 30 ? 5 : 6).map((scene, index, list) => {
    const totalFrames = duration * 30;
    const chunk = Math.floor(totalFrames / list.length);
    const imageUrl = index === 0 ? request.output!.imageUrl : null;
    return {
      index: index + 1,
      startFrame: index * chunk,
      endFrame: index === list.length - 1 ? totalFrames : (index + 1) * chunk,
      headline: index === 0 ? request.output!.hook : index === list.length - 1 ? request.output!.cta : scene.scene,
      visual: scene.visual,
      caption: scene.voiceover,
      imageUrl,
      visualType: (imageUrl ? "brand_asset" : index === list.length - 1 ? "kinetic_text" : "generated_image") as VideoSceneVisualType,
      motion: "push_in" as const,
      assetSource: imageUrl ? "content" as const : "native" as const,
      assetRevision: 0,
      visualPrompt: scene.visual,
    };
  });

  return (
    <div className="video-workspace">
      <header className="workspace-header">
        <a href="/app"><img src="/logo.svg" alt="MODO" /></a>
        <nav><a href="/app">Painel</a><a href="/app/director">Director</a><a href="/app/content">Criar</a><a className="active" href={`/app/video/${request.id}`}>Vídeo</a><a href="/app/publisher">Publisher</a></nav>
        <div className="workspace-balance"><small>Marca</small><strong>{brand?.name || "MODO"}</strong><span>9:16 · MP4</span></div>
      </header>

      <main className="video-main">
        <section className="video-hero">
          <div>
            <div className="section-kicker">MODO VIDEO · COMPOSER V1.4</div>
            <h1>Direção por cena. Aprovação sem refazer o que já está bom.</h1>
            <p>Revise o MP4 cena por cena. Aprove o que funcionou, regenere somente o visual que precisa mudar e libere o vídeo final quando todas as cenas estiverem certas.</p>
          </div>
          <div className="video-hero-meta">
            <span>{finalVideoApproved ? "Vídeo aprovado" : request.status === "approved" ? "Conteúdo aprovado" : "Pronto para revisão"}</span>
            <strong>{request.output?.title}</strong>
          </div>
        </section>

        {error && <div className="portal-error">{error}</div>}

        <div className="video-layout">
          <section className="video-controls-card">
            <div className="video-section-heading"><small>FORMATO</small><h2>Escolhas essenciais</h2><p>Só o necessário para publicar. A direção criativa continua vindo da MODO.</p></div>

            <div className="video-duration-grid">
              {durations.map((item) => (
                <button key={item} className={duration === item ? "selected" : ""} disabled={Boolean(project && ["queued", "rendering"].includes(project.status))} onClick={() => setDuration(item)}>
                  <strong>{item}s</strong><span>{item === 15 ? "Direto" : item === 30 ? "Equilibrado" : "Mais contexto"}</span>
                </button>
              ))}
            </div>

            <label className="video-toggle">
              <input type="checkbox" checked={captions} disabled={Boolean(project && ["queued", "rendering"].includes(project.status))} onChange={(event) => setCaptions(event.target.checked)} />
              <span><strong>Legendas no vídeo</strong><small>Usa a locução já escrita em cada cena do roteiro.</small></span>
            </label>

            <label className="video-toggle">
              <input type="checkbox" checked={voiceover} disabled={Boolean(project && ["queued", "rendering"].includes(project.status))} onChange={(event) => setVoiceover(event.target.checked)} />
              <span><strong>Narração PT-BR</strong><small>Gera voz por IA para cada cena, sincronizada com a legenda e a duração daquela cena.</small></span>
            </label>

            {!project || ["cancelled"].includes(project.status) ? (
              <button className="button button-primary button-full" disabled={working} onClick={() => void generate()}>{working ? "Preparando..." : "Gerar vídeo"}</button>
            ) : project.status === "failed" ? (
              <button className="button button-primary button-full" disabled={working} onClick={() => void retry()}>{working ? "Reiniciando..." : "Tentar render novamente"}</button>
            ) : ["queued"].includes(project.status) ? (
              <button className="button button-outline button-full" disabled={working} onClick={() => void cancel()}>Cancelar fila</button>
            ) : null}

            <div className="video-runtime-note"><strong>Review granular, sem retrabalho.</strong><p>Aprovação fica separada do renderer. Trocar uma cena preserva as demais aprovações, os assets já bons e a locução cacheada.</p></div>
          </section>

          <section className="video-preview-card">
            <div className="video-section-heading"><small>PREVIEW</small><h2>{project ? statusCopy(project.status) : "Storyboard pronto"}</h2></div>

            {project?.status === "ready" && project.outputUrl ? (
              <div className="video-ready-preview">
                <video src={project.outputUrl} controls playsInline preload="metadata" />
                <div className="video-ready-actions">
                  <a className="button button-primary" href={project.outputUrl} target="_blank" rel="noreferrer">Abrir MP4</a>
                  <a className="button button-outline" href="#video-storyboard-review">Revisar cenas</a>
                </div>
                {project.voiceover && <small>Narração por IA incluída · sincronizada e cacheada por cena · provider {project.voiceProvider || "gerenciado"}</small>}
                {project.visualProvider && <small>Direção visual híbrida · imagens geradas por {project.visualProvider}</small>}
              </div>
            ) : project && ["queued", "rendering"].includes(project.status) ? (
              <div className="video-rendering-state">
                <div className="video-render-orbit"><span /><i /></div>
                <strong>{project.status === "queued" ? "Aguardando o renderer" : project.voiceover ? "Montando cenas e reaproveitando a locução" : "Montando direção visual, tipografia e legendas"}</strong>
                <p>O processamento continua no servidor. Esta tela atualiza automaticamente.</p>
              </div>
            ) : project?.status === "failed" ? (
              <div className="video-failed-state"><strong>O render não terminou.</strong><p>{project.error || "O compositor encontrou um erro inesperado."}</p></div>
            ) : (
              <div className="video-phone-mockup">
                {request.output?.imageUrl && <img src={request.output.imageUrl} alt={request.output.imageAlt || request.output.title} />}
                <div className="video-phone-shade" />
                <div className="video-phone-brand"><i /><span>{brand?.name || "MODO"}</span></div>
                <div className="video-phone-copy"><strong>{request.output?.hook}</strong><p>{sourceScenes[0]?.voiceover}</p></div>
                <div className="video-phone-progress"><i /></div>
              </div>
            )}
          </section>
        </div>

        {project?.status === "ready" && project.outputUrl && (
          <section className={`video-review-card ${finalVideoApproved ? "approved" : ""}`}>
            <div className="video-section-heading">
              <small>APROVAÇÃO DO VÍDEO</small>
              <h2>{finalVideoApproved ? "Vídeo final aprovado." : "Feche o vídeo cena por cena."}</h2>
              <p>{finalVideoApproved ? "Este MP4 está liberado para distribuição. Se você regenerar qualquer cena, só aquela revisão será reaberta." : "Aprovar uma cena preserva essa decisão. Regenerar um visual reabre somente a cena alterada."}</p>
            </div>
            {finalVideoApproved ? (
              <div className="video-final-approved"><span>✓</span><div><strong>Review concluído</strong><small>{project.review?.approvedAt ? `Aprovado em ${new Date(project.review.approvedAt).toLocaleString("pt-BR")}.` : "Todas as cenas e o MP4 final foram aprovados."}</small></div></div>
            ) : (
              <>
                <div className="video-review-progress">
                  <div><span style={{ width: `${project.scenes.length ? (approvedSceneCount / project.scenes.length) * 100 : 0}%` }} /></div>
                  <strong>{approvedSceneCount}/{project.scenes.length} cenas aprovadas</strong>
                </div>
                <div className="video-review-actions">
                  <a className="button button-outline" href="#video-storyboard-review">Revisar storyboard</a>
                  <button className="button button-primary" disabled={!allScenesApproved || working} onClick={() => void approveFinalVideo()}>{working ? "Aprovando..." : allScenesApproved ? "Aprovar vídeo final" : "Aprove todas as cenas"}</button>
                </div>
              </>
            )}
          </section>
        )}

        {project?.status === "ready" && project.outputUrl && request.status === "approved" && finalVideoApproved && (
          <section className="video-publisher-card">
            <div className="video-section-heading">
              <small>DISTRIBUIÇÃO</small>
              <h2>MP4 aprovado. Publique sem sair do fluxo.</h2>
              <p>O Publisher V2 recebe o projeto revisado, persiste a mídia da publicação e usa o mesmo MP4 em publicação imediata, agendamento e retry.</p>
            </div>
            <NativePublisherApprovalAction request={request} videoProjectId={project.id} />
          </section>
        )}

        {project?.status === "ready" && project.outputUrl && finalVideoApproved && request.status !== "approved" && (
          <section className="video-publisher-card">
            <div className="video-section-heading">
              <small>APROVAÇÃO DO CONTEÚDO</small>
              <h2>O vídeo está aprovado; falta aprovar a peça estratégica.</h2>
              <p>A publicação continua humana por decisão. Aprove o conteúdo e volte aqui para publicar agora ou agendar o MP4.</p>
              <a className="button button-primary" href="/app/content">Revisar e aprovar conteúdo</a>
            </div>
          </section>
        )}

        <section className="video-storyboard" id="video-storyboard-review">
          <div className="video-section-heading"><small>STORYBOARD · REVIEW GRANULAR</small><h2>{project ? `${project.scenes.length} cenas · ${project.durationSeconds}s` : `${storyboardScenes.length} cenas planejadas`}</h2><p>Aprove o que está certo. Se uma cena não ficou boa, troque só o visual dela — roteiro, locução, assets e aprovações das outras cenas permanecem intactos.</p></div>
          <div className="video-scene-list video-scene-list-rich">
            {storyboardScenes.map((scene) => {
              const sceneReview = project?.review?.scenes.find((item) => item.sceneIndex === scene.index);
              const sceneApproved = sceneReview?.status === "approved";
              return (
                <article key={scene.index}>
                  <div className="video-scene-number"><strong>{String(scene.index).padStart(2, "0")}</strong><span>{seconds(scene.startFrame)}—{seconds(scene.endFrame)}</span></div>
                  {scene.imageUrl && <img className="video-scene-thumb" src={scene.imageUrl} alt="" />}
                  <div className="video-scene-copy">
                    <div className="video-scene-tags"><span>{visualLabel(scene.visualType)}</span><span>{scene.motion.replaceAll("_", " ")}</span>{scene.assetRevision > 0 && <span>variação {scene.assetRevision + 1}</span>}</div>
                    <h3>{scene.headline}</h3>
                    <p><b>Direção:</b> {scene.visual}</p>
                    <p><b>Locução:</b> {scene.caption}</p>
                    {project?.status === "ready" && (
                      <div className="video-scene-review">
                        <span className={`video-scene-review-badge ${sceneApproved ? "approved" : ""}`}>{sceneApproved ? "✓ Cena aprovada" : "Aguardando aprovação"}</span>
                        {!sceneApproved && (
                          <button className="button button-outline video-scene-approve" disabled={workingScene !== null} onClick={() => void approveScene(scene.index)}>
                            {workingScene === scene.index ? "Salvando..." : "Aprovar cena"}
                          </button>
                        )}
                        <button className="button button-outline video-scene-regenerate" disabled={workingScene !== null} onClick={() => void regenerateScene(scene.index)}>
                          {workingScene === scene.index ? "Processando..." : sceneApproved ? "Trocar visual e reabrir cena" : "Regenerar só este visual"}
                        </button>
                      </div>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      </main>
    </div>
  );
}
