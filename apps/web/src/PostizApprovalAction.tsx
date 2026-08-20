import type { ContentRequest } from "@modo/contracts/content";
import type {
  PostizAnalyticsSummary,
  PostizIntegration,
  PostizPlatform,
  PostizPublication,
  PostizPublishMode,
} from "@modo/contracts/postiz";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  claimDistributionConnection,
  distributeContent,
  getDistributionInsights,
  getDistributionStatus,
  listContentPublications,
  refreshPublicationAnalytics,
  startDistributionConnection,
} from "./postiz-api";
import "./postiz-distribution.css";

const platformLabels: Record<PostizPlatform, string> = {
  instagram: "Instagram",
  "instagram-standalone": "Instagram",
  facebook: "Facebook",
  linkedin: "LinkedIn",
  "linkedin-page": "LinkedIn Página",
  threads: "Threads",
};

const connectOptions: Array<{ platform: PostizPlatform; label: string }> = [
  { platform: "instagram", label: "Instagram" },
  { platform: "facebook", label: "Facebook" },
  { platform: "linkedin", label: "LinkedIn" },
  { platform: "threads", label: "Threads" },
];

const statusLabels: Record<PostizPublication["status"], string> = {
  draft: "Rascunho",
  scheduled: "Agendado",
  submitted: "Enviado",
  published: "Publicado",
  failed: "Falhou",
};

function defaultScheduleValue() {
  const date = new Date(Date.now() + 60 * 60_000);
  date.setMinutes(Math.ceil(date.getMinutes() / 15) * 15, 0, 0);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function AnalyticsView({ summary }: { summary: PostizAnalyticsSummary }) {
  const topMetrics = summary.metrics.filter((item) => item.latest > 0).slice(0, 5);
  return (
    <div className="distribution-analytics-result">
      <div className="distribution-score">
        <strong>{summary.score}</strong>
        <span>score MODO</span>
      </div>
      <div className="distribution-metrics">
        {topMetrics.map((metric) => (
          <span key={metric.label}>
            <b>{metric.latest.toLocaleString("pt-BR")}</b> {metric.label}
          </span>
        ))}
        {summary.engagementRate !== null && (
          <span><b>{summary.engagementRate.toFixed(2)}%</b> engajamento ponderado</span>
        )}
      </div>
      <p>
        {summary.learningSignal === "performed_well"
          ? "A MODO registrou este resultado como um padrão forte e vai aumentar o peso de direções semelhantes."
          : summary.learningSignal === "performed_poorly"
            ? "A MODO registrou um sinal fraco e vai reduzir o peso de direções semelhantes nas próximas recomendações."
            : "A MODO guardou os dados. Ainda é cedo para alterar a direção criativa com este resultado isolado."}
      </p>
    </div>
  );
}

export default function PostizApprovalAction({ request }: { request: ContentRequest }) {
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [integrations, setIntegrations] = useState<PostizIntegration[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [publications, setPublications] = useState<PostizPublication[]>([]);
  const [analytics, setAnalytics] = useState<Record<string, PostizAnalyticsSummary>>({});
  const [insights, setInsights] = useState<{ samples: number; averageScore: number; bestScore: number; signal: string } | null>(null);
  const [mode, setMode] = useState<PostizPublishMode>("schedule");
  const [scheduledFor, setScheduledFor] = useState(defaultScheduleValue);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const mounted = useRef(true);

  async function load() {
    const [status, currentPublications, currentInsights] = await Promise.all([
      getDistributionStatus(request.brandId),
      listContentPublications(request.id).catch(() => []),
      getDistributionInsights(request.brandId).catch(() => null),
    ]);
    if (!mounted.current) return;
    setConfigured(status.configured);
    const active = status.integrations.filter((item) => !item.disabled);
    setIntegrations(active);
    setSelected((current) => {
      const valid = current.filter((id) => active.some((item) => item.id === id));
      return valid.length ? valid : active.map((item) => item.id);
    });
    setPublications(currentPublications);
    setInsights(currentInsights);
  }

  useEffect(() => {
    mounted.current = true;
    void load().catch((caught) => {
      if (mounted.current) setError(caught instanceof Error ? caught.message : "Não foi possível carregar os canais.");
    });
    return () => {
      mounted.current = false;
    };
  }, [request.id, request.brandId]);

  const selectedIntegrations = useMemo(
    () => integrations.filter((item) => selected.includes(item.id)),
    [integrations, selected],
  );

  async function connect(platform: PostizPlatform) {
    setBusy(`connect:${platform}`);
    setError("");
    setMessage("");
    try {
      const pending = await startDistributionConnection({ brandId: request.brandId, platform });
      const popup = window.open(
        pending.authorizationUrl,
        "modo-postiz-oauth",
        "popup=yes,width=720,height=780,noopener,noreferrer",
      );
      setMessage(`Autorize ${platformLabels[platform]} na janela aberta. A MODO vai reconhecer o canal automaticamente.`);

      for (let attempt = 0; attempt < 80 && mounted.current; attempt += 1) {
        await new Promise((resolve) => window.setTimeout(resolve, 3000));
        try {
          const claimed = await claimDistributionConnection(pending.pendingId);
          if (claimed.status === "connected") {
            popup?.close();
            setMessage(`${platformLabels[platform]} conectado à MODO.`);
            await load();
            return;
          }
        } catch (caught) {
          const text = caught instanceof Error ? caught.message : "";
          if (/expir/i.test(text)) throw caught;
        }
      }
      setMessage("A autorização ainda não apareceu. Feche a janela e tente conectar novamente.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Não foi possível conectar o canal.");
    } finally {
      if (mounted.current) setBusy("");
    }
  }

  async function publish() {
    if (!selected.length) {
      setError("Selecione pelo menos um canal.");
      return;
    }
    setBusy("publish");
    setError("");
    setMessage("");
    try {
      const input = {
        integrationIds: selected,
        mode,
        ...(mode === "schedule"
          ? { scheduledFor: new Date(scheduledFor).toISOString() }
          : {}),
      } as const;
      const created = await distributeContent(request.id, input);
      setPublications((current) => [...created, ...current]);
      setMessage(
        mode === "now"
          ? `Conteúdo enviado para ${created.length} canal(is).`
          : mode === "draft"
            ? `Rascunho criado em ${created.length} canal(is).`
            : `Conteúdo agendado em ${created.length} canal(is).`,
      );
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Não foi possível distribuir o conteúdo.");
    } finally {
      setBusy("");
    }
  }

  async function refreshAnalytics(publication: PostizPublication) {
    setBusy(`analytics:${publication.id}`);
    setError("");
    try {
      const result = await refreshPublicationAnalytics(publication.id, 30);
      setAnalytics((current) => ({ ...current, [publication.id]: result.summary }));
      setPublications((current) => current.map((item) => item.id === result.publication.id ? result.publication : item));
      setInsights(await getDistributionInsights(request.brandId).catch(() => insights));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Não foi possível atualizar o desempenho.");
    } finally {
      setBusy("");
    }
  }

  if (configured === null) {
    return <div className="distribution-loading">Preparando distribuição multicanal...</div>;
  }

  if (!configured) {
    return (
      <div className="distribution-unavailable">
        <small>DISTRIBUIÇÃO MULTICANAL</small>
        <strong>Postiz pronto para ativação</strong>
        <p>O motor está instalado na MODO. Falta somente a chave privada do provider no ambiente de produção.</p>
      </div>
    );
  }

  return (
    <div className="distribution-workspace">
      <div className="distribution-heading">
        <div>
          <small>MODO PUBLISHER</small>
          <strong>Publicar, agendar e aprender</strong>
          <p>A peça só sai quando você mandar. Depois, a performance volta para o Diretor da MODO.</p>
        </div>
        {insights && insights.samples > 0 && (
          <span className="distribution-learning-badge">IA aprendendo · {insights.samples} leitura{insights.samples > 1 ? "s" : ""}</span>
        )}
      </div>

      <div className="distribution-connect-row">
        {connectOptions.map((option) => (
          <button
            key={option.platform}
            type="button"
            disabled={Boolean(busy)}
            onClick={() => void connect(option.platform)}
          >
            {busy === `connect:${option.platform}` ? "Conectando..." : `+ ${option.label}`}
          </button>
        ))}
      </div>

      {integrations.length === 0 ? (
        <div className="distribution-empty">
          <strong>Conecte o primeiro canal</strong>
          <p>Instagram, Facebook, LinkedIn e Threads ficam sob o controle da MODO sem você precisar sair da plataforma para publicar.</p>
        </div>
      ) : (
        <>
          <div className="distribution-channel-list">
            {integrations.map((integration) => (
              <label key={integration.id} className={selected.includes(integration.id) ? "selected" : ""}>
                <input
                  type="checkbox"
                  checked={selected.includes(integration.id)}
                  onChange={(event) => setSelected((current) => event.target.checked
                    ? [...new Set([...current, integration.id])]
                    : current.filter((id) => id !== integration.id))}
                />
                {integration.picture ? <img src={integration.picture} alt="" /> : <span className="distribution-channel-avatar">{platformLabels[integration.identifier][0]}</span>}
                <span>
                  <strong>{integration.name}</strong>
                  <small>{platformLabels[integration.identifier]}{integration.profile ? ` · ${integration.profile}` : ""}</small>
                </span>
              </label>
            ))}
          </div>

          <div className="distribution-mode-row">
            {(["schedule", "now", "draft"] as PostizPublishMode[]).map((value) => (
              <button
                key={value}
                type="button"
                className={mode === value ? "active" : ""}
                onClick={() => setMode(value)}
              >
                {value === "schedule" ? "Agendar" : value === "now" ? "Publicar agora" : "Rascunho"}
              </button>
            ))}
          </div>

          {mode === "schedule" && (
            <label className="distribution-schedule-field">
              Data e hora
              <input
                type="datetime-local"
                value={scheduledFor}
                min={defaultScheduleValue()}
                onChange={(event) => setScheduledFor(event.target.value)}
              />
            </label>
          )}

          <button
            type="button"
            className="button button-primary distribution-submit"
            disabled={busy === "publish" || selectedIntegrations.length === 0 || (mode === "schedule" && !scheduledFor)}
            onClick={() => void publish()}
          >
            {busy === "publish"
              ? "Enviando para os canais..."
              : mode === "now"
                ? `Publicar agora em ${selectedIntegrations.length} canal(is)`
                : mode === "draft"
                  ? `Criar rascunho em ${selectedIntegrations.length} canal(is)`
                  : `Agendar em ${selectedIntegrations.length} canal(is)`}
          </button>
        </>
      )}

      {error && <div className="distribution-error">{error}</div>}
      {message && <div className="distribution-success">{message}</div>}

      {publications.length > 0 && (
        <div className="distribution-publications">
          <div className="distribution-publications-heading">
            <strong>Distribuição desta peça</strong>
            {insights && insights.samples > 0 && (
              <span>Média aprendida {insights.averageScore}/100 · melhor {insights.bestScore}/100</span>
            )}
          </div>
          {publications.map((publication) => (
            <article key={publication.id}>
              <div>
                <span className={`distribution-status ${publication.status}`}>{statusLabels[publication.status]}</span>
                <strong>{platformLabels[publication.platform]}</strong>
                <small>
                  {publication.scheduledFor
                    ? new Date(publication.scheduledFor).toLocaleString("pt-BR")
                    : new Date(publication.createdAt).toLocaleString("pt-BR")}
                </small>
              </div>
              <div className="distribution-publication-actions">
                {publication.releaseUrl && <a href={publication.releaseUrl} target="_blank" rel="noreferrer">Ver publicação ↗</a>}
                <button
                  type="button"
                  disabled={busy === `analytics:${publication.id}` || publication.status === "draft"}
                  onClick={() => void refreshAnalytics(publication)}
                >
                  {busy === `analytics:${publication.id}` ? "Lendo..." : "Atualizar desempenho"}
                </button>
              </div>
              {analytics[publication.id] && <AnalyticsView summary={analytics[publication.id]} />}
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
