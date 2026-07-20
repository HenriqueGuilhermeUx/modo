import type { Dashboard } from "@modo/contracts";
import type { ContentRequest, GeneratedContent } from "@modo/contracts/content";
import type {
  LinkedInConnectionStatus,
  LinkedInPublication,
} from "@modo/contracts/linkedin";
import { useEffect, useMemo, useState } from "react";
import { getDashboard, getSessionToken, listContentRequests } from "./api";
import {
  connectLinkedIn,
  disconnectLinkedIn,
  downloadLinkedInDocument,
  getLinkedInStatus,
  listLinkedInPublications,
  publishToLinkedIn,
} from "./linkedin-api";

const publicationLabels: Record<LinkedInPublication["status"], string> = {
  draft: "Rascunho",
  scheduled: "Agendado",
  publishing: "Publicando",
  published: "Publicado",
  failed: "Falhou",
  manual: "Pronto para publicar manualmente",
};

function buildLinkedInText(output: GeneratedContent) {
  const parts = [output.hook, output.caption, output.cta, output.hashtags.join(" ")].filter(Boolean);
  const unique: string[] = [];
  for (const part of parts) {
    if (!unique.some((current) => current.trim() === part.trim())) unique.push(part.trim());
  }
  return unique.join("\n\n");
}

export default function LinkedInWorkspace() {
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [requests, setRequests] = useState<ContentRequest[]>([]);
  const [status, setStatus] = useState<LinkedInConnectionStatus | null>(null);
  const [publications, setPublications] = useState<LinkedInPublication[]>([]);
  const [loading, setLoading] = useState(true);
  const [action, setAction] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [organizationUrn, setOrganizationUrn] = useState("");
  const [organizationName, setOrganizationName] = useState("");
  const [schedules, setSchedules] = useState<Record<string, string>>({});

  async function load() {
    setLoading(true);
    try {
      const [currentDashboard, currentRequests, currentStatus, currentPublications] = await Promise.all([
        getDashboard(),
        listContentRequests(),
        getLinkedInStatus(),
        listLinkedInPublications(),
      ]);
      setDashboard(currentDashboard);
      setRequests(currentRequests);
      setStatus(currentStatus);
      setPublications(currentPublications);
      setError("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Não foi possível abrir o MODO LinkedIn.");
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
    if (query.get("linkedin") === "connected") setSuccess("LinkedIn conectado com sucesso.");
    if (query.get("linkedin") === "error") setError(query.get("message") || "A conexão com o LinkedIn não foi concluída.");
    if (query.has("linkedin")) window.history.replaceState({}, "", "/app/linkedin");
    void load();
  }, []);

  const linkedInContent = useMemo(
    () => requests.filter((item) => /^linkedin$/i.test(item.channel.trim())),
    [requests],
  );
  const approved = linkedInContent.filter((item) => item.status === "approved" && item.output);
  const waitingApproval = linkedInContent.filter((item) => item.status === "ready");

  async function connect(authorType: "member" | "organization") {
    setAction(`connect-${authorType}`);
    setError("");
    try {
      const result = await connectLinkedIn({
        authorType,
        ...(authorType === "organization" ? { organizationUrn, organizationName } : {}),
      });
      window.location.href = result.authorizationUrl;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Não foi possível iniciar a conexão.");
      setAction("");
    }
  }

  async function disconnect() {
    setAction("disconnect");
    try {
      await disconnectLinkedIn();
      setSuccess("LinkedIn desconectado.");
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Não foi possível desconectar.");
    } finally {
      setAction("");
    }
  }

  async function copyPost(request: ContentRequest) {
    if (!request.output) return;
    await navigator.clipboard.writeText(buildLinkedInText(request.output));
    setSuccess("Post copiado. Ele já pode ser publicado manualmente no LinkedIn.");
  }

  async function downloadDocument(request: ContentRequest) {
    setAction(`document-${request.id}`);
    try {
      await downloadLinkedInDocument(request.id);
      setSuccess("Documento PDF gerado e baixado.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Não foi possível gerar o documento.");
    } finally {
      setAction("");
    }
  }

  async function publish(request: ContentRequest, scheduled = false) {
    setAction(`publish-${request.id}`);
    setError("");
    try {
      const localDate = schedules[request.id];
      const scheduledFor = scheduled && localDate ? new Date(localDate).toISOString() : undefined;
      const publication = await publishToLinkedIn(request.id, scheduledFor);
      setPublications((current) => [publication, ...current.filter((item) => item.contentRequestId !== request.id)]);
      setSuccess(
        publication.status === "manual"
          ? "A integração oficial ainda não está conectada. O conteúdo ficou pronto para publicação manual."
          : publication.status === "scheduled"
            ? "Publicação agendada com sucesso."
            : "Conteúdo enviado ao LinkedIn.",
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Não foi possível publicar.");
    } finally {
      setAction("");
    }
  }

  function createLinkedInContent(type: "post" | "document") {
    const brandId = dashboard?.brands[0]?.id;
    if (!brandId) {
      window.location.href = "/app#brands";
      return;
    }
    window.sessionStorage.setItem("modo.directorPrefill", JSON.stringify({
      brandId,
      contentType: type === "document" ? "carousel" : "static_post",
      objective: "autoridade",
      channel: "LinkedIn",
      brief: type === "document"
        ? "Crie um documento educativo para LinkedIn com capa forte, progressão clara, exemplos práticos e fechamento que convide à conversa. Adapte a linguagem ao ambiente profissional e use o contexto conhecido da marca."
        : "Crie um post de LinkedIn com ponto de vista, abertura forte, experiência ou aprendizado concreto e uma conclusão que estimule conversa profissional. Evite tom genérico e adapte ao contexto conhecido da marca.",
    }));
    window.location.href = "/app/content";
  }

  if (loading && !dashboard) return <main className="portal-loading"><img src="/logo.svg" alt="MODO" /><div className="portal-spinner" /><p>Preparando o LinkedIn...</p></main>;
  if (!dashboard || !status) return <main className="portal-loading"><p>{error || "Sua sessão expirou."}</p><a className="button button-primary" href="/app">Entrar novamente</a></main>;

  return (
    <div className="linkedin-shell">
      <header className="workspace-header">
        <a href="/app"><img src="/logo.svg" alt="MODO" /></a>
        <nav><a href="/app">Painel</a><a href="/app/director">Diretor</a><a href="/app/content">Criar</a><a className="active" href="/app/linkedin">LinkedIn</a><a href="/app/planos">Planos</a></nav>
        <div className="workspace-balance"><small>Saldo</small><strong>{dashboard.usage.creditsRemaining}</strong><span>créditos</span></div>
      </header>

      <main className="linkedin-main">
        <section className="linkedin-hero">
          <div><div className="section-kicker">MODO LINKEDIN</div><h1>Autoridade profissional com direção, repertório e consistência.</h1><p>Crie posts, documentos e histórias profissionais; aprove; publique manualmente ou conecte o LinkedIn para agendar e distribuir pela MODO.</p></div>
          <div className="linkedin-create-actions"><button className="button button-primary" onClick={() => createLinkedInContent("post")}>Criar post</button><button className="button button-outline" onClick={() => createLinkedInContent("document")}>Criar documento PDF</button></div>
        </section>

        {error && <div className="portal-error">{error}</div>}
        {success && <div className="workspace-success">{success}</div>}

        <section className={`linkedin-connection ${status.connected ? "connected" : ""}`}>
          <div className="linkedin-connection-copy"><small>CONEXÃO OFICIAL</small><h2>{status.connected ? status.displayName : status.integrationConfigured ? "Conecte seu LinkedIn" : "Modo manual disponível"}</h2><p>{status.message}</p>{status.connected && <div className="linkedin-scope-list">{status.scopes.map((scope) => <span key={scope}>{scope}</span>)}</div>}</div>

          {status.connected ? (
            <button className="button button-outline" disabled={action === "disconnect"} onClick={() => void disconnect()}>{action === "disconnect" ? "Desconectando..." : "Desconectar"}</button>
          ) : status.integrationConfigured ? (
            <div className="linkedin-connect-options">
              <button className="button button-primary" disabled={Boolean(action)} onClick={() => void connect("member")}>Conectar perfil pessoal</button>
              <div className="linkedin-company-connect"><strong>Ou conectar página da empresa</strong><input value={organizationUrn} onChange={(event) => setOrganizationUrn(event.target.value)} placeholder="urn:li:organization:123456" /><input value={organizationName} onChange={(event) => setOrganizationName(event.target.value)} placeholder="Nome da empresa" /><button className="button button-outline" disabled={!organizationUrn || Boolean(action)} onClick={() => void connect("organization")}>Conectar página</button></div>
            </div>
          ) : (
            <div className="linkedin-manual-note"><strong>A integração está tecnicamente pronta.</strong><p>Cadastre o aplicativo LinkedIn e as credenciais no Render para habilitar publicação direta. Enquanto isso, copie o post ou baixe o PDF.</p></div>
          )}
        </section>

        <section className="linkedin-content-section">
          <div className="linkedin-section-head"><div><small>CONTEÚDOS APROVADOS</small><h2>Prontos para distribuição</h2></div><span>{approved.length} pronto(s)</span></div>

          {waitingApproval.length > 0 && <div className="linkedin-waiting"><strong>{waitingApproval.length} conteúdo(s) aguardando sua aprovação.</strong><a href="/app/content">Revisar agora →</a></div>}

          {approved.length === 0 ? (
            <div className="linkedin-empty"><h3>Nenhum conteúdo aprovado para LinkedIn.</h3><p>Crie um post ou documento, revise no MODO Create e aprove.</p></div>
          ) : (
            <div className="linkedin-content-grid">
              {approved.map((request) => {
                const publication = publications.find((item) => item.contentRequestId === request.id);
                return <article className="linkedin-content-card" key={request.id}>
                  <div className="linkedin-content-card-top"><span>{request.contentType === "carousel" ? "Documento" : "Post"}</span>{publication && <b className={publication.status}>{publicationLabels[publication.status]}</b>}</div>
                  <h3>{request.output!.hook}</h3>
                  <p>{request.output!.caption}</p>
                  <div className="linkedin-card-actions"><button className="button button-outline" onClick={() => void copyPost(request)}>Copiar texto</button>{request.output!.slides.length > 0 && <button className="button button-outline" disabled={action === `document-${request.id}`} onClick={() => void downloadDocument(request)}>Baixar PDF</button>}</div>
                  <div className="linkedin-schedule"><label>Agendar para<input type="datetime-local" value={schedules[request.id] || ""} onChange={(event) => setSchedules((current) => ({ ...current, [request.id]: event.target.value }))} /></label><div><button className="button button-primary" disabled={action === `publish-${request.id}`} onClick={() => void publish(request, false)}>Publicar agora</button><button className="button button-outline" disabled={!schedules[request.id] || action === `publish-${request.id}`} onClick={() => void publish(request, true)}>Agendar</button></div></div>
                  {publication?.error && <div className="linkedin-publication-error">{publication.error}</div>}
                </article>;
              })}
            </div>
          )}
        </section>

        <section className="linkedin-history">
          <div className="linkedin-section-head"><div><small>HISTÓRICO</small><h2>Fila e publicações</h2></div><span>{publications.length} registro(s)</span></div>
          {publications.length === 0 ? <p>Nenhuma publicação registrada.</p> : <div>{publications.map((item) => <article key={item.id}><span className={item.status}>{publicationLabels[item.status]}</span><div><strong>{item.postUrn || "Conteúdo MODO"}</strong><small>{item.scheduledFor ? `Agendado: ${new Date(item.scheduledFor).toLocaleString("pt-BR")}` : item.publishedAt ? `Publicado: ${new Date(item.publishedAt).toLocaleString("pt-BR")}` : "Sem data"}</small></div></article>)}</div>}
        </section>
      </main>
    </div>
  );
}
