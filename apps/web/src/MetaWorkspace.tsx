import type { Dashboard } from "@modo/contracts";
import type {
  MetaConnectionStatus,
  MetaMedia,
  MetaMetric,
  MetaOverview,
} from "@modo/contracts/meta";
import { useEffect, useState } from "react";
import { getDashboard, getSessionToken } from "./api";
import {
  connectMeta,
  disconnectMeta,
  getMetaOverview,
  getMetaStatus,
} from "./meta-api";

const metricLabels: Record<string, string> = {
  reach: "Alcance",
  profile_views: "Visitas ao perfil",
  accounts_engaged: "Contas engajadas",
  total_interactions: "Interações",
};

function formatNumber(value: number | null) {
  return value === null ? "—" : new Intl.NumberFormat("pt-BR").format(value);
}

function metricTitle(metric: MetaMetric) {
  return metricLabels[metric.name] || metric.title || metric.name;
}

function mediaImage(media: MetaMedia) {
  return media.thumbnailUrl || media.mediaUrl;
}

function mediaDate(timestamp: string | null) {
  if (!timestamp) return "Data indisponível";
  const date = new Date(timestamp);
  return Number.isNaN(date.getTime())
    ? "Data indisponível"
    : date.toLocaleDateString("pt-BR", { day: "2-digit", month: "short", year: "numeric" });
}

export default function MetaWorkspace() {
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [status, setStatus] = useState<MetaConnectionStatus | null>(null);
  const [overview, setOverview] = useState<MetaOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [action, setAction] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  async function load(showLoader = true) {
    if (showLoader) setLoading(true);
    try {
      const [currentDashboard, currentStatus] = await Promise.all([
        getDashboard(),
        getMetaStatus(),
      ]);
      setDashboard(currentDashboard);
      setStatus(currentStatus);
      if (currentStatus.connected) {
        setOverview(await getMetaOverview());
      } else {
        setOverview(null);
      }
      setError("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Não foi possível abrir o Meta Connect.");
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
    if (query.get("meta") === "connected") {
      setSuccess("Instagram conectado com sucesso em modo somente leitura.");
    }
    if (query.get("meta") === "error") {
      setError(query.get("message") || "A conexão com o Instagram não foi concluída.");
    }
    if (query.has("meta")) window.history.replaceState({}, "", "/app/meta");
    void load();
  }, []);

  async function connect() {
    setAction("connect");
    setError("");
    setSuccess("");
    try {
      const result = await connectMeta();
      window.location.href = result.authorizationUrl;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Não foi possível iniciar a conexão.");
      setAction("");
    }
  }

  async function disconnect() {
    if (!window.confirm("Desconectar o Instagram da MODO? Nenhuma publicação será removida da sua conta.")) return;
    setAction("disconnect");
    setError("");
    try {
      await disconnectMeta();
      setSuccess("Instagram desconectado e autorização removida da MODO.");
      await load(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Não foi possível desconectar.");
    } finally {
      setAction("");
    }
  }

  async function refresh() {
    setAction("refresh");
    setError("");
    try {
      const next = await getMetaOverview();
      setOverview(next);
      setSuccess("Indicadores atualizados agora.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Não foi possível atualizar os indicadores.");
    } finally {
      setAction("");
    }
  }

  if (loading && !dashboard) {
    return <main className="portal-loading"><img src="/logo.svg" alt="MODO" /><div className="portal-spinner" /><p>Preparando o Meta Connect...</p></main>;
  }

  if (!dashboard || !status) {
    return <main className="portal-loading"><p>{error || "Sua sessão expirou."}</p><a className="button button-primary" href="/app">Entrar novamente</a></main>;
  }

  return (
    <div className="meta-shell">
      <header className="workspace-header">
        <a href="/app"><img src="/logo.svg" alt="MODO" /></a>
        <nav>
          <a href="/app">Painel</a>
          <a href="/app/director">Diretor</a>
          <a href="/app/content">Criar</a>
          <a href="/app/inteligencia">Inteligência</a>
          <a className="active" href="/app/meta">Instagram</a>
          <a href="/app/planos">Planos</a>
        </nav>
        <div className="workspace-balance"><small>Saldo</small><strong>{dashboard.usage.creditsRemaining}</strong><span>créditos</span></div>
      </header>

      <main className="meta-main">
        <section className="meta-hero">
          <div>
            <div className="section-kicker">META CONNECT · INSTAGRAM</div>
            <h1>Entenda o desempenho da sua presença antes de decidir o próximo conteúdo.</h1>
            <p>Conecte uma conta profissional para trazer perfil, alcance, interações e publicações recentes para a inteligência da MODO.</p>
          </div>
          <div className="meta-readonly-badge"><span>●</span><div><strong>Somente leitura</strong><small>A MODO não publica, edita nem exclui conteúdo neste módulo.</small></div></div>
        </section>

        {error && <div className="portal-error">{error}</div>}
        {success && <div className="workspace-success">{success}</div>}

        <section className={`meta-connection ${status.connected ? "connected" : ""}`}>
          <div className="meta-connection-copy">
            <small>CONEXÃO SEGURA</small>
            <h2>{status.connected ? `@${status.username}` : status.integrationConfigured ? "Conecte seu Instagram profissional" : "Integração aguardando configuração"}</h2>
            <p>{status.message}</p>
            <div className="meta-safety-list">
              <span>✓ Sem senha compartilhada</span>
              <span>✓ Token protegido</span>
              <span>✓ Desconexão a qualquer momento</span>
            </div>
          </div>

          {status.connected ? (
            <div className="meta-connection-actions">
              <button className="button button-primary" disabled={Boolean(action)} onClick={() => void refresh()}>{action === "refresh" ? "Atualizando..." : "Atualizar indicadores"}</button>
              <button className="button button-outline" disabled={Boolean(action)} onClick={() => void disconnect()}>{action === "disconnect" ? "Desconectando..." : "Desconectar"}</button>
            </div>
          ) : status.integrationConfigured ? (
            <div className="meta-connect-panel">
              <strong>Antes de conectar</strong>
              <p>Use uma conta do Instagram configurada como <b>Empresa</b> ou <b>Criador de conteúdo</b>.</p>
              <button className="button button-primary" disabled={Boolean(action)} onClick={() => void connect()}>{action === "connect" ? "Abrindo Instagram..." : "Conectar Instagram"}</button>
            </div>
          ) : (
            <div className="meta-config-note">
              <strong>Produto pronto para ativação.</strong>
              <p>Cadastre o aplicativo Instagram e as credenciais no Render. Até lá, nenhuma autorização é solicitada ao cliente.</p>
            </div>
          )}
        </section>

        {overview ? (
          <>
            <section className="meta-profile-summary">
              <div className="meta-profile-identity">
                {overview.profile.profilePictureUrl ? <img src={overview.profile.profilePictureUrl} alt={`Perfil de @${overview.profile.username}`} /> : <div className="meta-profile-placeholder">@</div>}
                <div><small>CONTA CONECTADA</small><h2>{overview.profile.name || `@${overview.profile.username}`}</h2><p>@{overview.profile.username} · {overview.profile.accountType || "Conta profissional"}</p></div>
              </div>
              <div className="meta-profile-numbers">
                <div><strong>{formatNumber(overview.profile.followersCount)}</strong><span>seguidores</span></div>
                <div><strong>{formatNumber(overview.profile.followsCount)}</strong><span>seguindo</span></div>
                <div><strong>{formatNumber(overview.profile.mediaCount)}</strong><span>publicações</span></div>
              </div>
            </section>

            {overview.warnings.length > 0 && <section className="meta-warnings"><strong>Alguns dados não vieram nesta atualização.</strong>{overview.warnings.map((warning) => <p key={warning}>{warning}</p>)}</section>}

            <section className="meta-metrics-section">
              <div className="meta-section-head"><div><small>LEITURA ATUAL</small><h2>Indicadores disponíveis</h2></div><span>Atualizado em {new Date(overview.collectedAt).toLocaleString("pt-BR")}</span></div>
              {overview.metrics.length > 0 ? (
                <div className="meta-metrics-grid">
                  {overview.metrics.map((metric) => <article key={`${metric.name}-${metric.endTime || "latest"}`}><span>{metricTitle(metric)}</span><strong>{formatNumber(metric.value)}</strong><small>{metric.period ? `Período: ${metric.period}` : "Último dado disponível"}</small></article>)}
                </div>
              ) : (
                <div className="meta-empty"><h3>Ainda não há indicadores retornados para esta conta.</h3><p>Isso pode ocorrer em contas novas, métricas sem volume suficiente ou durante a disponibilização gradual dos dados pelo Instagram.</p></div>
              )}
            </section>

            <section className="meta-media-section">
              <div className="meta-section-head"><div><small>CONTEÚDO RECENTE</small><h2>Últimas publicações</h2></div><span>{overview.recentMedia.length} item(ns)</span></div>
              {overview.recentMedia.length > 0 ? (
                <div className="meta-media-grid">
                  {overview.recentMedia.map((media) => <article key={media.id}>
                    <div className="meta-media-image">{mediaImage(media) ? <img src={mediaImage(media)!} alt="Publicação do Instagram" /> : <span>{media.mediaType}</span>}</div>
                    <div className="meta-media-copy"><small>{media.mediaType} · {mediaDate(media.timestamp)}</small><p>{media.caption || "Publicação sem legenda disponível."}</p><div><span>♥ {formatNumber(media.likeCount)}</span><span>◌ {formatNumber(media.commentsCount)}</span>{media.permalink && <a href={media.permalink} target="_blank" rel="noreferrer">Abrir no Instagram ↗</a>}</div></div>
                  </article>)}
                </div>
              ) : (
                <div className="meta-empty"><h3>Nenhuma publicação recente foi retornada.</h3><p>A conexão permanece ativa. Atualize novamente depois ou confirme as permissões concedidas no Instagram.</p></div>
              )}
            </section>

            <section className="meta-next-step">
              <div><small>PRÓXIMA EVOLUÇÃO</small><h2>Da leitura para decisões melhores.</h2><p>Este primeiro modo conecta dados reais sem agir na conta. A próxima etapa será usar esses sinais, com transparência, para melhorar recomendações, calendário e conteúdo.</p></div>
              <a className="button button-outline" href="/app/director">Ver meu próximo movimento</a>
            </section>
          </>
        ) : (
          <section className="meta-before-connect">
            <div><span>01</span><h3>Você autoriza</h3><p>O login acontece no Instagram. A MODO nunca recebe sua senha.</p></div>
            <div><span>02</span><h3>A MODO lê</h3><p>Perfil, indicadores permitidos e publicações recentes são carregados.</p></div>
            <div><span>03</span><h3>Você decide</h3><p>Nada é publicado ou alterado. Os dados servem para orientar as próximas escolhas.</p></div>
          </section>
        )}
      </main>
    </div>
  );
}
