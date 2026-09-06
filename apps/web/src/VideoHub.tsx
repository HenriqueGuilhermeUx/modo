import type { ContentRequest } from "@modo/contracts/content";
import type { VideoProject } from "@modo/contracts/video";
import { useEffect, useMemo, useState } from "react";
import { listContentRequests } from "./api";
import { getLatestVideoProject } from "./video-api";

type VideoHubItem = {
  request: ContentRequest;
  project: VideoProject | null;
};

function stateFor(item: VideoHubItem) {
  const { request, project } = item;
  if (request.status === "queued" || request.status === "processing" || request.status === "revision_requested") {
    return { label: "Roteiro em produção", tone: "working" };
  }
  if (request.status === "ready") return { label: "Roteiro pronto para aprovar", tone: "review" };
  if (request.status === "failed") return { label: "Roteiro com falha", tone: "failed" };
  if (request.status !== "approved") return { label: "Roteiro pendente", tone: "neutral" };

  if (!project) return { label: "Pronto para o primeiro corte", tone: "ready" };
  if (project.status === "queued" || project.status === "rendering") {
    return { label: "Primeiro corte em render", tone: "working" };
  }
  if (project.status === "failed") return { label: "Render precisa de atenção", tone: "failed" };
  if (project.status === "cancelled") return { label: "Render cancelado", tone: "neutral" };
  if (project.review?.approvalStatus === "approved") {
    return { label: "Reel aprovado", tone: "approved" };
  }
  return { label: "Primeiro corte pronto", tone: "ready" };
}

function projectProgress(item: VideoHubItem) {
  const { request, project } = item;
  if (request.status !== "approved") return request.status === "ready" ? "Aprove o roteiro para liberar a montagem." : "A MODO está preparando o roteiro.";
  if (!project) return "Roteiro aprovado. Falta montar o primeiro corte.";
  if (project.status === "queued" || project.status === "rendering") return "A MODO está compondo cenas, ritmo, legendas e mídia.";
  if (project.status === "failed") return project.error || "O render não terminou. Você pode tentar novamente sem refazer o roteiro.";
  if (project.review?.approvalStatus === "approved") return "Versão final protegida e pronta para publicar ou agendar.";
  const approvedScenes = project.review?.scenes.filter((scene) => scene.status === "approved").length || 0;
  return `${approvedScenes}/${project.scenes.length} cenas aprovadas · ${project.durationSeconds}s · 9:16`;
}

function actionFor(item: VideoHubItem) {
  const { request } = item;
  if (request.status === "approved") {
    return { href: `/app/video/${request.id}`, label: "Abrir MODO Video", primary: true };
  }
  return {
    href: `/app/content?open=${encodeURIComponent(request.id)}`,
    label: request.status === "ready" ? "Revisar roteiro" : "Abrir produção",
    primary: false,
  };
}

export default function VideoHub() {
  const [items, setItems] = useState<VideoHubItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    async function load() {
      setLoading(true);
      setError("");
      try {
        const requests = (await listContentRequests())
          .filter((item) => item.contentType === "short_video_script")
          .slice(0, 24);
        const projects = await Promise.all(
          requests.map((request) =>
            request.status === "approved"
              ? getLatestVideoProject(request.id).catch(() => null)
              : Promise.resolve(null),
          ),
        );
        if (active) setItems(requests.map((request, index) => ({ request, project: projects[index] })));
      } catch (caught) {
        if (active) setError(caught instanceof Error ? caught.message : "Não foi possível carregar seus vídeos.");
      } finally {
        if (active) setLoading(false);
      }
    }
    void load();
    return () => {
      active = false;
    };
  }, []);

  const counts = useMemo(() => ({
    total: items.length,
    approved: items.filter((item) => item.project?.review?.approvalStatus === "approved").length,
    firstCuts: items.filter((item) => item.project?.status === "ready").length,
  }), [items]);

  return (
    <div className="video-hub-shell">
      <header className="video-hub-topbar">
        <a href="/app"><img src="/logo.svg" alt="MODO" /></a>
        <nav>
          <a href="/app">Painel</a>
          <a href="/app/director">Director</a>
          <a href="/app/content">Criar</a>
          <a className="active" href="/app/video">MODO Video</a>
          <a href="/app/publisher">Publisher</a>
        </nav>
      </header>

      <main className="video-hub-main">
        <section className="video-hub-hero">
          <div>
            <div className="section-kicker">MODO VIDEO · FIRST CUT V1.9</div>
            <h1>Do objetivo ao Reel <strong>sem começar pela edição.</strong></h1>
            <p>A MODO escreve o roteiro, escolhe a direção estética, monta cenas com mídia própria, IA ou B-roll, cria o primeiro corte e leva o MP4 aprovado ao Publisher.</p>
            <div className="video-hub-actions">
              <a className="button button-primary" href="/app/content?format=video">Criar novo Reel</a>
              <a className="button button-secondary" href="/app/publisher">Abrir Publisher</a>
            </div>
          </div>
          <div className="video-hub-capabilities">
            <span>15 · 30 · 45s</span>
            <span>Vertical 9:16</span>
            <span>First Cut Quality Gate</span>
            <span>B-roll + imagens + uploads</span>
            <span>Narração e legendas</span>
            <span>Aprovação cena por cena</span>
          </div>
        </section>

        <section className="video-hub-stats" aria-label="Resumo do MODO Video">
          <article><small>Projetos</small><strong>{counts.total}</strong><span>roteiros de vídeo criados</span></article>
          <article><small>Primeiros cortes</small><strong>{counts.firstCuts}</strong><span>MP4s prontos para revisão</span></article>
          <article><small>Aprovados</small><strong>{counts.approved}</strong><span>liberados para publicação</span></article>
        </section>

        <section className="video-hub-list">
          <div className="video-hub-section-heading">
            <div><small>PRODUÇÃO RECENTE</small><h2>Seus Reels e vídeos curtos</h2></div>
            <a href="/app/content?format=video">+ Novo vídeo</a>
          </div>

          {loading && <div className="video-hub-empty">Carregando a produção de vídeo...</div>}
          {error && <div className="portal-error portal-error-wide">{error}</div>}

          {!loading && !error && items.length === 0 && (
            <div className="video-hub-empty video-hub-empty-cta">
              <strong>Seu primeiro Reel começa com uma ideia, não com uma timeline.</strong>
              <p>Conte o objetivo. A MODO transforma contexto de marca em roteiro e primeiro corte para você revisar.</p>
              <a className="button button-primary" href="/app/content?format=video">Criar meu primeiro Reel</a>
            </div>
          )}

          <div className="video-hub-grid">
            {items.map((item) => {
              const state = stateFor(item);
              const action = actionFor(item);
              return (
                <article className="video-hub-card" key={item.request.id}>
                  <div className="video-hub-card-head">
                    <span className={`video-hub-status ${state.tone}`}>{state.label}</span>
                    <small>{new Date(item.request.updatedAt).toLocaleDateString("pt-BR")}</small>
                  </div>
                  <h3>{item.request.output?.title || item.request.output?.hook || item.request.brief.slice(0, 90)}</h3>
                  <p>{projectProgress(item)}</p>
                  {item.project && (
                    <div className="video-hub-meta">
                      <span>{item.project.durationSeconds}s</span>
                      <span>{item.project.scenes.length} cenas</span>
                      <span>{item.project.voiceover ? "Com narração" : "Sem narração"}</span>
                    </div>
                  )}
                  <a className={`button ${action.primary ? "button-primary" : "button-secondary"}`} href={action.href}>{action.label}</a>
                </article>
              );
            })}
          </div>
        </section>

        <section className="video-hub-flow">
          <small>FLUXO MODO VIDEO</small>
          <div>
            <span><b>1</b> Objetivo</span>
            <i>→</i>
            <span><b>2</b> Roteiro</span>
            <i>→</i>
            <span><b>3</b> First Cut</span>
            <i>→</i>
            <span><b>4</b> Aprovação</span>
            <i>→</i>
            <span><b>5</b> Publisher</span>
          </div>
        </section>
      </main>
    </div>
  );
}
