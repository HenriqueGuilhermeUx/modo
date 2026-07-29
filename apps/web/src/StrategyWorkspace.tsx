import type { Dashboard } from "@modo/contracts";
import type {
  BrandFoundation,
  BrandFoundationProfile,
  ChannelMap,
  ChannelPlanItem,
  RevenueMap,
} from "@modo/contracts/strategy-network";
import { useEffect, useMemo, useState } from "react";
import { getDashboard, getSessionToken } from "./api";
import {
  getBrandFoundation,
  getChannelMap,
  getRevenueMap,
  saveBrandFoundation,
  saveChannelMap,
  saveRevenueMap,
} from "./strategy-network-api";

type Tab = "foundation" | "channels" | "revenue";

const emptyFoundation = (): BrandFoundation => ({
  audience: { priority: "", context: "", pains: [], desires: [], objections: [], decisionTriggers: [] },
  worldview: { belief: "", marketProblem: "", desiredChange: "" },
  positioning: { category: "", differentiator: "", forWhom: "", notForWhom: "", territory: "" },
  promise: { transformation: "", mainBenefit: "", boundaries: "" },
  personality: { attributes: [], tone: "", preferredWords: [], prohibitedWords: [], visualStyle: "" },
  proof: { origin: "", cases: [], numbers: [], testimonials: [] },
  universe: { environments: [], people: [], objects: [], themes: [], visualReferences: [] },
  humanPresence: { spokespersons: [], team: [], customers: [], cameraAvailability: "low", notes: "" },
});

const emptyRevenue = (brandId: string): RevenueMap => ({
  organizationId: "",
  brandId,
  primaryOffer: "",
  priceContext: "",
  revenueObjective: "",
  funnelStage: "lead",
  conversionDestination: "",
  targetAudience: "",
  primaryConversion: "",
  salesOwner: "",
  monthlyBudgetCents: null,
  targetLeads: null,
  targetSales: null,
  notes: "",
  status: "draft",
  updatedAt: new Date(0).toISOString(),
});

const channelLabels: Record<ChannelPlanItem["channel"], string> = {
  instagram: "Instagram",
  facebook: "Facebook",
  linkedin: "LinkedIn",
  tiktok: "TikTok",
  youtube: "YouTube",
  whatsapp: "WhatsApp",
  email: "E-mail",
  blog: "Blog",
  other: "Outro",
};

function splitItems(value: string) {
  return value.split(/\n|,/).map((item) => item.trim()).filter(Boolean).slice(0, 20);
}

function joinItems(items: string[]) {
  return items.join("\n");
}

function defaultChannel(channel: ChannelPlanItem["channel"]): ChannelPlanItem {
  return {
    channel,
    role: "",
    primaryObjective: "",
    audience: "",
    contentPillars: [],
    formats: [],
    ctaTypes: [],
    primaryKpi: "",
    cadence: "",
    notes: "",
  };
}

export default function StrategyWorkspace() {
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [brandId, setBrandId] = useState("");
  const [tab, setTab] = useState<Tab>("foundation");
  const [foundation, setFoundation] = useState<BrandFoundation>(emptyFoundation());
  const [foundationRecord, setFoundationRecord] = useState<BrandFoundationProfile | null>(null);
  const [channelMap, setChannelMap] = useState<ChannelMap | null>(null);
  const [channels, setChannels] = useState<ChannelPlanItem[]>([]);
  const [revenue, setRevenue] = useState<RevenueMap>(() => emptyRevenue(""));
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  useEffect(() => {
    if (!getSessionToken()) {
      window.location.href = "/app";
      return;
    }
    getDashboard()
      .then((current) => {
        setDashboard(current);
        setBrandId(current.brands[0]?.id || "");
      })
      .catch((caught) => setError(caught instanceof Error ? caught.message : "Não foi possível abrir a Base Estratégica."))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!brandId) return;
    setLoading(true);
    setError("");
    Promise.all([getBrandFoundation(brandId), getChannelMap(brandId), getRevenueMap(brandId)])
      .then(([foundationValue, channelValue, revenueValue]) => {
        setFoundationRecord(foundationValue);
        setFoundation(foundationValue?.foundation || emptyFoundation());
        setChannelMap(channelValue);
        setChannels(channelValue?.channels || []);
        setRevenue(revenueValue || emptyRevenue(brandId));
      })
      .catch((caught) => setError(caught instanceof Error ? caught.message : "Não foi possível carregar a estratégia da marca."))
      .finally(() => setLoading(false));
  }, [brandId]);

  const selectedBrand = useMemo(
    () => dashboard?.brands.find((brand) => brand.id === brandId),
    [dashboard, brandId],
  );

  function patchFoundation<K extends keyof BrandFoundation>(key: K, value: BrandFoundation[K]) {
    setFoundation((current) => ({ ...current, [key]: value }));
  }

  async function saveFoundation(complete = false) {
    if (!brandId) return;
    setSaving(true);
    setError("");
    setSuccess("");
    try {
      const saved = await saveBrandFoundation({ brandId, foundation, status: complete ? "complete" : "draft" });
      setFoundationRecord(saved);
      setSuccess(complete ? "Fundação concluída e pronta para orientar a Modo." : "Rascunho da fundação salvo.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Não foi possível salvar a fundação.");
    } finally {
      setSaving(false);
    }
  }

  async function saveChannels(complete = false) {
    if (!brandId) return;
    setSaving(true);
    setError("");
    setSuccess("");
    try {
      const saved = await saveChannelMap({ brandId, channels, status: complete ? "complete" : "draft" });
      setChannelMap(saved);
      setSuccess(complete ? "Mapa de canais concluído." : "Rascunho dos canais salvo.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Não foi possível salvar os canais.");
    } finally {
      setSaving(false);
    }
  }

  async function saveRevenue(complete = false) {
    if (!brandId) return;
    setSaving(true);
    setError("");
    setSuccess("");
    try {
      const saved = await saveRevenueMap({
        brandId,
        primaryOffer: revenue.primaryOffer,
        priceContext: revenue.priceContext,
        revenueObjective: revenue.revenueObjective,
        funnelStage: revenue.funnelStage,
        conversionDestination: revenue.conversionDestination,
        targetAudience: revenue.targetAudience,
        primaryConversion: revenue.primaryConversion,
        salesOwner: revenue.salesOwner,
        monthlyBudgetCents: revenue.monthlyBudgetCents,
        targetLeads: revenue.targetLeads,
        targetSales: revenue.targetSales,
        notes: revenue.notes,
        status: complete ? "complete" : "draft",
      });
      setRevenue(saved);
      setSuccess(complete ? "Mapa de receita concluído." : "Rascunho de receita salvo.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Não foi possível salvar o mapa de receita.");
    } finally {
      setSaving(false);
    }
  }

  function addChannel(channel: ChannelPlanItem["channel"]) {
    if (channels.some((item) => item.channel === channel)) return;
    setChannels((current) => [...current, defaultChannel(channel)]);
  }

  function patchChannel(index: number, patch: Partial<ChannelPlanItem>) {
    setChannels((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item));
  }

  if (loading && !dashboard) {
    return <main className="portal-loading"><img src="/logo.svg" alt="MODO" /><div className="portal-spinner" /><p>Organizando a estratégia da marca...</p></main>;
  }

  return (
    <div className="strategy-shell">
      <header className="workspace-header">
        <a href="/app"><img src="/logo.svg" alt="MODO" /></a>
        <nav><a href="/app">Painel</a><a className="active" href="/app/base">Base estratégica</a><a href="/app/director">Diretor</a><a href="/app/content">Criar</a><a href="/app/especialista">Apoio humano</a></nav>
        <div className="workspace-balance"><small>Marca</small><strong>{selectedBrand?.name || "MODO"}</strong><span>memória estratégica</span></div>
      </header>

      <main className="strategy-main">
        <section className="strategy-hero">
          <div><div className="section-kicker">MODO BASE</div><h1>A estratégia que orienta tudo o que a Modo cria.</h1><p>Organize marca, canais e receita uma vez. A Modo usa essa memória para reduzir briefing, evitar conteúdo genérico e conectar criação a resultado.</p></div>
          <div className="strategy-brand-picker"><label>Marca<select value={brandId} onChange={(event) => setBrandId(event.target.value)}>{dashboard?.brands.map((brand) => <option key={brand.id} value={brand.id}>{brand.name}</option>)}</select></label><a href="/app/especialista">Solicitar apoio de um especialista</a></div>
        </section>

        <div className="strategy-tabs">
          <button className={tab === "foundation" ? "active" : ""} onClick={() => setTab("foundation")}><span>01</span>Marca <small>{foundationRecord?.status === "complete" ? "Concluído" : "Em construção"}</small></button>
          <button className={tab === "channels" ? "active" : ""} onClick={() => setTab("channels")}><span>02</span>Canais <small>{channelMap?.status === "complete" ? "Concluído" : "Em construção"}</small></button>
          <button className={tab === "revenue" ? "active" : ""} onClick={() => setTab("revenue")}><span>03</span>Receita <small>{revenue.status === "complete" ? "Concluído" : "Em construção"}</small></button>
        </div>

        {error && <div className="portal-error">{error}</div>}
        {success && <div className="workspace-success">{success}</div>}

        {tab === "foundation" && (
          <section className="strategy-card">
            <div className="strategy-section-heading"><div><small>FUNDAÇÃO DA MARCA</small><h2>O que a marca representa e para quem existe</h2></div><p>Não precisa ficar perfeito na primeira vez. Salve como rascunho e evolua com aprendizados reais.</p></div>
            <div className="strategy-form-grid">
              <label className="wide">Público prioritário<textarea value={foundation.audience.priority} onChange={(event) => patchFoundation("audience", { ...foundation.audience, priority: event.target.value })} placeholder="Quem queremos atrair primeiro e em qual momento?" /></label>
              <label>Principais dores<textarea value={joinItems(foundation.audience.pains)} onChange={(event) => patchFoundation("audience", { ...foundation.audience, pains: splitItems(event.target.value) })} placeholder="Uma por linha" /></label>
              <label>Desejos e resultados<textarea value={joinItems(foundation.audience.desires)} onChange={(event) => patchFoundation("audience", { ...foundation.audience, desires: splitItems(event.target.value) })} placeholder="Uma por linha" /></label>
              <label>Objeções<textarea value={joinItems(foundation.audience.objections)} onChange={(event) => patchFoundation("audience", { ...foundation.audience, objections: splitItems(event.target.value) })} /></label>
              <label>Gatilhos de decisão<textarea value={joinItems(foundation.audience.decisionTriggers)} onChange={(event) => patchFoundation("audience", { ...foundation.audience, decisionTriggers: splitItems(event.target.value) })} /></label>
              <label className="wide">Visão de mundo<textarea value={foundation.worldview.belief} onChange={(event) => patchFoundation("worldview", { ...foundation.worldview, belief: event.target.value })} placeholder="No que a marca acredita?" /></label>
              <label>Problema no mercado<textarea value={foundation.worldview.marketProblem} onChange={(event) => patchFoundation("worldview", { ...foundation.worldview, marketProblem: event.target.value })} /></label>
              <label>Mudança desejada<textarea value={foundation.worldview.desiredChange} onChange={(event) => patchFoundation("worldview", { ...foundation.worldview, desiredChange: event.target.value })} /></label>
              <label>Categoria e território<textarea value={foundation.positioning.category} onChange={(event) => patchFoundation("positioning", { ...foundation.positioning, category: event.target.value })} /></label>
              <label>Diferencial<textarea value={foundation.positioning.differentiator} onChange={(event) => patchFoundation("positioning", { ...foundation.positioning, differentiator: event.target.value })} /></label>
              <label>Para quem é<textarea value={foundation.positioning.forWhom} onChange={(event) => patchFoundation("positioning", { ...foundation.positioning, forWhom: event.target.value })} /></label>
              <label>Para quem não é<textarea value={foundation.positioning.notForWhom} onChange={(event) => patchFoundation("positioning", { ...foundation.positioning, notForWhom: event.target.value })} /></label>
              <label>Transformação prometida<textarea value={foundation.promise.transformation} onChange={(event) => patchFoundation("promise", { ...foundation.promise, transformation: event.target.value })} /></label>
              <label>Benefício principal<textarea value={foundation.promise.mainBenefit} onChange={(event) => patchFoundation("promise", { ...foundation.promise, mainBenefit: event.target.value })} /></label>
              <label>Tom de voz<textarea value={foundation.personality.tone} onChange={(event) => patchFoundation("personality", { ...foundation.personality, tone: event.target.value })} /></label>
              <label>Atributos da personalidade<textarea value={joinItems(foundation.personality.attributes)} onChange={(event) => patchFoundation("personality", { ...foundation.personality, attributes: splitItems(event.target.value) })} /></label>
              <label>História e origem<textarea value={foundation.proof.origin} onChange={(event) => patchFoundation("proof", { ...foundation.proof, origin: event.target.value })} /></label>
              <label>Casos e provas<textarea value={joinItems(foundation.proof.cases)} onChange={(event) => patchFoundation("proof", { ...foundation.proof, cases: splitItems(event.target.value) })} /></label>
              <label>Universo visual<textarea value={foundation.personality.visualStyle} onChange={(event) => patchFoundation("personality", { ...foundation.personality, visualStyle: event.target.value })} placeholder="Fotografia, cores, ambiente e sensação" /></label>
              <label>Porta-vozes<textarea value={joinItems(foundation.humanPresence.spokespersons)} onChange={(event) => patchFoundation("humanPresence", { ...foundation.humanPresence, spokespersons: splitItems(event.target.value) })} /></label>
              <label>Disponibilidade para câmera<select value={foundation.humanPresence.cameraAvailability} onChange={(event) => patchFoundation("humanPresence", { ...foundation.humanPresence, cameraAvailability: event.target.value as BrandFoundation["humanPresence"]["cameraAvailability"] })}><option value="none">Não queremos aparecer</option><option value="low">Baixa</option><option value="medium">Média</option><option value="high">Alta</option></select></label>
            </div>
            <div className="strategy-actions"><button className="button button-outline" disabled={saving} onClick={() => void saveFoundation(false)}>Salvar rascunho</button><button className="button button-primary" disabled={saving} onClick={() => void saveFoundation(true)}>{saving ? "Salvando..." : "Concluir fundação"}</button></div>
          </section>
        )}

        {tab === "channels" && (
          <section className="strategy-card">
            <div className="strategy-section-heading"><div><small>MAPA DE CANAIS</small><h2>Cada canal com uma função clara</h2></div><p>A Modo adapta a mensagem ao papel do canal, em vez de repetir o mesmo post em todos os lugares.</p></div>
            <div className="channel-add-row">{(Object.keys(channelLabels) as ChannelPlanItem["channel"][]).map((channel) => <button key={channel} disabled={channels.some((item) => item.channel === channel)} onClick={() => addChannel(channel)}>+ {channelLabels[channel]}</button>)}</div>
            <div className="channel-map-list">
              {channels.map((channel, index) => (
                <article key={channel.channel}>
                  <header><div><small>CANAL {String(index + 1).padStart(2, "0")}</small><h3>{channelLabels[channel.channel]}</h3></div><button onClick={() => setChannels((current) => current.filter((_, itemIndex) => itemIndex !== index))}>Remover</button></header>
                  <div className="strategy-form-grid">
                    <label>Função no ecossistema<textarea value={channel.role} onChange={(event) => patchChannel(index, { role: event.target.value })} placeholder="Descoberta, autoridade, relacionamento, conversão..." /></label>
                    <label>Objetivo principal<textarea value={channel.primaryObjective} onChange={(event) => patchChannel(index, { primaryObjective: event.target.value })} /></label>
                    <label>Público deste canal<textarea value={channel.audience} onChange={(event) => patchChannel(index, { audience: event.target.value })} /></label>
                    <label>Pilares de conteúdo<textarea value={joinItems(channel.contentPillars)} onChange={(event) => patchChannel(index, { contentPillars: splitItems(event.target.value) })} /></label>
                    <label>Formatos<textarea value={joinItems(channel.formats)} onChange={(event) => patchChannel(index, { formats: splitItems(event.target.value) })} /></label>
                    <label>Chamadas para ação<textarea value={joinItems(channel.ctaTypes)} onChange={(event) => patchChannel(index, { ctaTypes: splitItems(event.target.value) })} /></label>
                    <label>Indicador principal<input value={channel.primaryKpi} onChange={(event) => patchChannel(index, { primaryKpi: event.target.value })} /></label>
                    <label>Cadência<input value={channel.cadence} onChange={(event) => patchChannel(index, { cadence: event.target.value })} placeholder="Ex.: 3 vezes por semana" /></label>
                  </div>
                </article>
              ))}
              {!channels.length && <div className="strategy-empty"><strong>Escolha o primeiro canal.</strong><p>Comece somente pelos canais que a operação consegue sustentar.</p></div>}
            </div>
            <div className="strategy-actions"><button className="button button-outline" disabled={saving} onClick={() => void saveChannels(false)}>Salvar rascunho</button><button className="button button-primary" disabled={saving || !channels.length} onClick={() => void saveChannels(true)}>{saving ? "Salvando..." : "Concluir mapa de canais"}</button></div>
          </section>
        )}

        {tab === "revenue" && (
          <section className="strategy-card">
            <div className="strategy-section-heading"><div><small>MAPA DE OFERTA E RECEITA</small><h2>O que a comunicação precisa transformar em resultado</h2></div><p>Não é uma promessa de faturamento. É o contexto comercial necessário para a Modo criar campanhas com direção.</p></div>
            <div className="strategy-form-grid">
              <label className="wide">Oferta principal<textarea value={revenue.primaryOffer} onChange={(event) => setRevenue({ ...revenue, primaryOffer: event.target.value })} placeholder="Produto, serviço, proposta de valor e condição atual" /></label>
              <label>Faixa de preço<input value={revenue.priceContext} onChange={(event) => setRevenue({ ...revenue, priceContext: event.target.value })} placeholder="Ex.: a partir de R$ 299" /></label>
              <label>Estágio do funil<select value={revenue.funnelStage} onChange={(event) => setRevenue({ ...revenue, funnelStage: event.target.value as RevenueMap["funnelStage"] })}><option value="awareness">Descoberta</option><option value="consideration">Consideração</option><option value="lead">Lead</option><option value="opportunity">Oportunidade</option><option value="sale">Venda</option><option value="retention">Retenção</option></select></label>
              <label className="wide">Objetivo comercial<textarea value={revenue.revenueObjective} onChange={(event) => setRevenue({ ...revenue, revenueObjective: event.target.value })} /></label>
              <label>Público da oferta<textarea value={revenue.targetAudience} onChange={(event) => setRevenue({ ...revenue, targetAudience: event.target.value })} /></label>
              <label>Conversão principal<textarea value={revenue.primaryConversion} onChange={(event) => setRevenue({ ...revenue, primaryConversion: event.target.value })} placeholder="Compra, reunião, orçamento, cadastro..." /></label>
              <label>Destino da conversão<textarea value={revenue.conversionDestination} onChange={(event) => setRevenue({ ...revenue, conversionDestination: event.target.value })} placeholder="Site, WhatsApp, checkout, formulário..." /></label>
              <label>Responsável comercial<input value={revenue.salesOwner} onChange={(event) => setRevenue({ ...revenue, salesOwner: event.target.value })} /></label>
              <label>Orçamento mensal disponível (R$)<input type="number" min="0" step="0.01" value={revenue.monthlyBudgetCents === null ? "" : revenue.monthlyBudgetCents / 100} onChange={(event) => setRevenue({ ...revenue, monthlyBudgetCents: event.target.value ? Math.round(Number(event.target.value) * 100) : null })} /></label>
              <label>Meta de leads<input type="number" min="0" value={revenue.targetLeads ?? ""} onChange={(event) => setRevenue({ ...revenue, targetLeads: event.target.value ? Number(event.target.value) : null })} /></label>
              <label>Meta de vendas<input type="number" min="0" value={revenue.targetSales ?? ""} onChange={(event) => setRevenue({ ...revenue, targetSales: event.target.value ? Number(event.target.value) : null })} /></label>
              <label className="wide">Observações<textarea value={revenue.notes} onChange={(event) => setRevenue({ ...revenue, notes: event.target.value })} placeholder="Sazonalidade, capacidade de atendimento, restrições e premissas" /></label>
            </div>
            <div className="strategy-actions"><button className="button button-outline" disabled={saving} onClick={() => void saveRevenue(false)}>Salvar rascunho</button><button className="button button-primary" disabled={saving} onClick={() => void saveRevenue(true)}>{saving ? "Salvando..." : "Concluir mapa de receita"}</button></div>
          </section>
        )}
      </main>
    </div>
  );
}
