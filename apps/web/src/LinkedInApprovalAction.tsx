import type { LinkedInConnectionStatus, LinkedInPublication } from "@modo/contracts/linkedin";
import { useEffect, useState } from "react";
import { getLinkedInStatus, publishToLinkedIn } from "./linkedin-api";

export default function LinkedInApprovalAction({
  contentRequestId,
  channel,
}: {
  contentRequestId: string;
  channel: string;
}) {
  const [status, setStatus] = useState<LinkedInConnectionStatus | null>(null);
  const [publication, setPublication] = useState<LinkedInPublication | null>(null);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    getLinkedInStatus()
      .then((next) => { if (active) setStatus(next); })
      .catch((caught) => {
        if (active) setError(caught instanceof Error ? caught.message : "Não foi possível carregar o LinkedIn.");
      })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  if (!/^linkedin$/i.test(channel.trim())) return null;

  async function publish() {
    if (!window.confirm("Publicar este conteúdo aprovado no LinkedIn agora?")) return;
    setWorking(true);
    setError("");
    try {
      setPublication(await publishToLinkedIn(contentRequestId));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Não foi possível publicar no LinkedIn.");
    } finally {
      setWorking(false);
    }
  }

  if (loading) {
    return <section className="instagram-approval-action loading"><span className="portal-spinner" /><p>Verificando o LinkedIn...</p></section>;
  }

  if (!status?.integrationConfigured) {
    return (
      <section className="instagram-approval-action unavailable">
        <div>
          <small>PUBLICAÇÃO NATIVA</small>
          <strong>LinkedIn aguardando ativação</strong>
          <p>Falta somente configurar o aplicativo LinkedIn no ambiente da MODO. Nenhuma instalação local é necessária.</p>
        </div>
      </section>
    );
  }

  const published = publication?.status === "published";

  return (
    <section className="instagram-approval-action">
      <div className="instagram-approval-copy">
        <small>MODO PUBLISHER · LINKEDIN NATIVO</small>
        <strong>
          {published
            ? "Publicado no LinkedIn"
            : status.connected
              ? `Publicar como ${status.displayName || "conta conectada"}`
              : "Conectar o LinkedIn"}
        </strong>
        <p>
          {published
            ? "A publicação aprovada foi enviada diretamente pela API do LinkedIn."
            : status.connected
              ? "A MODO publica diretamente no LinkedIn, sem Postiz e sem software instalado no seu computador."
              : "Conecte seu LinkedIn nas integrações para publicar diretamente pela MODO."}
        </p>
        {error && <div className="portal-error">{error}</div>}
      </div>
      <div className="instagram-approval-actions">
        {published ? (
          <span className="instagram-published-id">Publicação concluída</span>
        ) : status.connected ? (
          <button
            type="button"
            className="button button-primary"
            disabled={working || !status.canPublishText}
            onClick={() => void publish()}
          >
            {working ? "Publicando..." : "Publicar no LinkedIn"}
          </button>
        ) : (
          <a className="button button-primary" href="/app/settings/integrations">Conectar LinkedIn</a>
        )}
      </div>
      <p className="instagram-governance-note">Nada é publicado automaticamente. A publicação exige aprovação e confirmação explícita.</p>
    </section>
  );
}
