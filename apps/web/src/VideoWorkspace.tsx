import type { Dashboard } from "@modo/contracts";
import type { ContentRequest } from "@modo/contracts/content";
import type {
  VideoDurationSeconds,
  VideoProject,
  VideoScene,
  VideoSceneMode,
  VideoSceneMotion,
  VideoScenePace,
  VideoSceneTake,
  VideoSceneTransition,
  VideoSceneVisualType,
} from "@modo/contracts/video";
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
  getVideoSceneTakes,
  regenerateVideoScene,
  retryVideoProject,
  selectVideoSceneTake,
  updateVideoScene,
} from "./video-api";
import "./video-v13.css";
import "./video-v14.css";
import "./video-v15.css";
import "./video-v16.css";

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
  if (type === "broll_video") return "B-roll vertical";
  if (type === "interface") return "Interface nativa";
  if (type === "data_card") return "Data card";
  return "Kinetic text";
}

function editModeFor(scene: VideoScene): VideoSceneMode {
  if (scene.visualType === "brand_asset") return "auto";
  return scene.visualType;
}

function paceForScene(scene: VideoScene): VideoScenePace {
  if (scene.pace) return scene.pace;
  if (scene.visualType === "broll_video" || scene.visualType === "kinetic_text") return "dynamic";
  if (scene.visualType === "interface" || scene.visualType === "data_card") return "calm";
  return "steady";
}

function transitionForScene(scene: VideoScene): VideoSceneTransition {
  if (scene.transition) return scene.transition;
  if (scene.index === 1) return "cut";
  const options: VideoSceneTransition[] = ["fade", "slide", "zoom", "wipe"];
  return options[(scene.index + Math.max(0, scene.assetRevision) - 2) % options.length];
}

function paceLabel(pace: VideoScenePace) {
  if (pace === "calm") return "ritmo calmo";
  if (pace === "dynamic") return "ritmo dinâmico";
  return "ritmo equilibrado";
}

function transitionLabel(transition: VideoSceneTransition) {
  if (transition === "cut") return "corte seco";
  if (transition === "fade") return "fade";
  if (transition === "slide") return "slide";
  if (transition === "zoom") return "zoom";
  return "wipe";
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
  const [editingScene, setEditingScene] = useState<number | null>(null);
  const [editHeadline, setEditHeadline] = useState("");
  const [editVisual, setEditVisual] = useState("");
  const [editCaption, setEditCaption] = useState("");
  const [editMode, setEditMode] = useState<VideoSceneMode>("auto");
  const [editStockQuery, setEditStockQuery] = useState("");
  const [editMotion, setEditMotion] = useState<VideoSceneMotion>("push_in");
  const [editPace, setEditPace] = useState<VideoScenePace>("steady");
  const [editTransition, setEditTransition] = useState<VideoSceneTransition>("fade");
  const [takesScene, setTakesScene] = useState<number | null>(null);
  const [sceneTakes, setSceneTakes] = useState<VideoSceneTake[]>([]);
  const [loadingTakes, setLoadingTakes] = useState(false);
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

  function startEditing(scene: VideoScene) {
    setEditingScene(scene.index);
    setTakesScene(null);
    setSceneTakes([]);
    setEditHeadline(scene.headline);
    setEditVisual(scene.visual);
    setEditCaption(scene.caption);
    setEditMode(editModeFor(scene));
    setEditStockQuery(scene.stockQuery || scene.visual);
    setEditMotion(scene.motion);
    setEditPace(paceForScene(scene));
    setEditTransition(transitionForScene(scene));
    setError("");
  }

  function stopEditing() {
    setEditingScene(null);
    setEditHeadline("");
    setEditVisual("");
    setEditCaption("");
    setEditMode("auto");
    setEditStockQuery("");
    setEditMotion("push_in");
    setEditPace("steady");
    setEditTransition("fade");
  }

  async function saveSceneEdit(sceneIndex: number) {
    if (!project) return;
    setWorkingScene(sceneIndex);
    setError("");
    try {
      const updated = await updateVideoScene(project.id, sceneIndex, {
        headline: editHeadline,
        visual: editVisual,
        caption: editCaption,
        visualPrompt: editVisual,
        visualMode: editMode,
        motion: editMotion,
        pace: editPace,
        transition: editTransition,
        ...(editMode === "broll_video" ? { stockQuery: editStockQuery || editVisual } : {}),
      });
      setProject(updated);
      stopEditing();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Não foi possível salvar esta cena.");
    } finally {
      setWorkingScene(null);
    }
  }

  async function openTakes(sceneIndex: number) {
    if (!project) return;
    if (takesScene === sceneIndex) {
      setTakesScene(null);
      setSceneTakes([]);
      return;
    }
    setTakesScene(sceneIndex);
    setSceneTakes([]);
    setLoadingTakes(true);
    setError("");
    try {
      setSceneTakes(await getVideoSceneTakes(project.id, sceneIndex));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Não foi possível carregar os takes desta cena.");
    } finally {
      setLoadingTakes(false);
    }
  }

  async function selectTake(sceneIndex: number, token: string) {
    if (!project) return;
    setWorkingScene(sceneIndex);
    setError("");
    try {
      const updated = await selectVideoSceneTake(project.id, sceneIndex, token);
      setProject(updated);
      setSceneTakes([]);
      setTakesScene(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Não foi possível restaurar este take.");
    } finally {
      setWorkingScene(null);
    }
  }

  async function regenerateScene(sceneIndex: number) {
    if (!project) return;
    setWorkingScene(sceneIndex);
    setError("");
    try {
      setProject(await regenerateVideoScene(project.id, sceneIndex));
      setTakesScene(null);
      setSceneTakes([]);
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

  const storyboardScenes: VideoScene[] = project?.scenes || sourceScenes.slice(0, duration === 15 ? 3 : duration === 30 ? 5 : 6).map((scene, index, list) => {
    const totalFrames = duration * 30;
    const chunk = Math.floor(totalFrames / list.length);
    const imageUrl = index === 0 ? request.output!.imageUrl : null;
    const visualType = (imageUrl ? "brand_asset" : index === list.length - 1 ? "kinetic_text" : "generated_image") as VideoSceneVisualType;
    return {
      index: index + 1,
      startFrame: index * chunk,
      endFrame: index === list.length - 1 ? totalFrames : (index + 1) * chunk,
      headline: index === 0 ? request.output!.hook : index === list.length - 1 ? request.output!.cta : scene.scene,
      visual: scene.visual,
      caption: scene.voiceover,
      imageUrl,
      videoUrl: null,
      visualType,
      motion: "push_in",
      pace: visualType === "kinetic_text" ? "dynamic" : "steady",
      transition: index === 0 ? "cut" : "fade",
      assetSource: imageUrl ? "content" : "native",
      assetRevision: 0,
      visualPrompt: scene.visual,
      stockQuery: null,
      stockCredit: null,
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
            <div className="section-kicker">MODO VIDEO · COMPOSER V1.6</div>
            <h1>Ritmo, trilha e takes. Sem perder a direção.</h1>
            <p>A MODO monta ritmo, transições e soundtrack automaticamente. Quando você quiser intervir, pode ajustar uma cena ou recuperar um take anterior sem refazer o restante do vídeo.</p>
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

            <div className="video-runtime-note"><strong>V1.6: montagem audiovisual com memória.</strong><p>A soundtrack é nativa da MODO e baixa automaticamente sob a locução. Ritmo e transições nascem automáticos, mas podem ser ajustados por cena. Takes anteriores ficam reutilizáveis sem nova chamada ao provider.</p></div>
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
                <small>Soundtrack nativa MODO · mix automático e ducking sob a locução</small>
                {project.voiceover && <small>Narração por IA incluída · sincronizada e cacheada por cena · provider {project.voiceProvider || "gerenciado"}</small>}
                {project.visualProvider && <small>Direção visual híbrida · imagens geradas por {project.visualProvider}</small>}
                {project.brollProvider && <small>B-roll vertical incluído · provider {project.brollProvider}</small>}
              </div>
            ) : project && ["queued", "rendering"].includes(project.status) ? (
              <div className="video-rendering-state">
                <div className="video-render-orbit"><span /><i /></div>
                <strong>{project.status === "queued" ? "Aguardando o renderer" : project.voiceover ? "Montando cenas, ritmo, trilha e locução" : "Montando direção visual, B-roll, ritmo, trilha e legendas"}</strong>
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
              <p>{finalVideoApproved ? "Este MP4 está liberado para distribuição. Se você editar, trocar take ou regenerar qualquer cena, só aquela revisão será reaberta." : "Aprovar uma cena preserva essa decisão. Editar, trocar um take ou regenerar um visual reabre somente a cena alterada."}</p>
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
          <div className="video-section-heading"><small>STORYBOARD · V1.6</small><h2>{project ? `${project.scenes.length} cenas · ${project.durationSeconds}s` : `${storyboardScenes.length} cenas planejadas`}</h2><p>Aprove o que está certo. Se algo não ficou bom, ajuste texto, visual, ritmo ou transição só naquela cena — ou volte para um take anterior já gerado.</p></div>
          <div className="video-scene-list video-scene-list-rich">
            {storyboardScenes.map((scene) => {
              const sceneReview = project?.review?.scenes.find((item) => item.sceneIndex === scene.index);
              const sceneApproved = sceneReview?.status === "approved";
              const isEditing = editingScene === scene.index;
              const showTakes = takesScene === scene.index;
              const pace = paceForScene(scene);
              const transition = transitionForScene(scene);
              return (
                <article key={scene.index} className={isEditing ? "editing" : ""}>
                  <div className="video-scene-number"><strong>{String(scene.index).padStart(2, "0")}</strong><span>{seconds(scene.startFrame)}—{seconds(scene.endFrame)}</span></div>
                  {scene.videoUrl ? (
                    <video className="video-scene-thumb video-scene-video" src={scene.videoUrl} muted loop playsInline preload="metadata" />
                  ) : scene.imageUrl ? (
                    <img className="video-scene-thumb" src={scene.imageUrl} alt="" />
                  ) : null}
                  <div className="video-scene-copy">
                    <div className="video-scene-tags"><span>{visualLabel(scene.visualType)}</span><span>{scene.motion.replaceAll("_", " ")}</span><span>{paceLabel(pace)}</span><span>{transitionLabel(transition)}</span>{scene.assetRevision > 0 && <span>variação {scene.assetRevision + 1}</span>}</div>
                    {scene.stockCredit && (
                      <small className="video-stock-credit">Vídeo por <a href={scene.stockCredit.authorUrl} target="_blank" rel="noreferrer">{scene.stockCredit.authorName}</a> · <a href={scene.stockCredit.sourceUrl} target="_blank" rel="noreferrer">Pexels</a></small>
                    )}
                    <h3>{scene.headline}</h3>
                    <p><b>Direção:</b> {scene.visual}</p>
                    <p><b>Locução:</b> {scene.caption}</p>

                    {isEditing && (
                      <div className="video-scene-editor">
                        <div className="video-scene-editor-grid">
                          <label><span>Headline</span><input value={editHeadline} maxLength={300} onChange={(event) => setEditHeadline(event.target.value)} /></label>
                          <label><span>Tratamento visual</span><select value={editMode} onChange={(event) => setEditMode(event.target.value as VideoSceneMode)}><option value="auto">MODO decide</option><option value="broll_video">B-roll vertical</option><option value="generated_image">Imagem editorial</option><option value="interface">Interface nativa</option><option value="data_card">Data card</option><option value="kinetic_text">Kinetic text</option></select></label>
                        </div>
                        <label><span>Direção da cena</span><textarea value={editVisual} maxLength={800} rows={3} onChange={(event) => setEditVisual(event.target.value)} /></label>
                        <label><span>Locução / legenda</span><textarea value={editCaption} maxLength={900} rows={3} onChange={(event) => setEditCaption(event.target.value)} /></label>
                        {editMode === "broll_video" && <label><span>Busca do B-roll</span><input value={editStockQuery} maxLength={240} placeholder="Ex.: equipe brasileira em reunião no escritório" onChange={(event) => setEditStockQuery(event.target.value)} /><small>A MODO busca vídeo vertical compatível. Se o provider falhar, o render usa o fallback visual.</small></label>}
                        <div className="video-v16-controls-grid">
                          <label><span>Movimento</span><select value={editMotion} onChange={(event) => setEditMotion(event.target.value as VideoSceneMotion)}><option value="push_in">Aproximar</option><option value="zoom_out">Afastar</option><option value="pan_left">Pan esquerda</option><option value="pan_right">Pan direita</option><option value="static">Estático</option></select></label>
                          <label><span>Ritmo</span><select value={editPace} onChange={(event) => setEditPace(event.target.value as VideoScenePace)}><option value="calm">Calmo</option><option value="steady">Equilibrado</option><option value="dynamic">Dinâmico</option></select></label>
                          <label><span>Transição</span><select value={editTransition} onChange={(event) => setEditTransition(event.target.value as VideoSceneTransition)}><option value="cut">Corte seco</option><option value="fade">Fade</option><option value="slide">Slide</option><option value="zoom">Zoom</option><option value="wipe">Wipe</option></select></label>
                        </div>
                        <small className="video-v16-control-note">Alterar apenas movimento, ritmo ou transição não gera uma nova imagem nem baixa outro B-roll.</small>
                        <div className="video-scene-editor-actions"><button className="button button-primary" disabled={workingScene !== null || !editHeadline.trim() || !editVisual.trim() || !editCaption.trim()} onClick={() => void saveSceneEdit(scene.index)}>{workingScene === scene.index ? "Salvando e renderizando..." : "Salvar esta cena"}</button><button className="button button-outline" disabled={workingScene !== null} onClick={stopEditing}>Cancelar edição</button></div>
                      </div>
                    )}

                    {project?.status === "ready" && !isEditing && (
                      <div className="video-scene-review">
                        <span className={`video-scene-review-badge ${sceneApproved ? "approved" : ""}`}>{sceneApproved ? "✓ Cena aprovada" : "Aguardando aprovação"}</span>
                        {!sceneApproved && (
                          <button className="button button-outline video-scene-approve" disabled={workingScene !== null} onClick={() => void approveScene(scene.index)}>
                            {workingScene === scene.index ? "Salvando..." : "Aprovar cena"}
                          </button>
                        )}
                        <button className="button button-outline video-scene-edit" disabled={workingScene !== null} onClick={() => startEditing(scene)}>Editar cena</button>
                        <button className="button button-outline video-v16-takes-button" disabled={workingScene !== null} onClick={() => void openTakes(scene.index)}>{showTakes ? "Fechar takes" : "Takes desta cena"}</button>
                        <button className="button button-outline video-scene-regenerate" disabled={workingScene !== null} onClick={() => void regenerateScene(scene.index)}>
                          {workingScene === scene.index ? "Processando..." : scene.visualType === "broll_video" ? "Buscar outro B-roll" : sceneApproved ? "Trocar visual e reabrir cena" : "Regenerar só este visual"}
                        </button>
                      </div>
                    )}

                    {project?.status === "ready" && showTakes && !isEditing && (
                      <div className="video-v16-takes-panel">
                        <div className="video-v16-takes-heading"><div><strong>Histórico de takes</strong><small>Reutilize material já gerado sem nova chamada ao provider.</small></div><span>{loadingTakes ? "carregando…" : `${sceneTakes.length} take${sceneTakes.length === 1 ? "" : "s"}`}</span></div>
                        {!loadingTakes && sceneTakes.length === 0 && <div className="video-v16-takes-empty">Ainda não há variações visuais salvas para esta cena.</div>}
                        <div className="video-v16-takes-grid">
                          {sceneTakes.map((take) => (
                            <div key={take.token} className={`video-v16-take ${take.active ? "active" : ""}`}>
                              <div className="video-v16-take-preview">
                                {take.kind === "video" ? <video src={take.url} muted loop playsInline preload="metadata" /> : <img src={take.url} alt="" />}
                                {take.active && <span>Atual</span>}
                              </div>
                              <div className="video-v16-take-meta"><strong>Variação {take.revision + 1}</strong><small>{take.provider}</small></div>
                              {take.stockCredit && <small className="video-stock-credit">por {take.stockCredit.authorName} · Pexels</small>}
                              {!take.active && take.selectable && <button className="button button-outline" disabled={workingScene !== null} onClick={() => void selectTake(scene.index, take.token)}>Usar este take</button>}
                              {!take.active && !take.selectable && <small className="video-v16-take-warning">Take legado sem crédito restaurável.</small>}
                            </div>
                          ))}
                        </div>
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
