import type { Dashboard } from "@modo/contracts";
import type { ContentRequest } from "@modo/contracts/content";
import type { CreativeChannel } from "@modo/contracts/creative-intelligence";
import type { PerformanceSummary } from "@modo/contracts/signal";
import { useEffect, useMemo, useState } from "react";
import { getDashboard, getSessionToken, listContentRequests } from "./api";
import { getPerformanceSummary, recordPerformanceSignal } from "./signal-api";

const channelLabels: Record<CreativeChannel, string> = {
  instagram: "Instagram",
  facebook: "Facebook",
  linkedin: "LinkedIn",
  reels: "Reels",
  stories: "Stories",
  youtube_shorts: "YouTube Shorts",
  tiktok: "TikTok",
  whatsapp: "WhatsApp",
  blog: "Blog",
  email: "E-mail",
  website: "Site",
};

const channelAliases: Record<string, CreativeChannel> = {
  instagram: "instagram",
  facebook: "facebook",
  linkedin: "linkedin",
  reels: "reels",
  reel: "reels",
  stories: "stories",
  story: "stories",
  "youtube shorts": "youtube_shorts",
  youtube: "youtube_shorts",
  tiktok: "tiktok",
  whatsapp: "whatsapp",
  zap: "whatsapp",
  blog: "blog",
  email: "email",
  "e-mail": "email",
  site: "website",
  website: "website",
};

function normalizeChannel(value: string): CreativeChannel {
  return channelAliases[value.trim().toLowerCase()] ?? "instagram";
}

type Metrics = {
  reach: number;
  impressions: number;
  engagements: number;
  clicks: number;
  leads: number;
  conversions: number;
  revenue: number;
  notes: string;
};

const emptyMetrics: Metrics = {
  reach: 0,
  impressions: 0,
  engagements: 0,
  clicks: 0,
  leads: 0,
  conversions: 0,
  revenue: 0,
  notes: "",
};

const money = (cents: number) => (cents / 100).toLocaleString("pt-BR", {
  style: "currency",
  currency: "BRL",
});

export default function SignalWorkspace() {
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [requests, setRequests] = useState<ContentRequest[]>([]);
  const [brandId, setBrandId] = useState("");
  const [summary, setSummary] = useState<PerformanceSummary | null>(null);
  const [selectedId, setSelectedId] = useState("");
  const [metrics, setMetrics] = useState<Metrics>(emptyMetrics);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  useEffect(() => {
    if (!getSessionToken()) {
      window.location.href = "/app";
      return;
    }
    Promise.all([getDashboard(), listContentRequests()])
      .then(([currentDashboard, currentRequests]) => {
        setDashboard(currentDashboard);
        setRequests(currentRequests);
        const rawPrefill = window.sessionStorage.getItem("modo.signalPrefill");
        if (rawPrefill) {
          try {
            const prefill = JSON.parse(rawPrefill) as { brandId?: string; contentRequestId?: string };
            setBrandId(prefill.brandId || currentDashboard.brands[0]?.id || "");
            setSelectedId(prefill.contentRequestId || "");
          } catch { setBrandId(currentDashboard.brands[0]?.id || ""); }
          window.sessionStorage.removeItem("modo.signalPrefill");
        } else { setBrandId(currentDashboard.brands[0]?.id || ""); }
      })
      .catch((caught) => setError(caught instanceof Error ? caught.message : "Não foi possível abrir o MODO Signal."))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!brandId) return;
    void getPerformanceSummary(brandId)
      .then(setSummary)
      .catch((caught) => setError(caught instanceof Error ? caught.message : "Não foi possível carregar os sinais."));
  }, [brandId]);

  const eligible = useMemo(
    () => requests.filter((item) => item.brandId === brandId && ["approved", "ready"].includes(item.status) && item.output),
    [requests, brandId],
  );

  const selected = eligible.find((item) => item.id === selectedId);

  function setMetric<K extends keyof Metrics>(key: K, value: Metrics[K]) {
    setMetrics((current) => ({ ...current, [key]: value }));
  }

  async function saveSignal() {
    if (!selected) return;
    setSaving(true);
    setError("");
    setSuccess("");
    try {
      const result = await recordPerformanceSignal({
        brandId,
        contentRequestId: selected.id,
        channel: normalizeChannel(selected.channel),
        reach: metrics.reach,
        impressions: metrics.impressions,
        engagements: metrics.engagements,
        clicks: metrics.clicks,
        leads: metrics.leads,
        conversions: metrics.conversions,
        revenueCents: Math.round(metrics.revenue * 100),
        notes: metrics.notes,
      });
      setSummary(await getPerformanceSummary(brandId));
      setMetrics(emptyMetrics);
      setSelectedId("");
      setSuccess(`Sinal registrado com nota ${result.score}/100. A MODO usará esse resultado nos próximos planos.`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Não foi possível registrar o desempenho.");
    } finally {
      setSaving(false);
    }
  }

  if (loading && !dashboard) {
    return <main className="portal-loading"><img src="/logo.svg" alt="MODO" /><div className="portal-spinner" /><p>Lendo os sinais da presença...</p></main>;
  }

  if (!dashboard) {
    return <main className="portal-loading"><p>{error || "Sua sessão expirou."}</p><a className="button button-primary" href="/app">Entrar novamente</a></main>;
  }

  return (
    <div className="signal-shell">
      <header className="workspace-header">
        <a href="/app"><img src="/logo.svg" alt="MODO" /></a>
        <nav><a href="/app">Painel</a><a href="/app/week">Minha semana</a><a href="/app/director">Diretor</a><a href="/app/content">Criar</a><a href="/app/linkedin">LinkedIn</a><a className="active" href="/app/signal">Signal</a><a href="/app/planos">Planos</a></nav>
        <div className="workspace-balance"><small>Saldo</small><strong>{dashboard.usage.creditsRemaining}</strong><span>créditos</span></div>
      </header>

      <main className="signal-main">
        <section className="signal-hero">
          <div><div className="section-kicker">MODO SIGNAL</div><h1>A MODO aprende com o que o público faz — não apenas com o que a IA escreve.</h1><p>Registre alcance, engajamento, leads, conversões e receita. O desempenho entra na memória criativa e altera a prioridade dos próximos formatos, canais e movimentos.</p></div>
          <label>Marca<select value={brandId} onChange={(event) => setBrandId(event.target.value)}>{dashboard.brands.map((brand) => <option key={brand.id} value={brand.id}>{brand.name}</option>)}</select></label>
        </section>

        {error && <div className="portal-error">{error}</div>}
        {success && <div className="workspace-success">{success}</div>}

        {summary && (
          <section className="signal-summary">
            <article><small>SINAIS REGISTRADOS</small><strong>{summary.totalSignals}</strong><span>conteúdos medidos</span></article>
            <article><small>NOTA MÉDIA</small><strong>{summary.averageScore}</strong><span>de 100</span></article>
            <article><small>RESULTADOS POSITIVOS</small><strong>{summary.positiveSignals}</strong><span>padrões reforçados</span></article>
            <article><small>CONVERSÕES</small><strong>{summary.channels.reduce((total, channel) => total + channel.conversions, 0)}</strong><span>{money(summary.channels.reduce((total, channel) => total + channel.revenueCents, 0))}</span></article>
          </section>
        )}

        <div className="signal-grid">
          <section className="signal-record">
            <div className="signal-section-head"><small>ALIMENTAR A INTELIGÊNCIA</small><h2>Como este conteúdo performou?</h2><p>Use dados da própria rede, CRM ou equipe comercial. Você pode atualizar o mesmo conteúdo depois.</p></div>

            <label>Conteúdo publicado<select value={selectedId} onChange={(event) => setSelectedId(event.target.value)}><option value="">Selecione...</option>{eligible.map((request) => <option key={request.id} value={request.id}>{request.output?.hook.slice(0, 80)} · {request.channel}</option>)}</select></label>

            {selected ? (
              <>
                <div className="signal-selected"><small>{selected.channel}</small><strong>{selected.output?.hook}</strong><p>{selected.output?.caption.slice(0, 220)}</p></div>
                <div className="signal-metrics-grid">
                  <label>Alcance<input type="number" min="0" value={metrics.reach} onChange={(event) => setMetric("reach", Number(event.target.value))} /></label>
                  <label>Impressões<input type="number" min="0" value={metrics.impressions} onChange={(event) => setMetric("impressions", Number(event.target.value))} /></label>
                  <label>Engajamentos<input type="number" min="0" value={metrics.engagements} onChange={(event) => setMetric("engagements", Number(event.target.value))} /></label>
                  <label>Cliques<input type="number" min="0" value={metrics.clicks} onChange={(event) => setMetric("clicks", Number(event.target.value))} /></label>
                  <label>Leads<input type="number" min="0" value={metrics.leads} onChange={(event) => setMetric("leads", Number(event.target.value))} /></label>
                  <label>Conversões<input type="number" min="0" value={metrics.conversions} onChange={(event) => setMetric("conversions", Number(event.target.value))} /></label>
                  <label>Receita atribuída (R$)<input type="number" min="0" step="0.01" value={metrics.revenue} onChange={(event) => setMetric("revenue", Number(event.target.value))} /></label>
                </div>
                <label>Observação qualitativa<textarea value={metrics.notes} onChange={(event) => setMetric("notes", event.target.value)} placeholder="Ex.: gerou comentários de clientes ideais, a abertura prendeu atenção, a oferta ficou pouco clara..." /></label>
                <button className="button button-primary button-full" disabled={saving} onClick={() => void saveSignal()}>{saving ? "Analisando sinal..." : "Registrar e ensinar a MODO"}</button>
              </>
            ) : <div className="signal-empty"><strong>Escolha um conteúdo aprovado.</strong><p>Conteúdos prontos e aprovados da marca aparecerão aqui.</p></div>}
          </section>

          <section className="signal-learning">
            <div className="signal-section-head"><small>O QUE A MODO APRENDEU</small><h2>Leitura do desempenho</h2></div>
            {summary?.insights.map((insight, index) => <article className="signal-insight" key={insight}><span>{String(index + 1).padStart(2, "0")}</span><p>{insight}</p></article>)}

            <div className="signal-channel-table">
              <div><strong>Canal</strong><strong>Nota</strong><strong>Leads</strong><strong>Receita</strong></div>
              {summary?.channels.map((channel) => <div key={channel.channel}><span>{channelLabels[channel.channel]}</span><b>{channel.averageScore}/100</b><span>{channel.leads}</span><span>{money(channel.revenueCents)}</span></div>)}
              {summary?.channels.length === 0 && <p>Nenhum canal medido ainda.</p>}
            </div>

            <a className="button button-outline button-full" href="/app/director">Gerar novo plano com estes sinais</a>
          </section>
        </div>

        <section className="signal-recent">
          <div className="signal-section-head"><small>HISTÓRICO DE APRENDIZADO</small><h2>Sinais recentes</h2></div>
          {summary?.recent.length ? <div>{summary.recent.map((item) => <article key={item.id}><span className={item.classification}>{item.score}</span><div><strong>{channelLabels[item.channel]}</strong><small>{new Date(item.createdAt).toLocaleString("pt-BR")}</small></div><p>{item.leads} leads · {item.conversions} conversões · {money(item.revenueCents)}</p></article>)}</div> : <p>Nenhum sinal registrado.</p>}
        </section>
      </main>
    </div>
  );
}
