import type { ContentRequest } from "@modo/contracts/content";
import type { DistributionQualityReport } from "@modo/contracts/distribution-quality";
import type {
  NativeAnalyticsSummary,
  NativeConnection,
  NativePublication,
  NativeSocialPlatform,
} from "@modo/contracts/native-publisher";
import { useEffect, useMemo, useState } from "react";
import { connectInstagram } from "./instagram-api";
import { connectLinkedIn } from "./linkedin-api";
import {
  cancelNativePublication,
  connectNativeMeta,
  createNativePublication,
  getNativeBrandInsights,
  getNativeQuality,
  listNativeConnections,
  listNativePublications,
  refreshNativeAnalytics,
  retryNativePublication,
} from "./native-publisher-api";
import "./native-publisher.css";

const labels: Record<NativeSocialPlatform, string> = {
  instagram: "Instagram",
  facebook: "Facebook",
  threads: "Threads",
  linkedin: "LinkedIn",
};

const icons: Record<NativeSocialPlatform, string> = {
  instagram: "◎",
  facebook: "f",
  threads: "@",
  linkedin: "in",
};

const statusLabels: Record<NativePublication["status"], string> = {
  scheduled: "Agendado",
  publishing: "Publicando",
  retrying: "Tentará novamente",
  published: "Publicado",
  failed: "Falhou",
  cancelled: "Cancelado",
};

function scheduleDefault() {
  const date = new Date(Date.now() + 60 * 60_000);
  date.setMinutes(Math.ceil(date.getMinutes() / 15) * 15, 0, 0);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function QualityGate({ report }: { report: DistributionQualityReport }) {
  const title = report.status === "recommended"
    ? "Recomendado para publicar"
    : report.status === "review"
      ? "Pode publicar, mas revise os avisos"
      : "Publicação bloqueada";
  return (
    <section className={`native-quality ${report.status}`}>
      <div className="native-quality-score"><strong>{report.score}</strong><span>/100</span></div>
      <div>
        <small>MODO QUALITY GATE</small>
        <h4>{title}</h4>
        <div className="native-quality-checks">
          {report.checks.map((item) => (
            <span key={item.key} className={item.status} title={item.message}>
              {item.status === "pass" ? "✓" : item.status === "block" ? "×" : "!"} {item.label}
            </span>
          ))}
        </div>
        {report.blockers[0] && <p className="blocker">{report.blockers[0]}</p>}
        {!report.blockers.length && report.warnings[0] && <p>{report.warnings[0]}</p>}
      </div>
    </section>
  );
}

function Analytics({ summary }: { summary: NativeAnalyticsSummary }) {
  const visible = summary.metrics.filter((item) => item.value > 0).slice(0, 6);
  return (
    <div className="native-analytics">
      <div className="native-analytics-score"><strong>{summary.score}</strong><span>score MODO</span></div>
      <div className="native-analytics-metrics">
        {visible.length ? visible.map((metric) => (
          <span key={metric.key}><b>{metric.value.toLocaleString("pt-BR")}</b>{metric.label}</span>
        )) : <span>As métricas ainda não acumularam volume suficiente.</span>}
        {summary.engagementRate !== null && (
          <span><b>{summary.engagementRate.toFixed(2)}%</b>engajamento ponderado</span>
        )}
      </div>
      <p>
        {summary.learningSignal === "performed_well"
          ? "A MODO aprendeu que este padrão funcionou e aumentará o peso de direções semelhantes."
          : summary.learningSignal === "performed_poorly"
            ? "A MODO registrou sinal fraco e reduzirá o peso de direções semelhantes."
            : "A MODO guardou os dados; ainda não há sinal forte para mudar a estratégia."}
      </p>
    </div>
  );
}

export default function NativePublisherApprovalAction({ request }: { request: ContentRequest }) {
  const [connections, setConnections] = useState<NativeConnection[]>([]);
  const [quality, setQuality] = useState<DistributionQualityReport | null>(null);
  const [publications, setPublications] = useState<NativePublication[]>([]);
  const [analytics, setAnalytics] = useState<Record<string, NativeAnalyticsSummary>>({});
  const [selected, setSelected] = useState<NativeSocialPlatform[]>([]);
  const [mode, setMode] = useState<"now" | "schedule">("schedule");
  const [scheduledFor, setScheduledFor] = useState(scheduleDefault);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [insights, setInsights] = useState<{ samples: number; averageScore: number; bestScore: number; signal: string } | null>(null);
  const [loading, setLoading] = useState(true);

  async function load() {
    const [nextConnections, nextQuality, nextPublications, nextInsights] = await Promise.all([
      listNativeConnections(request.brandId),
      getNativeQuality(request.id),
      listNativePublications({ brandId: request.brandId }),
      getNativeBrandInsights(request.brandId).catch(() => null),
    ]);
    setConnections(nextConnections);
    setQuality(nextQuality);
    setPublications(nextPublications.filter((item) => item.contentRequestId === request.id));
    setInsights(nextInsights);
    setSelected((current) => current.filter((platform) =>
      nextConnections.some((connection) => connection.platform === platform && connection.connected && connection.canPublish),
    ));
  }

  useEffect(() => {
    let active = true;
    setLoading(true);
    load()
      .catch((caught) => {
        if (active) setError(caught instanceof Error ? caught.message : "Não foi possível carregar o Publisher.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    const query = new URLSearchParams(window.location.search);
    if (query.get("facebook") === "connected") setSuccess("Página do Facebook conectada.");
    if (query.get("threads") === "connected") setSuccess("Threads conectado.");
    return () => { active = false; };
  }, [request.id, request.brandId]);

  const connected = useMemo(
    () => connections.filter((item) => item.connected && item.canPublish),
    [connections],
  );

  async function connect(platform: NativeSocialPlatform) {
    setBusy(`connect:${platform}`);
    setError("");
    try {
      if (platform === "instagram") {
        const result = await connectInstagram(request.brandId);
        window.location.assign(result.authorizationUrl);
        return;
      }
      if (platform === "linkedin") {
        const result = await connectLinkedIn({ authorType: "member" });
        window.location.assign(result.authorizationUrl);
        return;
      }
      const result = await connectNativeMeta(platform, request.brandId);
      window.location.assign(result.authorizationUrl);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : `Não foi possível conectar ${labels[platform]}.`);
      setBusy("");
    }
  }

  function toggle(platform: NativeSocialPlatform) {
    setSelected((current) => current.includes(platform)
      ? current.filter((item) => item !== platform)
      : [...current, platform]);
  }

  async function publish() {
    if (!quality?.publishAllowed) {
      setError(quality?.blockers[0] || "O Quality Gate bloqueou a publicação.");
      return;
    }
    if (!selected.length) {
      setError("Selecione pelo menos um canal conectado.");
      return;
    }
    if (mode === "schedule" && !scheduledFor) {
      setError("Informe data e hora para o agendamento.");
      return;
    }
    const verb = mode === "now" ? "publicar agora" : "agendar";
    if (!window.confirm(`Confirmar: ${verb} em ${selected.map((item) => labels[item]).join(", ")}?`)) return;
    setBusy("publish");
    setError("");
    setSuccess("");
    try {
      const created: NativePublication[] = [];
      for (const platform of selected) {
        const result = await createNativePublication({
          contentRequestId: request.id,
          platform,
          mode,
          ...(mode === "schedule" ? { scheduledFor: new Date(scheduledFor).toISOString() } : {}),
        });
        created.push(result.publication);
        setQuality(result.quality);
      }
      setPublications((current) => [
        ...created,
        ...current.filter((item) => !created.some((next) => next.id === item.id)),
      ]);
      setSuccess(
        mode === "now"
          ? `Publicação enviada para ${created.length} canal(is).`
          : `${created.length} publicação(ões) agendada(s).`,
      );
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Não foi possível concluir a distribuição.");
    } finally {
      setBusy("");
    }
  }

  async function cancel(publication: NativePublication) {
    if (!window.confirm(`Cancelar o agendamento de ${labels[publication.platform]}?`)) return;
    setBusy(`cancel:${publication.id}`);
    try {
      await cancelNativePublication(publication.id);
      await load();
      setSuccess("Agendamento cancelado.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Não foi possível cancelar.");
    } finally {
      setBusy("");
    }
  }

  async function retry(publication: NativePublication) {
    setBusy(`retry:${publication.id}`);
    try {
      await retryNativePublication(publication.id);
      await load();
      setSuccess("A publicação voltou para a fila com retry controlado.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Não foi possível reenviar.");
    } finally {
      setBusy("");
    }
  }

  async function readPerformance(publication: NativePublication) {
    setBusy(`analytics:${publication.id}`);
    try {
      const summary = await refreshNativeAnalytics(publication.id);
      setAnalytics((current) => ({ ...current, [publication.id]: summary }));
      setInsights(await getNativeBrandInsights(request.brandId).catch(() => insights));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Não foi possível ler o desempenho.");
    } finally {
      setBusy("");
    }
  }

  if (loading) {
    return <section className="native-publisher loading"><span className="portal-spinner" /><p>Preparando canais, agenda e Quality Gate...</p></section>;
  }

  return (
    <section className="native-publisher">
      <div className="native-publisher-heading">
        <div>
          <small>MODO PUBLISHER NATIVO</small>
          <h3>Publicar, agendar, medir e aprender.</h3>
          <p>A peça só sai após sua aprovação e confirmação. Depois, os resultados voltam para o Diretor.</p>
        </div>
        {insights && insights.samples > 0 && (
          <span className="native-learning-badge">IA aprendendo · {insights.samples} leitura{insights.samples > 1 ? "s" : ""}</span>
        )}
      </div>

      {quality && <QualityGate report={quality} />}

      <div className="native-channel-grid">
        {connections.map((connection) => {
          const selectable = connection.connected && connection.canPublish;
          const active = selected.includes(connection.platform);
          return (
            <article key={connection.platform} className={`${connection.platform} ${active ? "selected" : ""} ${connection.connected ? "connected" : ""}`}>
              <div className="native-channel-top">
                {connection.pictureUrl
                  ? <img src={connection.pictureUrl} alt="" />
                  : <span className="native-channel-icon">{icons[connection.platform]}</span>}
                <div><small>{labels[connection.platform]}</small><strong>{connection.displayName || labels[connection.platform]}</strong></div>
                <span className={`native-channel-state ${connection.connected ? "ok" : ""}`}>{connection.connected ? "Conectado" : connection.configured ? "Pronto" : "Configurar"}</span>
              </div>
              <p>{connection.message}</p>
              {selectable ? (
                <button type="button" className={active ? "selected" : ""} onClick={() => toggle(connection.platform)}>
                  {active ? "✓ Selecionado" : "Selecionar canal"}
                </button>
              ) : (
                <button
                  type="button"
                  disabled={!connection.configured || Boolean(busy)}
                  onClick={() => void connect(connection.platform)}
                >
                  {busy === `connect:${connection.platform}` ? "Abrindo autorização..." : connection.configured ? `Conectar ${labels[connection.platform]}` : "Aguardando configuração"}
                </button>
              )}
            </article>
          );
        })}
      </div>

      {connected.length > 0 && (
        <div className="native-publish-controls">
          <div className="native-publish-mode">
            <button className={mode === "schedule" ? "active" : ""} onClick={() => setMode("schedule")}>Agendar</button>
            <button className={mode === "now" ? "active" : ""} onClick={() => setMode("now")}>Publicar agora</button>
          </div>
          {mode === "schedule" && (
            <label>Data e hora<input type="datetime-local" value={scheduledFor} min={scheduleDefault()} onChange={(event) => setScheduledFor(event.target.value)} /></label>
          )}
          <button
            type="button"
            className="button button-primary"
            disabled={busy === "publish" || !selected.length || Boolean(quality && !quality.publishAllowed)}
            onClick={() => void publish()}
          >
            {quality && !quality.publishAllowed
              ? "Corrija os bloqueios antes de publicar"
              : busy === "publish"
                ? "Preparando distribuição..."
                : mode === "schedule"
                  ? `Agendar em ${selected.length} canal(is)`
                  : `Publicar agora em ${selected.length} canal(is)`}
          </button>
        </div>
      )}

      {error && <div className="portal-error">{error}</div>}
      {success && <div className="workspace-success">{success}</div>}

      {publications.length > 0 && (
        <div className="native-publication-list">
          <div className="native-publication-heading"><strong>Distribuição desta peça</strong>{insights && insights.samples > 0 && <span>Média {insights.averageScore}/100 · melhor {insights.bestScore}/100</span>}</div>
          {publications.map((publication) => (
            <article key={publication.id}>
              <div className="native-publication-main">
                <span className={`native-status ${publication.status}`}>{statusLabels[publication.status]}</span>
                <strong>{labels[publication.platform]}</strong>
                <small>{new Date(publication.scheduledFor).toLocaleString("pt-BR")}</small>
                {publication.attempts > 0 && <small>{publication.attempts} tentativa{publication.attempts > 1 ? "s" : ""}</small>}
              </div>
              {publication.lastError && <p className="native-publication-error">{publication.lastError}</p>}
              <div className="native-publication-actions">
                {publication.releaseUrl && <a href={publication.releaseUrl} target="_blank" rel="noreferrer">Ver publicação ↗</a>}
                {["scheduled", "retrying"].includes(publication.status) && <button disabled={Boolean(busy)} onClick={() => void cancel(publication)}>Cancelar</button>}
                {publication.status === "failed" && <button disabled={Boolean(busy)} onClick={() => void retry(publication)}>Tentar novamente</button>}
                {publication.status === "published" && <button disabled={busy === `analytics:${publication.id}`} onClick={() => void readPerformance(publication)}>{busy === `analytics:${publication.id}` ? "Lendo..." : "Atualizar desempenho"}</button>}
              </div>
              {analytics[publication.id] && <Analytics summary={analytics[publication.id]} />}
            </article>
          ))}
        </div>
      )}

      <div className="native-publisher-governance">A MODO nunca publica só porque a peça foi aprovada. Publicação imediata ou agendamento exigem uma confirmação explícita.</div>
    </section>
  );
}
