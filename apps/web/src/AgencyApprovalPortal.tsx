import { type FormEvent, useEffect, useMemo, useState } from "react";
import {
  approveAgencyContent,
  getAgencyApprovalPortal,
  requestAgencyContentRevision,
  type AgencyApprovalItem,
  type AgencyApprovalPortal as PortalData,
} from "./agency-api";

const formatLabels: Record<AgencyApprovalItem["contentType"], string> = {
  static_post: "Post",
  story: "Stories",
  carousel: "Carrossel",
  short_video_script: "Vídeo",
  channel_adaptation: "Adaptação",
};

function formatDate(value: string) {
  return new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(value));
}

function ItemPreview({ item }: { item: AgencyApprovalItem }) {
  const output = item.output;
  if (!output) return <p className="agency-approval-brief">{item.brief}</p>;
  return (
    <div className="agency-approval-preview">
      {output.imageUrl && <img src={output.imageUrl} alt={output.imageAlt || output.title} />}
      <div className="agency-approval-copy">
        <small>GANCHO</small>
        <strong>{output.hook}</strong>
        <h3>{output.title}</h3>
        <p>{output.caption}</p>
        {output.slides.length > 0 && (
          <div className="agency-approval-slides">
            {output.slides.map((slide, index) => <div key={`${slide.title}-${index}`}><b>{index + 1}. {slide.title}</b><span>{slide.body}</span></div>)}
          </div>
        )}
        {output.storyFrames.length > 0 && (
          <div className="agency-approval-slides">
            {output.storyFrames.map((frame, index) => <div key={`${frame.headline}-${index}`}><b>{index + 1}. {frame.headline}</b><span>{frame.body}</span></div>)}
          </div>
        )}
        {output.script.length > 0 && (
          <div className="agency-approval-slides">
            {output.script.map((scene, index) => <div key={`${scene.scene}-${index}`}><b>{index + 1}. {scene.scene}</b><span>{scene.voiceover}</span></div>)}
          </div>
        )}
        <div className="agency-approval-cta"><small>CHAMADA PARA AÇÃO</small><strong>{output.cta}</strong></div>
      </div>
    </div>
  );
}

export default function AgencyApprovalPortal() {
  const token = window.location.pathname.split("/").filter(Boolean).pop() || "";
  const [portal, setPortal] = useState<PortalData | null>(null);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState("");
  const [revisionId, setRevisionId] = useState("");
  const [instructions, setInstructions] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function load() {
    try {
      setPortal(await getAgencyApprovalPortal(token));
      setError("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Não foi possível abrir este portal de aprovação.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, []);

  async function approve(item: AgencyApprovalItem) {
    setWorking(item.id);
    setError("");
    try {
      await approveAgencyContent(token, item.id);
      setMessage("Conteúdo aprovado. A agência já pode seguir com a publicação.");
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Não foi possível aprovar o conteúdo.");
    } finally {
      setWorking("");
    }
  }

  async function requestRevision(event: FormEvent) {
    event.preventDefault();
    if (!revisionId) return;
    setWorking(revisionId);
    setError("");
    try {
      await requestAgencyContentRevision(token, revisionId, instructions);
      setMessage("Ajuste solicitado. A MODO já enviou o pedido para uma nova revisão da agência.");
      setRevisionId("");
      setInstructions("");
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Não foi possível solicitar o ajuste.");
    } finally {
      setWorking("");
    }
  }

  const waiting = useMemo(() => portal?.items.filter((item) => item.status === "ready") || [], [portal]);
  const decided = useMemo(() => portal?.items.filter((item) => item.status !== "ready") || [], [portal]);

  if (loading) {
    return <main className="agency-approval-loading"><img src="/logo.svg" alt="MODO" /><div className="portal-spinner" /><p>Preparando conteúdos para sua revisão...</p></main>;
  }

  if (!portal) {
    return <main className="agency-approval-invalid"><img src="/logo.svg" alt="MODO" /><span>PORTAL DE APROVAÇÃO</span><h1>Este link não está mais disponível.</h1><p>{error || "Peça à sua agência um novo link de aprovação."}</p></main>;
  }

  return (
    <div className="agency-approval-shell">
      <header className="agency-approval-header">
        <div><img src="/logo.svg" alt="MODO" /><span>APROVAÇÃO</span></div>
        <small>Portal seguro · válido até {formatDate(portal.expiresAt)}</small>
      </header>

      <main className="agency-approval-main">
        <section className="agency-approval-hero">
          <div><small>CONTEÚDO DE {portal.brand.name.toUpperCase()}</small><h1>Revise o que vai ao ar.</h1><p>Você está vendo apenas as peças compartilhadas para esta marca. Aprove o que estiver pronto ou descreva exatamente o ajuste que precisa.</p></div>
          <aside><strong>{waiting.length}</strong><span>{waiting.length === 1 ? "peça aguardando decisão" : "peças aguardando decisão"}</span></aside>
        </section>

        {message && <div className="agency-approval-success">✓ {message}</div>}
        {error && <div className="agency-ws-error wide">{error}</div>}

        {waiting.length === 0 ? (
          <section className="agency-approval-empty"><span>✓</span><h2>Tudo revisado por enquanto.</h2><p>Quando a agência compartilhar uma nova peça, ela aparecerá neste mesmo portal enquanto o link estiver válido.</p></section>
        ) : (
          <section className="agency-approval-list">
            {waiting.map((item) => (
              <article className="agency-approval-card" key={item.id}>
                <header><div><span>{formatLabels[item.contentType]}</span><b>{item.channel}</b></div><small>Atualizado {formatDate(item.updatedAt)}</small></header>
                <ItemPreview item={item} />
                <footer>
                  <button type="button" className="agency-approval-revision" onClick={() => { setRevisionId(item.id); setInstructions(""); }}>Solicitar ajuste</button>
                  <button type="button" className="agency-approval-approve" onClick={() => void approve(item)} disabled={working === item.id}>{working === item.id ? "Aprovando..." : "Aprovar conteúdo ✓"}</button>
                </footer>
              </article>
            ))}
          </section>
        )}

        {decided.length > 0 && (
          <section className="agency-approval-history">
            <div><small>HISTÓRICO</small><h2>Decisões recentes</h2></div>
            {decided.map((item) => <article key={item.id}><div><strong>{item.output?.title || item.brief}</strong><span>{formatLabels[item.contentType]} · {item.channel}</span></div><b className={item.status === "approved" ? "approved" : "revision"}>{item.status === "approved" ? "Aprovado" : "Ajuste solicitado"}</b></article>)}
          </section>
        )}
      </main>

      <footer className="agency-approval-footer">MODO · Conteúdo com contexto, revisão e controle.</footer>

      {revisionId && (
        <div className="agency-ws-modal-backdrop" onMouseDown={() => setRevisionId("")}>
          <form className="agency-approval-modal" onSubmit={requestRevision} onMouseDown={(event) => event.stopPropagation()}>
            <button type="button" className="agency-ws-modal-close" onClick={() => setRevisionId("")}>×</button>
            <small>SOLICITAR AJUSTE</small><h2>O que precisa mudar?</h2><p>Seja específico. Sua orientação será registrada no histórico e usada para preparar a próxima versão.</p>
            <textarea autoFocus minLength={5} maxLength={1500} required value={instructions} onChange={(event) => setInstructions(event.target.value)} placeholder="Ex.: trocar o enfoque do primeiro slide, retirar esta promessa e deixar o CTA menos comercial..." />
            <button className="agency-approval-approve" disabled={working === revisionId}>{working === revisionId ? "Enviando..." : "Enviar ajuste"}</button>
          </form>
        </div>
      )}
    </div>
  );
}
