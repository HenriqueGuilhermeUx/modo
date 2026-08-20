import type { ContentRequest } from "@modo/contracts/content";
import type { NativeConnection, NativePublisherMode, NativePublisherProvider } from "@modo/contracts/native-publisher";
import { useEffect, useMemo, useState } from "react";
import {
  createNativePublication,
  getNativeQuality,
  importInstagramConnection,
  importLinkedInConnection,
  listNativeConnections,
} from "./native-publisher-api";

const providerLabels: Record<NativePublisherProvider, string> = {
  instagram: "Instagram",
  facebook: "Facebook",
  threads: "Threads",
  linkedin: "LinkedIn",
};

function defaultScheduleValue() {
  const date = new Date(Date.now() + 24 * 60 * 60_000);
  date.setMinutes(Math.ceil(date.getMinutes() / 15) * 15, 0, 0);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

export default function NativePublisherApprovalAction({ request }: { request: ContentRequest }) {
  const [connections, setConnections] = useState<NativeConnection[]>([]);
  const [quality, setQuality] = useState<Awaited<ReturnType<typeof getNativeQuality>> | null>(null);
  const [provider, setProvider] = useState<NativePublisherProvider>("instagram");
  const [connectionId, setConnectionId] = useState("");
  const [mode, setMode] = useState<NativePublisherMode>("now");
  const [scheduledFor, setScheduledFor] = useState(defaultScheduleValue());
  const [working, setWorking] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function load() {
    const [qualityResult, initialConnections] = await Promise.all([
      getNativeQuality(request.id),
      listNativeConnections(request.brandId),
    ]);
    let updated = initialConnections;
    if (!updated.some((item) => item.provider === "instagram")) {
      try {
        await importInstagramConnection(request.brandId);
        updated = await listNativeConnections(request.brandId);
      } catch {
        // Migração opcional: novos clientes conectam diretamente no Publisher V2.
      }
    }
    if (!updated.some((item) => item.provider === "linkedin")) {
      try {
        await importLinkedInConnection(request.brandId);
        updated = await listNativeConnections(request.brandId);
      } catch {
        // Migração opcional: novos clientes conectam diretamente no Publisher V2.
      }
    }
    setQuality(qualityResult);
    setConnections(updated);
    const firstConnected = updated.find((item) => item.connected && item.canPublish);
    if (firstConnected) {
      setProvider(firstConnected.provider);
      setConnectionId(firstConnected.id);
    }
  }

  useEffect(() => {
    void load().catch((caught) => setError(caught instanceof Error ? caught.message : "Não foi possível preparar o Publisher."));
  }, [request.id, request.brandId]);

  const availableProviders = useMemo(
    () => [...new Set(connections.filter((item) => item.connected && item.canPublish).map((item) => item.provider))],
    [connections],
  );

  const providerConnections = useMemo(
    () => connections.filter(
      (item) => item.provider === provider && item.connected && item.canPublish,
    ),
    [connections, provider],
  );

  function chooseProvider(nextProvider: NativePublisherProvider) {
    setProvider(nextProvider);
    const first = connections.find(
      (item) => item.provider === nextProvider && item.connected && item.canPublish,
    );
    setConnectionId(first?.id || "");
  }

  async function publish() {
    if (!connectionId) {
      setError("Escolha a conta social que deve receber esta publicação.");
      return;
    }
    setWorking(true);
    setError("");
    setMessage("");
    try {
      const selectedConnection = providerConnections.find((item) => item.id === connectionId);
      if (!selectedConnection) {
        throw new Error("A conta social selecionada não está mais disponível para esta marca.");
      }
      const scheduledIso = mode === "schedule" ? new Date(scheduledFor).toISOString() : undefined;
      const result = await createNativePublication({
        contentRequestId: request.id,
        brandId: request.brandId,
        provider,
        connectionId,
        mode,
        ...(scheduledIso ? { scheduledFor: scheduledIso } : {}),
        idempotencyKey: `${request.id}:${provider}:${connectionId}:${mode}:${scheduledIso || "now"}`,
      });
      const label = `${providerLabels[provider]} · ${selectedConnection.displayName}`;
      setMessage(
        result.publication.status === "published"
          ? `${label} publicado com sucesso.`
          : result.publication.status === "scheduled"
            ? `${label} agendado para ${new Date(result.publication.scheduledFor!).toLocaleString("pt-BR")}.`
            : `Rascunho salvo para ${label}.`,
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Não foi possível concluir a publicação.");
    } finally {
      setWorking(false);
    }
  }

  return (
    <div className="native-publisher-action">
      <div className="native-publisher-action-head">
        <div>
          <small>MODO PUBLISHER V2</small>
          <strong>Publicar, agendar ou guardar</strong>
        </div>
        {quality && <span className={`quality-pill ${quality.status}`}>{quality.score}/100</span>}
      </div>

      {quality && (
        <div className="quality-summary">
          <span>Quality Gate: <strong>{quality.status === "recommended" ? "recomendado" : quality.status === "blocked" ? "bloqueado" : "revisão sugerida"}</strong></span>
          {quality.warnings[0] && <small>{quality.warnings[0]}</small>}
          {quality.blockers[0] && <small className="danger">{quality.blockers[0]}</small>}
        </div>
      )}

      {availableProviders.length > 0 ? (
        <>
          <div className="publisher-provider-tabs">
            {availableProviders.map((item) => (
              <button key={item} type="button" className={provider === item ? "active" : ""} onClick={() => chooseProvider(item)}>
                {providerLabels[item]}
              </button>
            ))}
          </div>

          <label className="publisher-schedule-field">
            Publicar como
            <select value={connectionId} onChange={(event) => setConnectionId(event.target.value)}>
              {providerConnections.map((connection) => (
                <option key={connection.id} value={connection.id}>
                  {connection.displayName}{connection.username && !connection.displayName.includes(connection.username) ? ` · @${connection.username}` : ""}
                </option>
              ))}
            </select>
          </label>

          <div className="publisher-mode-tabs">
            <button type="button" className={mode === "now" ? "active" : ""} onClick={() => setMode("now")}>Publicar agora</button>
            <button type="button" className={mode === "schedule" ? "active" : ""} onClick={() => setMode("schedule")}>Agendar</button>
            <button type="button" className={mode === "draft" ? "active" : ""} onClick={() => setMode("draft")}>Rascunho</button>
          </div>
          {mode === "schedule" && (
            <label className="publisher-schedule-field">
              Data e hora
              <input type="datetime-local" value={scheduledFor} onChange={(event) => setScheduledFor(event.target.value)} />
            </label>
          )}
          <button type="button" className="button button-primary" disabled={working || !connectionId || quality?.publishAllowed === false} onClick={() => void publish()}>
            {working ? "Processando..." : mode === "now" ? `Publicar no ${providerLabels[provider]}` : mode === "schedule" ? `Agendar no ${providerLabels[provider]}` : `Salvar para ${providerLabels[provider]}`}
          </button>
        </>
      ) : (
        <div className="publisher-empty-connections">
          <p>Esta marca ainda não possui um canal conectado no Publisher V2.</p>
          <a className="button button-secondary" href={`/app/publisher?brand=${encodeURIComponent(request.brandId)}`}>Conectar canais</a>
        </div>
      )}

      {message && <div className="workspace-success">{message}</div>}
      {error && <div className="portal-error">{error}</div>}
    </div>
  );
}
