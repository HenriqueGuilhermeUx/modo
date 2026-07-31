import type { InstagramConnectionStatus, InstagramPublication } from "@modo/contracts/instagram";
import { useEffect, useState } from "react";
import { connectInstagram, getInstagramStatus, publishToInstagram } from "./instagram-api";

interface Props { contentRequestId: string; brandId: string }
export default function InstagramApprovalAction({ contentRequestId, brandId }: Props) {
  const [status, setStatus] = useState<InstagramConnectionStatus | null>(null);
  const [publication, setPublication] = useState<InstagramPublication | null>(null);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    void getInstagramStatus().then((result) => { if (active) setStatus(result) }).catch((caught) => { if (active) setError(caught instanceof Error ? caught.message : "Não foi possível carregar o Instagram.") }).finally(() => { if (active) setLoading(false) });
    return () => { active = false };
  }, []);
  async function handleConnect() {
    setWorking(true); setError("");
    try {
      window.sessionStorage.setItem("modo.instagramReturnContent", contentRequestId);
      window.location.assign((await connectInstagram({ brandId })).authorizationUrl);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Não foi possível conectar o Instagram."); setWorking(false) }
  }
  async function handlePublish() {
    setWorking(true); setError("");
    try { setPublication(await publishToInstagram(contentRequestId)) }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Não foi possível publicar no Instagram.") }
    finally { setWorking(false) }
  }
  if (loading) return <section className="instagram-approval-action loading"><span className="portal-spinner" /><p>Verificando a conexão Instagram...</p></section>;
  if (!status?.integrationConfigured) return <section className="instagram-approval-action unavailable"><small>DISTRIBUIÇÃO</small><strong>Instagram aguardando ativação</strong><p>A peça permanece aprovada e pronta. A publicação direta aparecerá quando o aplicativo estiver configurado pela MODO.</p></section>;
  return (
    <section className="instagram-approval-action">
      <div className="instagram-approval-copy">
        <small>DISTRIBUIÇÃO OFICIAL</small>
        <strong>{publication ? "Publicado no Instagram" : status.connected ? `Publicar como @${status.instagramUsername}` : "Conectar Instagram"}</strong>
        <p>{publication ? "A versão aprovada foi publicada. O mesmo pedido não será duplicado em uma nova tentativa." : status.connected ? "A MODO enviará a imagem e a legenda aprovadas para a conta conectada." : status.message}</p>
        {error && <div className="portal-error">{error}</div>}
      </div>
      <div className="instagram-approval-actions">
        {publication?.permalink ? <a className="button button-primary" href={publication.permalink} target="_blank" rel="noreferrer">Abrir post no Instagram ↗</a>
          : publication ? <span className="instagram-published-id">Post publicado · {publication.mediaId}</span>
          : status.connected ? <button className="button button-primary" type="button" disabled={working} onClick={() => void handlePublish()}>{working ? "Publicando..." : error ? "Tentar novamente" : "Publicar no Instagram"}</button>
          : <button className="button button-primary" type="button" disabled={working} onClick={() => void handleConnect()}>{working ? "Abrindo autorização..." : "Conectar Instagram"}</button>}
      </div>
      <p className="instagram-governance-note">A publicação só ocorre após sua ação explícita. A MODO usa o identificador retornado pela conta autenticada e nunca um ID fixo.</p>
    </section>
  );
}
