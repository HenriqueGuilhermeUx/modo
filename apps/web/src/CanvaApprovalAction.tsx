import { useEffect, useState } from "react";
import {
  connectCanva,
  createCanvaDesign,
  getCanvaDesign,
  getCanvaStatus,
  type CanvaDesign,
  type CanvaStatus,
} from "./canva-api";

export default function CanvaApprovalAction({ contentRequestId }: { contentRequestId: string }) {
  const [status, setStatus] = useState<CanvaStatus | null>(null);
  const [design, setDesign] = useState<CanvaDesign | null>(null);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    const query = new URLSearchParams(window.location.search);
    const callbackMessage = query.get("canvaMessage");
    if (query.get("canva") === "error" && callbackMessage) setError(callbackMessage);
    Promise.all([getCanvaStatus(), getCanvaDesign(contentRequestId)])
      .then(([nextStatus, nextDesign]) => {
        if (!active) return;
        setStatus(nextStatus);
        setDesign(nextDesign.design);
      })
      .catch((caught) => {
        if (active) setError(caught instanceof Error ? caught.message : "Não foi possível carregar o Canva.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, [contentRequestId]);

  async function handleConnect() {
    setWorking(true);
    setError("");
    try {
      const result = await connectCanva(contentRequestId);
      window.location.assign(result.authorizationUrl);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Não foi possível conectar o Canva.");
      setWorking(false);
    }
  }

  async function handleCreate() {
    setWorking(true);
    setError("");
    try {
      const result = await createCanvaDesign(contentRequestId);
      setDesign(result.design);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Não foi possível criar a versão no Canva.");
    } finally {
      setWorking(false);
    }
  }

  if (loading) {
    return <section className="canva-approval-action loading"><span className="portal-spinner" /><p>Preparando a etapa Canva...</p></section>;
  }

  if (!status?.integrationConfigured) {
    return (
      <section className="canva-approval-action unavailable">
        <div><small>ETAPA PÓS-APROVAÇÃO</small><strong>Canva aguardando ativação</strong><p>A peça já está aprovada. A conexão Canva será exibida quando o aplicativo estiver configurado pela MODO.</p></div>
      </section>
    );
  }

  return (
    <section className="canva-approval-action">
      <div className="canva-approval-copy">
        <small>ETAPA PÓS-APROVAÇÃO</small>
        <strong>{design ? "Versão criada no Canva" : status.connected ? "Criar versão editável no Canva" : "Conectar o Canva"}</strong>
        <p>{design ? "Este pedido já possui um design Canva vinculado. O mesmo link será reutilizado para evitar duplicações." : status.message}</p>
        {error && <div className="portal-error">{error}</div>}
      </div>
      <div className="canva-approval-actions">
        {design ? (
          <a className="button button-primary" href={design.editUrl} target="_blank" rel="noreferrer">Abrir no Canva ↗</a>
        ) : status.connected ? (
          <button className="button button-primary" type="button" disabled={working} onClick={() => void handleCreate()}>{working ? "Enviando imagem aprovada..." : "Criar versão no Canva"}</button>
        ) : (
          <button className="button button-primary" type="button" disabled={working} onClick={() => void handleConnect()}>{working ? "Abrindo autorização..." : "Conectar Canva"}</button>
        )}
      </div>
      <p className="canva-governance-note">A MODO envia apenas a imagem e o conteúdo que já passaram pela sua aprovação. Nenhuma publicação é realizada automaticamente.</p>
    </section>
  );
}
