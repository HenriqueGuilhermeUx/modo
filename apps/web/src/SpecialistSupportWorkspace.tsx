import type { Dashboard } from "@modo/contracts";
import type { HumanSupportRequest, HumanSupportType } from "@modo/contracts/strategy-network";
import { type FormEvent, useEffect, useMemo, useState } from "react";
import { getDashboard, getSessionToken, listContentRequests } from "./api";
import { createHumanSupportRequest, listHumanSupportRequests } from "./strategy-network-api";

const supportOptions: Array<{ id: HumanSupportType; title: string; copy: string }> = [
  { id: "strategy", title: "Estratégia", copy: "Revisar posicionamento, campanha, canais, oferta e prioridades." },
  { id: "art_direction", title: "Direção de arte", copy: "Elevar conceito visual, identidade e consistência da campanha." },
  { id: "copywriting", title: "Copywriting", copy: "Refinar mensagem, argumento, oferta, roteiro e chamada para ação." },
  { id: "design", title: "Design", copy: "Finalizar peças especiais ou adaptar entregas fora dos templates." },
  { id: "motion", title: "Motion", copy: "Transformar a campanha em animações e peças com movimento." },
  { id: "video_editing", title: "Edição de vídeo", copy: "Editar captação, cortes, ritmo, legenda e versões por canal." },
  { id: "paid_media", title: "Mídia paga", copy: "Estruturar, acompanhar ou revisar campanhas de anúncios." },
  { id: "campaign_review", title: "Revisão de campanha", copy: "Receber uma segunda opinião antes de publicar ou investir." },
  { id: "full_management", title: "Gestão acompanhada", copy: "Avaliar uma operação com apoio humano recorrente da Modo." },
  { id: "other", title: "Outro desafio", copy: "Explique o que precisa e a Modo avalia o melhor perfil." },
];

const statusCopy: Record<HumanSupportRequest["status"], string> = {
  requested: "Recebido",
  triage: "Em triagem",
  proposal: "Proposta em preparação",
  in_progress: "Em andamento",
  completed: "Concluído",
  declined: "Não disponível",
};

export default function SpecialistSupportWorkspace() {
  const params = new URLSearchParams(window.location.search);
  const initialContentId = params.get("content");
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [requests, setRequests] = useState<HumanSupportRequest[]>([]);
  const [eligible, setEligible] = useState(false);
  const [brandId, setBrandId] = useState("");
  const [type, setType] = useState<HumanSupportType>("campaign_review");
  const [context, setContext] = useState("");
  const [desiredOutcome, setDesiredOutcome] = useState("");
  const [urgency, setUrgency] = useState<"normal" | "priority">("normal");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  useEffect(() => {
    if (!getSessionToken()) {
      window.location.href = "/app";
      return;
    }
    Promise.all([getDashboard(), listContentRequests(), listHumanSupportRequests()])
      .then(([currentDashboard, contents, currentRequests]) => {
        const approved = contents.filter((item) => item.status === "approved");
        const linked = approved.find((item) => item.id === initialContentId);
        setDashboard(currentDashboard);
        setEligible(approved.length > 0);
        setBrandId(linked?.brandId || currentDashboard.brands[0]?.id || "");
        setRequests(currentRequests);
      })
      .catch((caught) => setError(caught instanceof Error ? caught.message : "Não foi possível abrir a curadoria."))
      .finally(() => setLoading(false));
  }, [initialContentId]);

  const selected = useMemo(() => supportOptions.find((item) => item.id === type), [type]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError("");
    setSuccess("");
    try {
      const created = await createHumanSupportRequest({
        brandId,
        contentRequestId: initialContentId || null,
        type,
        context,
        desiredOutcome,
        urgency,
      });
      setRequests((current) => [created, ...current]);
      setContext("");
      setDesiredOutcome("");
      setSuccess("Pedido recebido. A Modo fará uma triagem discreta e retornará apenas quando houver uma indicação útil para este desafio.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Não foi possível enviar o pedido.");
    } finally {
      setSubmitting(false);
    }
  }

  if (loading || !dashboard) {
    return <main className="portal-loading"><img src="/logo.svg" alt="MODO" /><div className="portal-spinner" /><p>Preparando a curadoria...</p>{error && <div className="portal-error">{error}</div>}</main>;
  }

  if (!eligible) {
    return (
      <main className="portal-loading curation-locked">
        <img src="/logo.svg" alt="MODO" />
        <small>CURADORIA OPCIONAL</small>
        <h1>Primeiro, conclua seu fluxo na Modo.</h1>
        <p>A curadoria fica disponível de forma discreta depois que sua primeira entrega for criada, revisada e aprovada.</p>
        <a className="button button-primary" href="/app/content">Criar e revisar uma entrega</a>
      </main>
    );
  }

  return (
    <div className="specialist-shell discreet-curation-shell">
      <header className="workspace-header">
        <a href="/app"><img src="/logo.svg" alt="MODO" /></a>
        <nav><a href="/app">Painel</a><a href="/app/base">Base estratégica</a><a href="/app/content">Criar</a></nav>
        <div className="workspace-balance"><small>Opcional</small><strong>Curadoria Modo</strong><span>para entregas aprovadas</span></div>
      </header>

      <main className="specialist-main discreet-curation-main">
        <section className="specialist-hero discreet-curation-hero">
          <div><div className="section-kicker">CURADORIA MODO</div><h1>Uma segunda opinião, somente quando fizer diferença.</h1><p>O motor da Modo continua sendo o centro da operação. Para uma entrega já aprovada que exija julgamento adicional, você pode solicitar uma análise humana pontual.</p></div>
          <aside><strong>Processo controlado</strong><span>1. Você descreve o ponto de dúvida.</span><span>2. A Modo avalia a necessidade.</span><span>3. Retornamos com disponibilidade e escopo.</span><span>4. Nada é contratado ou cobrado automaticamente.</span></aside>
        </section>

        {error && <div className="portal-error">{error}</div>}
        {success && <div className="workspace-success">{success}</div>}

        <div className="specialist-grid">
          <form className="specialist-request-card" onSubmit={submit}>
            <div className="strategy-section-heading"><div><small>PEDIDO DE CURADORIA</small><h2>Onde uma análise humana ajudaria?</h2></div><p>Use esta opção apenas quando a entrega já produzida exigir uma decisão adicional.</p></div>
            <label>Marca<select value={brandId} onChange={(event) => setBrandId(event.target.value)}>{dashboard.brands.map((brand) => <option key={brand.id} value={brand.id}>{brand.name}</option>)}</select></label>
            <div className="support-type-grid">{supportOptions.map((option) => <button type="button" className={type === option.id ? "selected" : ""} key={option.id} onClick={() => setType(option.id)}><strong>{option.title}</strong><span>{option.copy}</span></button>)}</div>
            <div className="support-selection"><small>SELECIONADO</small><strong>{selected?.title}</strong><span>{selected?.copy}</span></div>
            <label>Contexto do desafio<textarea className="large" required minLength={20} value={context} onChange={(event) => setContext(event.target.value)} placeholder="O que já foi produzido e qual decisão ainda precisa de uma segunda opinião?" /></label>
            <label>Resultado desejado <span>(opcional)</span><textarea value={desiredOutcome} onChange={(event) => setDesiredOutcome(event.target.value)} placeholder="Ex.: validar a mensagem, revisar a campanha, finalizar uma adaptação especial..." /></label>
            <label>Prioridade<select value={urgency} onChange={(event) => setUrgency(event.target.value as "normal" | "priority")}><option value="normal">Fluxo normal</option><option value="priority">Avaliação prioritária</option></select></label>
            {initialContentId && <div className="support-linked-content">✓ Pedido relacionado à entrega aprovada que você estava revisando.</div>}
            <button className="button button-primary button-full" disabled={submitting || !brandId}>{submitting ? "Enviando para triagem..." : "Solicitar curadoria"}</button>
            <small className="support-trust">A solicitação inicia apenas uma triagem. Serviço, prazo e preço serão apresentados antes de qualquer contratação.</small>
          </form>

          <section className="specialist-history">
            <div><small>ACOMPANHAMENTO</small><h2>Seus pedidos</h2><p>Acompanhe apenas as análises adicionais solicitadas por sua operação.</p></div>
            {requests.map((request) => (
              <article key={request.id}>
                <header><strong>{supportOptions.find((item) => item.id === request.type)?.title || "Curadoria"}</strong><span>{statusCopy[request.status]}</span></header>
                <p>{request.context}</p>
                <footer><small>{new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(request.createdAt))}</small><em>{request.pricingStatus === "under_review" ? "Escopo em análise" : "Atualização disponível"}</em></footer>
              </article>
            ))}
            {!requests.length && <div className="strategy-empty"><strong>Nenhum pedido.</strong><p>A criação e as funcionalidades da Modo devem resolver a maior parte da operação sem intervenção humana.</p></div>}
          </section>
        </div>
      </main>
    </div>
  );
}
