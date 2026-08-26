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

const videoProviders = new Set<NativePublisherProvider>(["instagram", "facebook", "threads"]);

function defaultScheduleValue() {
  const date = new Date(Date.now() + 24 * 60 * 60_000);
  date.setMinutes(Math.ceil(date.getMinutes() / 15) * 15, 0, 0);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

export default function NativePublisherApprovalAction({
  request,
  videoProjectId,
}: {
  request: ContentRequest;
  videoProjectId?: string;
}) {
  const isVideo = Boolean(videoProjectId);
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
        // A marca pode ainda não ter Instagram conectado no fluxo V1.
      }
    }
    if (!isVideo && !updated.some((item) => item.provider === "linkedin")) {
      try {
        await importLinkedInConnection(request.brandId);
        updated = await listNativeConnections(request.brandId);
      } catch {
        // LinkedIn é opcional e pode ainda não estar configurado.
      }
    }
    setQuality(qualityResult);
    setConnections(updated);
    const firstConnected = updated.find((item) => item.connected && item.canPublish && (!isVideo || videoProviders.has(item.provider)));
    if (firstConnected) {
      setProvider(firstConnected.provider);
      setConnectionId(firstConnected.id);
    }
  }

  useEffect(() => {
    void load().catch((caught) => setError(caught instanceof Error ? caught.message : "Não foi possível preparar o Publisher."));
  }, [request.id, request.brandId, videoProjectId]);

  const availableProviders = useMemo(
    () => [...new Set(
      connections
        .filter((item) => item.connected && item.canPublish && (!isVideo || videoProviders.has(item.provider)))
        .map((item) => item.provider),
    )],
    [connections, isVideo],
  );

  const providerConnections = useMemo(
    () => connections.filter((item) => item.provider === provider && item.connected && item.canPublish && (!isVideo || videoProviders.has(item.provider))),
    [connections, provider, isVideo],
  );

  useEffect(() => {
    if (!availableProviders.includes(provider) && availableProviders[0]) {
      setProvider(availableProviders[0]);
      setConnectionId("");
      return;
    }
    if (!providerConnections.some((item) => item.id === connectionId)) {
      setConnectionId(providerConnections[0]?.id || "");
    }
  }, [availableProviders, providerConnections, connectionId, provider]);

  const selectedConnection = useMemo(
    () => providerConnections.find((item) => item.id === connectionId) || null,
    [providerConnections, connectionId],
  );

  async function publish() {
    if (!connectionId) {
      setError("Escolha a conta social que deve receber esta publicação.");
      return;
    }
    setWorking(true);
    setError("");
    setMessage("");
    try {
      const scheduledIso = mode === "schedule" ? new Date(scheduledFor).toISOString() : undefined;
      const result = await createNativePublication({
        contentRequestId: request.id,
        brandId: request.brandId,
        provider,
        connectionId,
        mode,
        ...(videoProjectId ? { videoProjectId } : {}),
        ...(scheduledIso ? { scheduledFor: scheduledIso } : {}),
        idempotencyKey: `${request.id}:${videoProjectId || "content"}:${provider}:${connectionId}:${mode}:${scheduledIso || "now"}`,
      });
      const destination = selectedConnection?.displayName || providerLabels[provider];
      if (result.publication.status === "retrying") {
        const nextAttempt = result.publication.nextAttemptAt
          ? ` Nova tentativa prevista para ${new Date(result.publication.nextAttemptAt).toLocaleString("pt-BR")}.`
          : " A MODO fará uma nova tentativa automaticamente.";
        setError(`A publicação em ${destination} ainda não foi concluída.${nextAttempt}${result.publication.lastError ? ` Motivo: ${result.publication.lastError}` : ""}`);
        return;
      }
      if (result.publication.status === "failed") {
        setError(`A publicação em ${destination} falhou.${result.publication.lastError ? ` Motivo: ${result.publication.lastError}` : ""}`);
        return;
      }
      setMessage(
        result.publication.status === "published"
          ? `${isVideo ? "Vídeo publicado" : "Publicado"} com sucesso em ${destination}.`
          : result.publication.status === "scheduled"
            ? `${isVideo ? "Vídeo agendado" : "Agendado"} em ${destination} para ${new Date(result.publication.scheduledFor!).toLocaleString("pt-BR")}.`
            : `Rascunho salvo para ${destination}.`,
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
          <small>MODO PUBLISHER V2{isVideo ? " · VIDEO" : ""}</small>
          <strong>{isVideo ? "Publicar ou agendar o MP4 pronto" : "Publicar, agendar ou guardar"}</strong>
        </div>
        {quality && <span className={`quality-pill ${quality.status}`}>{quality.score}/100</span>}
      </div>

      {isVideo && (
        <div className="quality-summary">
          <span><strong>Vídeo persistido</strong> · Instagram Reels, Facebook e Threads</span>
          <small>O Publisher guarda a mídia no agendamento e no retry; não depende de refazer o render.</small>
        </div>
      )}

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
              <button key={item} type="button" className={provider === item ? "active" : ""} onClick={() => setProvider(item)}>
                {providerLabels[item]}
              </button>
            ))}
          </div>
          <label className="publisher-schedule-field">
            Conta de destino
            <select value={connectionId} onChange={(event) => setConnectionId(event.target.value)}>
              {providerConnections.map((item) => (
                <option key={item.id} value={item.id}>{item.displayName}{item.username && !item.displayName.includes(item.username) ? ` · @${item.username}` : ""}</option>
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
          <p>{isVideo ? "Esta marca ainda não possui Instagram, Facebook ou Threads disponível para vídeo." : "Esta marca ainda não possui um canal importado no Publisher V2."}</p>
          <a className="button button-secondary" href={`/app/publisher?brand=${encodeURIComponent(request.brandId)}`}>Conectar canais</a>
        </div>
      )}

      {isVideo && <small>LinkedIn vídeo exige o fluxo de upload de ativos da plataforma e fica fora desta V1, sem afetar publicações atuais de texto.</small>}
      {message && <div className="workspace-success">{message}</div>}
      {error && <div className="portal-error">{error}</div>}
    </div>
  );
}
