import type { Dashboard } from "@modo/contracts";
import type {
  NativeBrandInsight,
  NativeCalendarItem,
  NativeConnection,
  NativePublication,
  NativePublisherProvider,
} from "@modo/contracts/native-publisher";
import { useEffect, useMemo, useState } from "react";
import { getDashboard, getSessionToken } from "./api";
import {
  cancelNativePublication,
  getNativeBrandInsight,
  getNativeCalendar,
  getPublisherHealth,
  importInstagramConnection,
  importLinkedInConnection,
  listNativeConnections,
  listNativePublications,
  refreshNativeAnalytics,
  retryNativePublication,
  startNativeConnection,
  type PublisherHealth,
} from "./native-publisher-api";

const providerLabels: Record<NativePublisherProvider, string> = {
  instagram: "Instagram",
  facebook: "Facebook Pages",
  threads: "Threads",
  linkedin: "LinkedIn",
};

function statusLabel(status: NativePublication["status"]) {
  const labels: Record<NativePublication["status"], string> = {
    draft: "Rascunho",
    scheduled: "Agendado",
    publishing: "Publicando",
    published: "Publicado",
    retrying: "Nova tentativa",
    failed: "Falhou",
    cancelled: "Cancelado",
  };
  return labels[status];
}

export default function PublisherWorkspace() {
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [health, setHealth] = useState<PublisherHealth | null>(null);
  const [brandId, setBrandId] = useState("");
  const [connections, setConnections] = useState<NativeConnection[]>([]);
  const [publications, setPublications] = useState<NativePublication[]>([]);
  const [calendar, setCalendar] = useState<NativeCalendarItem[]>([]);
  const [insight, setInsight] = useState<NativeBrandInsight | null>(null);
  const [working, setWorking] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  const selectedBrand = useMemo(() => dashboard?.brands.find((brand) => brand.id === brandId) || null, [dashboard, brandId]);

  async function load(targetBrandId?: string) {
    setLoading(true);
    try {
      const [currentDashboard, currentHealth] = await Promise.all([getDashboard(), getPublisherHealth()]);
      const requested = targetBrandId || new URLSearchParams(window.location.search).get("brand") || currentDashboard.brands[0]?.id || "";
      setDashboard(currentDashboard);
      setHealth(currentHealth);
      setBrandId(requested);
      if (requested) {
        const [currentConnections, currentPublications, currentCalendar, currentInsight] = await Promise.all([
          listNativeConnections(requested),
          listNativePublications(requested),
          getNativeCalendar(requested),
          getNativeBrandInsight(requested),
        ]);
        setConnections(currentConnections);
        setPublications(currentPublications);
        setCalendar(currentCalendar);
        setInsight(currentInsight);
      }
      setError("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Não foi possível carregar o Publisher.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!getSessionToken()) {
      window.location.href = "/app";
      return;
    }
    const query = new URLSearchParams(window.location.search);
    for (const provider of ["facebook", "threads"] as const) {
      if (query.get(provider) === "connected") setMessage(`${providerLabels[provider]} conectado com sucesso.`);
      if (query.get(provider) === "error") setError(query.get("message") || `Não foi possível conectar ${providerLabels[provider]}.`);
    }
    void load();
  }, []);

  async function switchBrand(next: string) {
    setBrandId(next);
    window.history.replaceState({}, "", `/app/publisher?brand=${encodeURIComponent(next)}`);
    await load(next);
  }

  async function syncExisting(provider: "instagram" | "linkedin") {
    if (!brandId) return;
    setWorking(`sync-${provider}`);
    setError("");
    try {
      if (provider === "instagram") await importInstagramConnection(brandId);
      else await importLinkedInConnection(brandId);
      setMessage(`${providerLabels[provider]} vinculado a ${selectedBrand?.name || "esta marca"}.`);
      await load(brandId);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Não foi possível importar a conexão.");
    } finally {
      setWorking("");
    }
  }

  async function connect(provider: "facebook" | "threads") {
    if (!brandId) return;
    setWorking(`connect-${provider}`);
    setError("");
    try {
      const result = await startNativeConnection(provider, brandId);
      window.location.assign(result.authorizationUrl);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : `Não foi possível iniciar ${providerLabels[provider]}.`);
      setWorking("");
    }
  }

  async function publicationAction(id: string, action: "retry" | "cancel" | "analytics") {
    setWorking(`${action}-${id}`);
    setError("");
    try {
      if (action === "retry") await retryNativePublication(id);
      if (action === "cancel") await cancelNativePublication(id);
      if (action === "analytics") {
        const snapshot = await refreshNativeAnalytics(id);
        setMessage(`Performance atualizada: ${snapshot.score}/100 · ${snapshot.learningSignal === "performed_well" ? "sinal positivo" : snapshot.learningSignal === "performed_poorly" ? "sinal de revisão" : "neutro"}.`);
      }
      await load(brandId);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Não foi possível concluir a ação.");
    } finally {
      setWorking("");
    }
  }

  if (loading && !dashboard) return <main className="portal-loading"><img src="/logo.svg" alt="MODO" /><div className="portal-spinner" /><p>Preparando a Central de Publicação...</p></main>;
  if (!dashboard) return <main className="portal-loading"><p>{error || "Sua sessão expirou."}</p><a className="button button-primary" href="/app">Voltar</a></main>;

  return (
    <div className="publisher-shell">
      <header className="workspace-header">
        <a href="/app"><img src="/logo.svg" alt="MODO" /></a>
        <nav><a href="/app">Painel</a><a href="/app/content">Criar</a><a className="active" href="/app/publisher">Publisher</a><a href="/app/settings/integrations">Integrações</a></nav>
        <div className="workspace-balance"><small>Saldo</small><strong>{dashboard.usage.creditsRemaining}</strong><span>créditos</span></div>
      </header>

      <main className="publisher-main">
        <section className="publisher-hero">
          <div>
            <div className="section-kicker">MODO PUBLISHER · DISTRIBUIÇÃO + LEARNING</div>
            <h1>Publique. Meça. Aprenda. Faça melhor.</h1>
            <p>Uma única operação para conectar canais, agendar, recuperar falhas e transformar performance real em próxima decisão criativa.</p>
          </div>
          <label>Marca<select value={brandId} onChange={(event) => void switchBrand(event.target.value)}>{dashboard.brands.map((brand) => <option key={brand.id} value={brand.id}>{brand.name}</option>)}</select></label>
        </section>

        {message && <div className="workspace-success">{message}</div>}
        {error && <div className="portal-error">{error}</div>}

        <section className="publisher-kpis">
          <article><small>PUBLICADOS · 30D</small><strong>{insight?.publishedCount ?? 0}</strong></article>
          <article><small>AGENDADOS</small><strong>{insight?.scheduledCount ?? 0}</strong></article>
          <article><small>QUALITY MÉDIO</small><strong>{insight?.averageQualityScore ?? 0}</strong><span>/100</span></article>
          <article><small>PERFORMANCE</small><strong>{insight?.averagePerformanceScore ?? 0}</strong><span>/100</span></article>
        </section>

        <section className="publisher-recommendation">
          <div><small>PRÓXIMO MOVIMENTO</small><h2>O que os dados estão dizendo</h2></div>
          <p>{insight?.recommendation || "A MODO começa a aprender assim que as primeiras publicações geram métricas."}</p>
        </section>

        <section className="publisher-panel">
          <div className="publisher-panel-heading"><div><small>CANAIS POR MARCA</small><h2>{selectedBrand?.name || "Marca"}</h2></div><span>{connections.length} conexão(ões) no Publisher V2</span></div>
          <div className="publisher-channel-grid">
            {(["instagram", "facebook", "threads", "linkedin"] as NativePublisherProvider[]).map((provider) => {
              const connected = connections.filter((item) => item.provider === provider && item.connected);
              const configured = health?.providers[provider] ?? false;
              return (
                <article key={provider} className={connected.length ? "connected" : ""}>
                  <div><small>{provider.toUpperCase()}</small><h3>{providerLabels[provider]}</h3></div>
                  {connected.length ? <p>{connected.map((item) => item.displayName).join(" · ")}</p> : <p>{configured ? "Pronto para conectar." : "Credenciais do app ainda não configuradas."}</p>}
                  {provider === "instagram" && <button className="button button-secondary" disabled={Boolean(working)} onClick={() => void syncExisting("instagram")}>{working === "sync-instagram" ? "Vinculando..." : connected.length ? "Atualizar vínculo" : "Vincular Instagram conectado"}</button>}
                  {provider === "linkedin" && <button className="button button-secondary" disabled={Boolean(working)} onClick={() => void syncExisting("linkedin")}>{working === "sync-linkedin" ? "Vinculando..." : connected.length ? "Atualizar vínculo" : "Vincular LinkedIn conectado"}</button>}
                  {provider === "facebook" && <button className="button button-secondary" disabled={!configured || Boolean(working)} onClick={() => void connect("facebook")}>{working === "connect-facebook" ? "Abrindo Meta..." : "Conectar Facebook Pages"}</button>}
                  {provider === "threads" && <button className="button button-secondary" disabled={!configured || Boolean(working)} onClick={() => void connect("threads")}>{working === "connect-threads" ? "Abrindo Threads..." : "Conectar Threads"}</button>}
                </article>
              );
            })}
          </div>
        </section>

        <section className="publisher-panel">
          <div className="publisher-panel-heading"><div><small>CALENDÁRIO EDITORIAL</small><h2>Distribuição programada</h2></div><span>{calendar.length} item(ns)</span></div>
          <div className="publisher-calendar">
            {calendar.length === 0 && <div className="publisher-empty">Nenhuma publicação no período. Aprove conteúdo e escolha <strong>Agendar</strong>.</div>}
            {calendar.map((item) => (
              <article key={item.publicationId}>
                <time>{new Date(item.scheduledFor || item.publishedAt || Date.now()).toLocaleString("pt-BR")}</time>
                <div><strong>{item.title}</strong><span>{providerLabels[item.provider]} · {statusLabel(item.status)}</span></div>
              </article>
            ))}
          </div>
        </section>

        <section className="publisher-panel">
          <div className="publisher-panel-heading"><div><small>OPERAÇÃO</small><h2>Publicações e performance</h2></div><span>{publications.length} registro(s)</span></div>
          <div className="publisher-publications">
            {publications.length === 0 && <div className="publisher-empty">As publicações da marca aparecerão aqui.</div>}
            {publications.map((publication) => (
              <article key={publication.id}>
                <div className="publisher-publication-main">
                  <div><small>{providerLabels[publication.provider]}</small><strong>{statusLabel(publication.status)}</strong></div>
                  <span>{publication.publishedAt ? new Date(publication.publishedAt).toLocaleString("pt-BR") : publication.scheduledFor ? new Date(publication.scheduledFor).toLocaleString("pt-BR") : "Sem horário"}</span>
                  {publication.lastError && <p>{publication.lastError}</p>}
                </div>
                <div className="publisher-publication-actions">
                  {publication.permalink && <a href={publication.permalink} target="_blank" rel="noreferrer">Abrir post</a>}
                  {publication.status === "published" && <button disabled={Boolean(working)} onClick={() => void publicationAction(publication.id, "analytics")}>Atualizar desempenho</button>}
                  {publication.status === "failed" && <button disabled={Boolean(working)} onClick={() => void publicationAction(publication.id, "retry")}>Tentar novamente</button>}
                  {["draft", "scheduled", "retrying", "failed"].includes(publication.status) && <button disabled={Boolean(working)} onClick={() => void publicationAction(publication.id, "cancel")}>Cancelar</button>}
                </div>
              </article>
            ))}
          </div>
        </section>
      </main>
    </div>
  );
}
