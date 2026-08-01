import type { InstagramConnectionStatus, InstagramPublishResult } from "@modo/contracts/instagram";
import { useEffect, useState } from "react";
import {
  getInstagramStatus,
  publishContentToInstagram,
} from "./instagram-api";

export default function InstagramApprovalAction({ contentRequestId }: { contentRequestId: string }) {
  const [status, setStatus] = useState<InstagramConnectionStatus | null>(null);
  const [publication, setPublication] = useState<InstagramPublishResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    getInstagramStatus()
      .then((next) => { if (active) setStatus(next); })
      .catch((caught) => { if (active) setError(caught instanceof Error ? caught.message : "Não foi possível carregar o Instagram."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  async function publish() {
    if (!window.confirm("Publicar esta imagem e legenda aprovadas no Instagram agora?")) return;
    setWorking(true);
    setError("");
    try {
      setPublication(await publishContentToInstagram(contentRequestId));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Não foi possível publicar no Instagram.");
    } finally {
      setWorking(false);
    }
  }

  if (loading) {
    return <section className="instagram-approval-action loading"><span className="portal-spinner" /><p>Verificando o Instagram...</p></section>;
  }

  if (!status?.integrationConfigured) {
    return (
      <section className="instagram-approval-action unavailable">
        <div><small>PUBLICAÇÃO APÓS APROVAÇÃO</small><strong>Instagram aguardando ativação</strong><p>As credenciais do aplicativo ainda precisam ser configuradas pela MODO.</p></div>
      </section>
    );
  }

  return (
    <section className="instagram-approval-action">
      <div className="instagram-approval-copy">
        <small>PUBLICAÇÃO APÓS APROVAÇÃO</small>
        <strong>{publication ? "Publicado no Instagram" : status.connected ? `Publicar como @${status.username}` : "Conectar o Instagram"}</strong>
        <p>{publication ? "A imagem e a legenda aprovadas foram publicadas com sucesso." : status.connected ? "A MODO usará somente a imagem final armazenada neste pedido e a legenda aprovada." : "Conecte uma conta profissional nas configurações para liberar a publicação direta."}</p>
        {error && <div className="portal-error">{error}</div>}
      </div>
      <div className="instagram-approval-actions">
        {publication?.permalink ? (
          <a className="button button-primary" href={publication.permalink} target="_blank" rel="noreferrer">Ver post publicado ↗</a>
        ) : publication ? (
          <span className="instagram-published-id">Post ID: {publication.postId}</span>
        ) : status.connected ? (
          <button type="button" className="button button-primary" disabled={!status.canPublish || working} onClick={() => void publish()}>{working ? "Publicando..." : status.canPublish ? "Publicar no Instagram" : "Permissão de publicação ausente"}</button>
        ) : (
          <a className="button button-primary" href="/app/settings/integrations">Conectar Instagram</a>
        )}
      </div>
      <p className="instagram-governance-note">Nada é publicado automaticamente. Esta ação exige conteúdo aprovado e uma confirmação explícita.</p>
    </section>
  );
}
