import {
  contentCreditCost,
  type ContentUnitType,
  type Dashboard,
} from "@modo/contracts";
import {
  type ContentObjective,
  type ContentRequest,
  type GeneratedContent,
} from "@modo/contracts/content";
import { type FormEvent, useEffect, useMemo, useState } from "react";
import {
  approveContentRequest,
  createContentRequest,
  getDashboard,
  getSessionToken,
  listContentRequests,
  requestContentRevision,
  retryContentRequest,
} from "./api";
import CreativeDirector from "./CreativeDirector";
import { recordCreativeFeedback } from "./director-api";
import ProductionProgress from "./ProductionProgress";

const formatLabels: Record<ContentUnitType, string> = {
  static_post: "Post estático",
  story: "Story",
  carousel: "Carrossel",
  short_video_script: "Roteiro de vídeo curto",
  channel_adaptation: "Adaptação de canal",
};

const objectiveLabels: Record<ContentObjective, string> = {
  autoridade: "Autoridade",
  demanda: "Geração de demanda",
  relacionamento: "Relacionamento",
  conversao: "Conversão",
  educacao: "Educação",
};

const statusLabels: Record<ContentRequest["status"], string> = {
  queued: "Na fila",
  processing: "Em produção",
  ready: "Pronto para revisar",
  approved: "Aprovado",
  revision_requested: "Revisão solicitada",
  failed: "Falhou",
  cancelled: "Cancelado",
};

type DirectorPrefill = {
  brandId: string;
  contentType: ContentUnitType;
  objective: ContentObjective;
  channel: string;
  brief: string;
  recommendationId?: string;
};

function OutputPanel({ output }: { output: GeneratedContent }) {
  return (
    <div className="content-output">
      <section className="content-output-lead"><small>GANCHO</small><h3>{output.hook}</h3></section>
      <section><small>TÍTULO</small><p>{output.title}</p></section>
      <section><small>LEGENDA</small><p className="content-caption">{output.caption}</p></section>
      <section><small>CHAMADA PARA AÇÃO</small><p>{output.cta}</p></section>
      <section><small>DIREÇÃO VISUAL</small><p>{output.visualDirection}</p></section>

      {output.slides.length > 0 && (
        <section className="content-structured-block">
          <small>CARROSSEL</small>
          <div className="content-slide-list">
            {output.slides.map((slide, index) => (
              <article key={`${slide.title}-${index}`}><span>{String(index + 1).padStart(2, "0")}</span><div><strong>{slide.title}</strong><p>{slide.body}</p></div></article>
            ))}
          </div>
        </section>
      )}

      {output.script.length > 0 && (
        <section className="content-structured-block">
          <small>ROTEIRO</small>
          <div className="content-slide-list">
            {output.script.map((scene, index) => (
              <article key={`${scene.scene}-${index}`}><span>{String(index + 1).padStart(2, "0")}</span><div><strong>{scene.scene}</strong><p><b>Visual:</b> {scene.visual}</p><p><b>Locução:</b> {scene.voiceover}</p></div></article>
            ))}
          </div>
        </section>
      )}

      {output.storyFrames.length > 0 && (
        <section className="content-structured-block">
          <small>SEQUÊNCIA DE STORIES</small>
          <div className="content-slide-list">
            {output.storyFrames.map((frame, index) => (
              <article key={`${frame.headline}-${index}`}><span>{String(index + 1).padStart(2, "0")}</span><div><strong>{frame.headline}</strong><p>{frame.body}</p>{frame.interaction && <p><b>Interação:</b> {frame.interaction}</p>}</div></article>
            ))}
          </div>
        </section>
      )}

      {output.adaptationNotes.length > 0 && <section><small>NOTAS DE ADAPTAÇÃO</small><ul>{output.adaptationNotes.map((note) => <li key={note}>{note}</li>)}</ul></section>}
      <div className="content-hashtags">{output.hashtags.map((tag) => <span key={tag}>{tag}</span>)}</div>
    </div>
  );
}

export default function ContentWorkspace() {
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [requests, setRequests] = useState<ContentRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [actionId, setActionId] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [brandId, setBrandId] = useState("");
  const [contentType, setContentType] = useState<ContentUnitType>("static_post");
  const [objective, setObjective] = useState<ContentObjective>("autoridade");
  const [channel, setChannel] = useState("Instagram");
  const [brief, setBrief] = useState("");
  const [expandedId, setExpandedId] = useState("");
  const [revisionId, setRevisionId] = useState("");
  const [revisionInstructions, setRevisionInstructions] = useState("");
  const [prefilledFromDirector, setPrefilledFromDirector] = useState(false);
  const [sourceRecommendationId, setSourceRecommendationId] = useState("");

  async function load(showSpinner = true) {
    if (showSpinner) setLoading(true);
    try {
      const [currentDashboard, currentRequests] = await Promise.all([getDashboard(), listContentRequests()]);
      setDashboard(currentDashboard);
      setRequests(currentRequests);

      const rawPrefill = window.sessionStorage.getItem("modo.directorPrefill");
      if (rawPrefill) {
        try {
          const prefill = JSON.parse(rawPrefill) as DirectorPrefill;
          if (currentDashboard.brands.some((item) => item.id === prefill.brandId)) {
            setBrandId(prefill.brandId);
            setContentType(prefill.contentType);
            setObjective(prefill.objective);
            setChannel(prefill.channel);
            setBrief(prefill.brief);
            setSourceRecommendationId(prefill.recommendationId || "");
            setPrefilledFromDirector(true);
            setSuccess("O Diretor já preparou esta solicitação. Revise e envie para produção.");
          }
        } catch {
          // Ignore invalid session data.
        }
        window.sessionStorage.removeItem("modo.directorPrefill");
      } else {
        setBrandId((current) => current || currentDashboard.brands[0]?.id || "");
      }
      setError("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Não foi possível carregar a produção.");
    } finally {
      if (showSpinner) setLoading(false);
    }
  }

  useEffect(() => {
    if (!getSessionToken()) {
      window.location.href = "/app";
      return;
    }
    void load();
  }, []);

  useEffect(() => {
    const hasActiveWork = requests.some((request) => ["queued", "processing", "revision_requested"].includes(request.status));
    if (!hasActiveWork) return;
    const timer = window.setInterval(() => void load(false), 2000);
    return () => window.clearInterval(timer);
  }, [requests]);

  const cost = contentCreditCost[contentType];
  const productionAllowed = Boolean(dashboard && ["active", "retrying"].includes(dashboard.usage.status));
  const canSubmit = Boolean(dashboard && productionAllowed && brandId && brief.trim().length >= 10 && dashboard.usage.creditsRemaining >= cost);
  const selectedBrand = useMemo(() => dashboard?.brands.find((brand) => brand.id === brandId), [dashboard, brandId]);

  function replaceRequest(next: ContentRequest) {
    setRequests((current) => current.map((item) => item.id === next.id ? next : item));
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    setError("");
    setSuccess("");
    try {
      const result = await createContentRequest({ brandId, contentType, objective, channel, brief });
      setRequests((current) => [result.request, ...current]);
      setDashboard((current) => current ? { ...current, usage: result.usage } : current);
      setExpandedId(result.request.id);
      if (sourceRecommendationId) {
        await recordCreativeFeedback(brandId, {
          recommendationId: sourceRecommendationId,
          contentRequestId: result.request.id,
          signal: "accepted",
        }).catch(() => undefined);
        setSourceRecommendationId("");
      }
      setPrefilledFromDirector(false);
      setSuccess("Pedido assumido pelo Diretor de Criação. Você pode acompanhar as etapas abaixo.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Não foi possível criar o pedido.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleApprove(request: ContentRequest) {
    setActionId(request.id);
    setError("");
    try {
      replaceRequest(await approveContentRequest(request.id));
      await recordCreativeFeedback(request.brandId, {
        contentRequestId: request.id,
        signal: "approved",
      }).catch(() => undefined);
      setSuccess("Conteúdo aprovado. A MODO usará esta decisão nas próximas sugestões.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Não foi possível aprovar.");
    } finally {
      setActionId("");
    }
  }

  async function handleRevision(request: ContentRequest) {
    if (revisionInstructions.trim().length < 5) return;
    setActionId(request.id);
    setError("");
    try {
      replaceRequest(await requestContentRevision(request.id, revisionInstructions));
      await recordCreativeFeedback(request.brandId, {
        contentRequestId: request.id,
        signal: "revision_requested",
        notes: revisionInstructions,
      }).catch(() => undefined);
      setRevisionId("");
      setRevisionInstructions("");
      setSuccess("Revisão solicitada. O Diretor aprendeu a preferência e iniciou a nova versão.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Não foi possível solicitar a revisão.");
    } finally {
      setActionId("");
    }
  }

  async function handleRetry(id: string) {
    setActionId(id);
    setError("");
    try {
      replaceRequest(await retryContentRequest(id));
      setExpandedId(id);
      setSuccess("Pedido reenviado sem novo consumo de créditos.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Não foi possível reenviar.");
    } finally {
      setActionId("");
    }
  }

  if (loading && !dashboard) return <main className="portal-loading"><img src="/logo.svg" alt="MODO" /><div className="portal-spinner" /><p>Preparando o estúdio...</p></main>;
  if (!dashboard) return <main className="portal-loading"><p>{error || "Sua sessão expirou."}</p><a className="button button-primary" href="/app">Entrar novamente</a></main>;

  return (
    <div className="workspace-shell">
      <header className="workspace-header">
        <a href="/app"><img src="/logo.svg" alt="MODO" /></a>
        <nav><a href="/app">Painel</a><a href="/app/director">Diretor</a><a className="active" href="/app/content">Criar</a><a href="/app/linkedin">LinkedIn</a><a href="/app/planos">Planos</a></nav>
        <div className="workspace-balance"><small>Saldo</small><strong>{dashboard.usage.creditsRemaining}</strong><span>créditos</span></div>
      </header>

      <main className="workspace-main">
        <section className="workspace-intro">
          <div><div className="section-kicker">MODO CREATE</div><h1>Seu Diretor de Criação, dentro da plataforma.</h1><p>Escolha o que o conteúdo precisa fazer. A MODO define o ângulo, estrutura a mensagem, produz e entrega para sua aprovação.</p></div>
          <a className="button button-outline" href="/app/director">← Ver plano criativo</a>
        </section>

        {!productionAllowed && <div className="workspace-blocked"><strong>Produção temporariamente bloqueada.</strong><p>Regularize ou reative sua assinatura para criar novos conteúdos.</p><a className="button button-primary" href="/app/planos">Ver assinatura</a></div>}

        <div className="workspace-grid">
          <form className="workspace-form" onSubmit={handleSubmit}>
            <div className="workspace-form-heading"><div><small>NOVO PEDIDO</small><h2>Direção criativa</h2></div><div className="workspace-cost"><strong>{cost}</strong><span>crédito{cost > 1 ? "s" : ""}</span></div></div>

            {dashboard.brands.length === 0 ? (
              <div className="workspace-empty">Cadastre uma marca antes de criar conteúdo.<a href="/app#brands">Cadastrar marca</a></div>
            ) : (
              <>
                <label>Marca<select value={brandId} onChange={(event) => setBrandId(event.target.value)}>{dashboard.brands.map((brand) => <option key={brand.id} value={brand.id}>{brand.name}</option>)}</select></label>
                <div className="workspace-two-columns">
                  <label>Formato<select value={contentType} onChange={(event) => setContentType(event.target.value as ContentUnitType)}>{(Object.keys(formatLabels) as ContentUnitType[]).map((type) => <option key={type} value={type}>{formatLabels[type]} · {contentCreditCost[type]} crédito{contentCreditCost[type] > 1 ? "s" : ""}</option>)}</select></label>
                  <label>Canal<input value={channel} onChange={(event) => setChannel(event.target.value)} placeholder="Instagram" /></label>
                </div>

                {prefilledFromDirector ? (
                  <section className="director-prefill-card">
                    <div><small>PLANO DO MODO DIRECTOR</small><strong>Briefing estratégico preparado.</strong><p>Você pode ajustar detalhes antes de enviar. A intenção, o formato e o canal já foram definidos.</p></div>
                    <label>Direção para produção<textarea value={brief} onChange={(event) => setBrief(event.target.value)} minLength={10} maxLength={2000} /></label>
                    <button type="button" className="button button-outline" onClick={() => { setPrefilledFromDirector(false); setBrief(""); setSourceRecommendationId(""); }}>Criar outra direção</button>
                  </section>
                ) : (
                  <CreativeDirector
                    brandName={selectedBrand?.name || ""}
                    contentType={contentType}
                    objective={objective}
                    value={brief}
                    onChange={setBrief}
                    onObjectiveChange={setObjective}
                  />
                )}

                <div className="workspace-summary"><span>Marca: <strong>{selectedBrand?.name}</strong></span><span>Formato: <strong>{formatLabels[contentType]}</strong></span><span>Objetivo: <strong>{objectiveLabels[objective]}</strong></span><span>Saldo após pedido: <strong>{Math.max(0, dashboard.usage.creditsRemaining - cost)}</strong></span></div>
                {error && <div className="portal-error">{error}</div>}
                {success && <div className="workspace-success">{success}</div>}
                <button className="button button-primary button-full" disabled={!canSubmit || submitting}>{submitting ? "Diretor assumindo o pedido..." : `Produzir com a MODO · ${cost} crédito${cost > 1 ? "s" : ""}`}</button>
                {dashboard.usage.creditsRemaining < cost && <small className="workspace-warning">Saldo insuficiente para este formato. Escolha um formato de 1 crédito ou faça upgrade.</small>}
              </>
            )}
          </form>

          <section className="workspace-history">
            <div className="workspace-history-heading"><div><small>HISTÓRICO</small><h2>Produção solicitada</h2></div><span>{requests.length} pedido(s)</span></div>
            {requests.length === 0 ? (
              <div className="workspace-empty-history"><strong>A fila ainda está vazia.</strong><p>Escolha uma intenção no Diretor de Criação para iniciar.</p></div>
            ) : (
              <div className="workspace-request-list">
                {requests.map((request) => {
                  const brand = dashboard.brands.find((item) => item.id === request.brandId);
                  const expanded = expandedId === request.id;
                  const canRevise = request.status === "ready" && request.revisionCount < request.maxRevisions;
                  return (
                    <article className={`workspace-request-card ${expanded ? "expanded" : ""}`} key={request.id}>
                      <button className="workspace-request-summary" type="button" onClick={() => setExpandedId(expanded ? "" : request.id)}>
                        <div className={`workspace-status ${request.status}`}>{statusLabels[request.status]}</div>
                        <h3>{formatLabels[request.contentType]} · {objectiveLabels[request.objective]}</h3>
                        <p>{request.brief.split("\n")[0]}</p>
                        <div><span>{brand?.name || "Marca"}</span><span>{request.channel}</span><span>-{request.creditsCharged} crédito{request.creditsCharged > 1 ? "s" : ""}</span></div>
                        <small>{expanded ? "Fechar detalhes ↑" : "Ver detalhes ↓"}</small>
                      </button>

                      {expanded && (
                        <div className="workspace-request-detail">
                          {request.output && <OutputPanel output={request.output} />}
                          {["queued", "processing", "revision_requested"].includes(request.status) && <ProductionProgress request={request} />}
                          {request.status === "failed" && <div className="content-failed"><strong>A produção encontrou um problema.</strong><p>{request.error}</p><button type="button" className="button button-primary" disabled={actionId === request.id} onClick={() => void handleRetry(request.id)}>Reenviar sem cobrar créditos</button></div>}
                          {request.status === "ready" && <div className="content-review-actions"><div><strong>{request.revisionCount}/{request.maxRevisions}</strong><span>revisões utilizadas</span></div><button type="button" className="button button-primary" disabled={actionId === request.id} onClick={() => void handleApprove(request)}>Aprovar conteúdo</button>{canRevise && <button type="button" className="button button-secondary" onClick={() => setRevisionId(revisionId === request.id ? "" : request.id)}>Solicitar revisão</button>}</div>}
                          {revisionId === request.id && canRevise && <div className="content-revision-form"><label>O que precisa mudar?<textarea value={revisionInstructions} onChange={(event) => setRevisionInstructions(event.target.value)} minLength={5} maxLength={1500} placeholder="Ex.: deixe o tom mais direto, reduza a legenda e destaque o benefício financeiro no segundo slide." /></label><div><button type="button" className="button button-secondary" onClick={() => setRevisionId("")}>Cancelar</button><button type="button" className="button button-primary" disabled={revisionInstructions.trim().length < 5 || actionId === request.id} onClick={() => void handleRevision(request)}>Enviar revisão</button></div></div>}
                          {request.status === "approved" && <div className="content-approved"><strong>✓ Conteúdo aprovado</strong><p>Esta versão está pronta para a próxima etapa de publicação.</p></div>}
                        </div>
                      )}
                    </article>
                  );
                })}
              </div>
            )}
          </section>
        </div>
      </main>
    </div>
  );
}
