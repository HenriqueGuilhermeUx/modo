import type { Dashboard } from "@modo/contracts";
import type { HumanSupportRequest, HumanSupportType } from "@modo/contracts/strategy-network";
import { type FormEvent, useEffect, useMemo, useState } from "react";
import { getDashboard, getSessionToken } from "./api";
import { createHumanSupportRequest, listHumanSupportRequests } from "./strategy-network-api";

const supportOptions: Array<{ id: HumanSupportType; title: string; copy: string }> = [
  { id: "strategy", title: "Estratégia", copy: "Revisar posicionamento, campanha, canais, oferta e prioridades." },
  { id: "art_direction", title: "Direção de arte", copy: "Elevar conceito visual, identidade e consistência da campanha." },
  { id: "copywriting", title: "Copywriting", copy: "Refinar mensagem, argumento, oferta, roteiro e chamada para ação." },
  { id: "design", title: "Design", copy: "Finalizar peças especiais ou adaptar entregas fora dos templates." },
  { id: "motion", title: "Motion", copy: "Transformar a campanha em animações e peças com movimento." },
  { id: "video_editing", title: "Edição de vídeo", copy: "Editar captação, cortes, ritmo, legenda e versões por canal." },
  { id: "paid_media", title: "Mídia paga", copy: "Estruturar, acompanhar ou revisar campanhas de anúncios." },
  { id: "campaign_review", title: "Revisão de campanha", copy: "Receber uma segunda camada humana antes de publicar ou investir." },
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
    Promise.all([getDashboard(), listHumanSupportRequests()])
      .then(([currentDashboard, currentRequests]) => {
        setDashboard(currentDashboard);
        setBrandId(currentDashboard.brands[0]?.id || "");
        setRequests(currentRequests);
      })
      .catch((caught) => setError(caught instanceof Error ? caught.message : "Não foi possível abrir o apoio humano."))
      .finally(() => setLoading(false));
  }, []);

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
      setSuccess("Pedido recebido. A Modo fará a triagem antes de indicar escopo, profissional e eventual investimento.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Não foi possível enviar o pedido.");
    } finally {
      setSubmitting(false);
    }
  }

  if (loading || !dashboard) {
    return <main className="portal-loading"><img src="/logo.svg" alt="MODO" /><div className="portal-spinner" /><p>Preparando o apoio da Modo...</p>{error && <div className="portal-error">{error}</div>}</main>;
  }

  return (
    <div className="specialist-shell">
      <header className="workspace-header">
        <a href="/app"><img src="/logo.svg" alt="MODO" /></a>
        <nav><a href="/app">Painel</a><a href="/app/base">Base estratégica</a><a href="/app/content">Criar</a><a className="active" href="/app/especialista">Apoio humano</a></nav>
        <div className="workspace-balance"><small>Camada</small><strong>Modo Especialista</strong><span>curadoria humana</span></div>
      </header>

      <main className="specialist-main">
        <section className="specialist-hero">
          <div><div className="section-kicker">MODO ESPECIALISTA</div><h1>Quando o desafio pede uma segunda camada.</h1><p>A Modo já organiza estratégia, criação e produção. Quando houver complexidade, escala ou uma decisão importante, você poderá pedir avaliação humana sem sair da operação.</p></div>
          <aside><strong>Como funciona</strong><span>1. Você descreve o desafio.</span><span>2. A Modo faz a triagem.</span><span>3. Apresentamos disponibilidade e escopo.</span><span>4. Nada é contratado ou cobrado automaticamente.</span></aside>
        </section>

        {error && <div className="portal-error">{error}</div>}
        {success && <div className="workspace-success">{success}</div>}

        <div className="specialist-grid">
          <form className="specialist-request-card" onSubmit={submit}>
            <div className="strategy-section-heading"><div><small>NOVO PEDIDO</small><h2>Qual apoio faria diferença agora?</h2></div><p>Não é necessário saber qual profissional contratar. Explique o resultado esperado.</p></div>
            <label>Marca<select value={brandId} onChange={(event) => setBrandId(event.target.value)}>{dashboard.brands.map((brand) => <option key={brand.id} value={brand.id}>{brand.name}</option>)}</select></label>
            <div className="support-type-grid">{supportOptions.map((option) => <button type="button" className={type === option.id ? "selected" : ""} key={option.id} onClick={() => setType(option.id)}><strong>{option.title}</strong><span>{option.copy}</span></button>)}</div>
            <div className="support-selection"><small>SELECIONADO</small><strong>{selected?.title}</strong><span>{selected?.copy}</span></div>
            <label>Contexto do desafio<textarea className="large" required minLength={20} value={context} onChange={(event) => setContext(event.target.value)} placeholder="O que já foi feito, onde está a dificuldade e o que precisa ser analisado?" /></label>
            <label>Resultado desejado <span>(opcional)</span><textarea value={desiredOutcome} onChange={(event) => setDesiredOutcome(event.target.value)} placeholder="Ex.: campanha pronta para investir, vídeo finalizado, posicionamento revisado..." /></label>
            <label>Prioridade<select value={urgency} onChange={(event) => setUrgency(event.target.value as "normal" | "priority")}><option value="normal">Fluxo normal</option><option value="priority">Preciso avaliar com prioridade</option></select></label>
            {initialContentId && <div className="support-linked-content">✓ Este pedido será relacionado ao conteúdo aprovado que você estava revisando.</div>}
            <button className="button button-primary button-full" disabled={submitting || !brandId}>{submitting ? "Enviando para triagem..." : "Solicitar avaliação humana"}</button>
            <small className="support-trust">A solicitação é gratuita. Eventual serviço, prazo e preço serão apresentados antes de qualquer contratação.</small>
          </form>

          <section className="specialist-history">
            <div><small>ACOMPANHAMENTO</small><h2>Seus pedidos</h2><p>Aqui você acompanha a triagem e o andamento sem conversas espalhadas.</p></div>
            {requests.map((request) => (
              <article key={request.id}>
                <header><strong>{supportOptions.find((item) => item.id === request.type)?.title || "Apoio especializado"}</strong><span>{statusCopy[request.status]}</span></header>
                <p>{request.context}</p>
                <footer><small>{new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(request.createdAt))}</small><em>{request.pricingStatus === "under_review" ? "Escopo e preço em análise" : "Atualização disponível"}</em></footer>
              </article>
            ))}
            {!requests.length && <div className="strategy-empty"><strong>Nenhum pedido ainda.</strong><p>Use o apoio humano somente quando ele realmente elevar o resultado.</p></div>}
          </section>
        </div>
      </main>
    </div>
  );
}
