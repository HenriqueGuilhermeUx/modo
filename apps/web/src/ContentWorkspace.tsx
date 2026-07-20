import {
  contentCreditCost,
  type ContentUnitType,
  type Dashboard,
} from "@modo/contracts";
import {
  type ContentObjective,
  type ContentRequest,
} from "@modo/contracts/content";
import { type FormEvent, useEffect, useMemo, useState } from "react";
import {
  createContentRequest,
  getDashboard,
  getSessionToken,
  listContentRequests,
} from "./api";

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
  ready: "Pronto",
  failed: "Falhou",
  cancelled: "Cancelado",
};

export default function ContentWorkspace() {
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [requests, setRequests] = useState<ContentRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [brandId, setBrandId] = useState("");
  const [contentType, setContentType] = useState<ContentUnitType>("static_post");
  const [objective, setObjective] = useState<ContentObjective>("autoridade");
  const [channel, setChannel] = useState("Instagram");
  const [brief, setBrief] = useState("");

  async function load() {
    setLoading(true);
    try {
      const [currentDashboard, currentRequests] = await Promise.all([
        getDashboard(),
        listContentRequests(),
      ]);
      setDashboard(currentDashboard);
      setRequests(currentRequests);
      setBrandId((current) => current || currentDashboard.brands[0]?.id || "");
      setError("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Não foi possível carregar a produção.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!getSessionToken()) {
      window.location.href = "/app";
      return;
    }
    void load();
  }, []);

  const cost = contentCreditCost[contentType];
  const canSubmit = Boolean(
    dashboard &&
      brandId &&
      brief.trim().length >= 10 &&
      dashboard.usage.creditsRemaining >= cost,
  );
  const selectedBrand = useMemo(
    () => dashboard?.brands.find((brand) => brand.id === brandId),
    [dashboard, brandId],
  );

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    setError("");
    setSuccess("");
    try {
      const result = await createContentRequest({
        brandId,
        contentType,
        objective,
        channel,
        brief,
      });
      setRequests((current) => [result.request, ...current]);
      setDashboard((current) => current ? { ...current, usage: result.usage } : current);
      setBrief("");
      setSuccess("Pedido criado e créditos reservados. Ele já está na fila da MODO.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Não foi possível criar o pedido.");
    } finally {
      setSubmitting(false);
    }
  }

  if (loading && !dashboard) {
    return <main className="portal-loading"><img src="/logo.svg" alt="MODO" /><div className="portal-spinner" /><p>Preparando o estúdio...</p></main>;
  }

  if (!dashboard) {
    return <main className="portal-loading"><p>{error || "Sua sessão expirou."}</p><a className="button button-primary" href="/app">Entrar novamente</a></main>;
  }

  return (
    <div className="workspace-shell">
      <header className="workspace-header">
        <a href="/app"><img src="/logo.svg" alt="MODO" /></a>
        <nav><a href="/app">Painel</a><a className="active" href="/app/content">Criar conteúdo</a></nav>
        <div className="workspace-balance"><small>Saldo</small><strong>{dashboard.usage.creditsRemaining}</strong><span>créditos</span></div>
      </header>

      <main className="workspace-main">
        <section className="workspace-intro">
          <div><div className="section-kicker">MODO CREATE</div><h1>Transforme uma intenção em conteúdo.</h1><p>Escolha a marca, o objetivo e o formato. A MODO registra o pedido, reserva a capacidade e prepara o trabalho para a automação.</p></div>
          <a className="button button-outline" href="/app">← Voltar ao painel</a>
        </section>

        <div className="workspace-grid">
          <form className="workspace-form" onSubmit={handleSubmit}>
            <div className="workspace-form-heading"><div><small>NOVO PEDIDO</small><h2>Direção de produção</h2></div><div className="workspace-cost"><strong>{cost}</strong><span>crédito{cost > 1 ? "s" : ""}</span></div></div>

            {dashboard.brands.length === 0 ? (
              <div className="workspace-empty">Cadastre uma marca antes de criar conteúdo.<a href="/app#brands">Cadastrar marca</a></div>
            ) : (
              <>
                <label>Marca<select value={brandId} onChange={(event) => setBrandId(event.target.value)}>{dashboard.brands.map((brand) => <option key={brand.id} value={brand.id}>{brand.name}</option>)}</select></label>
                <div className="workspace-two-columns">
                  <label>Formato<select value={contentType} onChange={(event) => setContentType(event.target.value as ContentUnitType)}>{(Object.keys(formatLabels) as ContentUnitType[]).map((type) => <option key={type} value={type}>{formatLabels[type]} · {contentCreditCost[type]} crédito{contentCreditCost[type] > 1 ? "s" : ""}</option>)}</select></label>
                  <label>Objetivo<select value={objective} onChange={(event) => setObjective(event.target.value as ContentObjective)}>{(Object.keys(objectiveLabels) as ContentObjective[]).map((item) => <option key={item} value={item}>{objectiveLabels[item]}</option>)}</select></label>
                </div>
                <label>Canal<input value={channel} onChange={(event) => setChannel(event.target.value)} placeholder="Instagram" /></label>
                <label>O que este conteúdo precisa comunicar?<textarea value={brief} onChange={(event) => setBrief(event.target.value)} placeholder="Ex.: apresentar nossa nova solução, mostrar o problema que ela resolve e convidar o público para uma demonstração." minLength={10} maxLength={2000} required /></label>
                <div className="workspace-summary"><span>Marca: <strong>{selectedBrand?.name}</strong></span><span>Formato: <strong>{formatLabels[contentType]}</strong></span><span>Saldo após pedido: <strong>{Math.max(0, dashboard.usage.creditsRemaining - cost)}</strong></span></div>
                {error && <div className="portal-error">{error}</div>}
                {success && <div className="workspace-success">{success}</div>}
                <button className="button button-primary button-full" disabled={!canSubmit || submitting}>{submitting ? "Enviando para a fila..." : `Criar pedido · ${cost} crédito${cost > 1 ? "s" : ""}`}</button>
                {dashboard.usage.creditsRemaining < cost && <small className="workspace-warning">Saldo insuficiente para este formato. Escolha um formato de 1 crédito ou faça upgrade.</small>}
              </>
            )}
          </form>

          <section className="workspace-history">
            <div className="workspace-history-heading"><div><small>HISTÓRICO</small><h2>Produção solicitada</h2></div><span>{requests.length} pedido(s)</span></div>
            {requests.length === 0 ? <div className="workspace-empty-history"><strong>A fila ainda está vazia.</strong><p>Seu primeiro pedido aparecerá aqui com o status de processamento.</p></div> : <div className="workspace-request-list">{requests.map((request) => {
              const brand = dashboard.brands.find((item) => item.id === request.brandId);
              return <article key={request.id}><div className={`workspace-status ${request.status}`}>{statusLabels[request.status]}</div><h3>{formatLabels[request.contentType]} · {objectiveLabels[request.objective]}</h3><p>{request.brief}</p><div><span>{brand?.name || "Marca"}</span><span>{request.channel}</span><span>-{request.creditsCharged} crédito{request.creditsCharged > 1 ? "s" : ""}</span></div></article>;
            })}</div>}
          </section>
        </div>
      </main>
    </div>
  );
}
