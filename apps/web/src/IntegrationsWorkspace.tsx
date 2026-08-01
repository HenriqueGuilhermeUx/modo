import type { Dashboard } from "@modo/contracts";
import type { InstagramConnectionStatus } from "@modo/contracts/instagram";
import type { LinkedInConnectionStatus } from "@modo/contracts/linkedin";
import { useEffect, useState } from "react";
import { getDashboard, getSessionToken } from "./api";
import {
  connectCanva,
  disconnectCanva,
  getCanvaStatus,
  type CanvaStatus,
} from "./canva-api";
import {
  connectInstagram,
  disconnectInstagram,
  getInstagramStatus,
} from "./instagram-api";
import {
  connectLinkedIn,
  disconnectLinkedIn,
  getLinkedInStatus,
} from "./linkedin-api";

export default function IntegrationsWorkspace() {
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [instagram, setInstagram] = useState<InstagramConnectionStatus | null>(null);
  const [canva, setCanva] = useState<CanvaStatus | null>(null);
  const [linkedin, setLinkedin] = useState<LinkedInConnectionStatus | null>(null);
  const [brandId, setBrandId] = useState("");
  const [loading, setLoading] = useState(true);
  const [action, setAction] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  async function load(showLoader = true) {
    if (showLoader) setLoading(true);
    try {
      const [currentDashboard, instagramStatus, canvaStatus, linkedInStatus] = await Promise.all([
        getDashboard(),
        getInstagramStatus(),
        getCanvaStatus(),
        getLinkedInStatus(),
      ]);
      setDashboard(currentDashboard);
      setInstagram(instagramStatus);
      setCanva(canvaStatus);
      setLinkedin(linkedInStatus);
      setBrandId((current) => current || instagramStatus.brandId || currentDashboard.brands[0]?.id || "");
      setError("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Não foi possível carregar as integrações.");
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
    if (query.get("instagram") === "connected") {
      setSuccess("Instagram conectado com sucesso.");
    } else if (query.get("instagram") === "error") {
      setError(query.get("instagramMessage") || "A conexão com o Instagram não foi concluída.");
    }
    if (query.get("canva") === "connected") setSuccess("Canva conectado com sucesso.");
    if (query.get("canva") === "error") {
      setError(query.get("canvaMessage") || "A conexão com o Canva não foi concluída.");
    }
    if (query.get("linkedin") === "connected") setSuccess("LinkedIn conectado com sucesso.");
    if (query.get("linkedin") === "error") {
      setError(query.get("message") || "A conexão com o LinkedIn não foi concluída.");
    }
    if (["instagram", "instagramMessage", "canva", "canvaMessage", "linkedin", "message"].some((key) => query.has(key))) {
      window.history.replaceState({}, "", "/app/settings/integrations");
    }
    void load();
  }, []);

  async function startInstagramConnection() {
    setAction("instagram-connect");
    setError("");
    try {
      const result = await connectInstagram(brandId || undefined);
      window.location.assign(result.authorizationUrl);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Não foi possível iniciar a conexão com o Instagram.");
      setAction("");
    }
  }

  async function startCanvaConnection() {
    setAction("canva-connect");
    setError("");
    try {
      const result = await connectCanva();
      window.location.assign(result.authorizationUrl);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Não foi possível iniciar a conexão com o Canva.");
      setAction("");
    }
  }

  async function startLinkedInConnection() {
    setAction("linkedin-connect");
    setError("");
    try {
      const result = await connectLinkedIn({ authorType: "member" });
      window.location.assign(result.authorizationUrl);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Não foi possível iniciar a conexão com o LinkedIn.");
      setAction("");
    }
  }

  async function disconnect(provider: "instagram" | "canva" | "linkedin") {
    if (!window.confirm(`Desconectar ${provider === "instagram" ? "o Instagram" : provider === "canva" ? "o Canva" : "o LinkedIn"} da MODO?`)) return;
    setAction(`${provider}-disconnect`);
    setError("");
    try {
      if (provider === "instagram") await disconnectInstagram();
      if (provider === "canva") await disconnectCanva();
      if (provider === "linkedin") await disconnectLinkedIn();
      setSuccess("Integração desconectada.");
      await load(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Não foi possível desconectar a integração.");
    } finally {
      setAction("");
    }
  }

  if (loading && !dashboard) {
    return <main className="portal-loading"><img src="/logo.svg" alt="MODO" /><div className="portal-spinner" /><p>Carregando integrações...</p></main>;
  }
  if (!dashboard || !instagram || !canva || !linkedin) {
    return <main className="portal-loading"><p>{error || "Sua sessão expirou."}</p><a className="button button-primary" href="/app">Entrar novamente</a></main>;
  }

  return (
    <div className="integrations-shell">
      <header className="workspace-header">
        <a href="/app"><img src="/logo.svg" alt="MODO" /></a>
        <nav><a href="/app">Painel</a><a href="/app/content">Criar</a><a href="/app/linkedin">LinkedIn</a><a className="active" href="/app/settings/integrations">Integrações</a><a href="/app/planos">Planos</a></nav>
        <div className="workspace-balance"><small>Saldo</small><strong>{dashboard.usage.creditsRemaining}</strong><span>créditos</span></div>
      </header>

      <main className="integrations-main">
        <section className="integrations-hero">
          <div><div className="section-kicker">CONFIGURAÇÕES · INTEGRAÇÕES</div><h1>Conecte as ferramentas que fazem parte da sua rotina.</h1><p>Autorizações acontecem nos ambientes oficiais de cada plataforma. A MODO armazena tokens protegidos e nunca solicita sua senha.</p></div>
          <a className="button button-outline" href="/app">Voltar ao painel</a>
        </section>

        {error && <div className="portal-error">{error}</div>}
        {success && <div className="workspace-success">{success}</div>}

        <section className="integration-grid">
          <article className={`integration-card instagram ${instagram.connected ? "connected" : ""}`}>
            <div className="integration-card-header">
              {instagram.profilePictureUrl ? <img src={instagram.profilePictureUrl} alt={`Foto de @${instagram.username}`} /> : <div className="integration-icon">◎</div>}
              <div><small>INSTAGRAM BUSINESS LOGIN</small><h2>{instagram.connected ? `@${instagram.username}` : "Instagram"}</h2></div>
              <span className={instagram.connected ? "status connected" : "status"}>{instagram.connected ? "Conectado" : "Desconectado"}</span>
            </div>
            <p>{instagram.message}</p>
            {instagram.connected ? (
              <div className="integration-details">
                <div><span>ID da conta</span><strong>{instagram.instagramUserId}</strong></div>
                <div><span>Expira em</span><strong>{instagram.expiresAt ? new Date(instagram.expiresAt).toLocaleDateString("pt-BR") : "—"}</strong></div>
                <div><span>Publicação</span><strong>{instagram.canPublish ? "Autorizada" : "Sem permissão"}</strong></div>
              </div>
            ) : (
              <label className="integration-brand-select">Marca vinculada<select value={brandId} onChange={(event) => setBrandId(event.target.value)}><option value="">Organização inteira</option>{dashboard.brands.map((brand) => <option key={brand.id} value={brand.id}>{brand.name}</option>)}</select></label>
            )}
            <div className="integration-actions">
              {instagram.connected ? <button className="button button-outline" disabled={Boolean(action)} onClick={() => void disconnect("instagram")}>{action === "instagram-disconnect" ? "Desconectando..." : "Desconectar Instagram"}</button> : <button className="button button-primary" disabled={!instagram.integrationConfigured || Boolean(action)} onClick={() => void startInstagramConnection()}>{action === "instagram-connect" ? "Abrindo Instagram..." : instagram.integrationConfigured ? "Conectar Instagram" : "Aguardando configuração"}</button>}
            </div>
            <small className="integration-governance">Depois da conexão, o username e a foto de perfil ficam visíveis nesta tela. A publicação só ocorre após aprovação explícita de uma peça.</small>
          </article>

          <article className={`integration-card canva ${canva.connected ? "connected" : ""}`}>
            <div className="integration-card-header"><div className="integration-icon">C</div><div><small>EDIÇÃO E ACABAMENTO</small><h2>Canva</h2></div><span className={canva.connected ? "status connected" : "status"}>{canva.connected ? "Conectado" : "Desconectado"}</span></div>
            <p>{canva.message}</p>
            <div className="integration-actions">{canva.connected ? <button className="button button-outline" disabled={Boolean(action)} onClick={() => void disconnect("canva")}>{action === "canva-disconnect" ? "Desconectando..." : "Desconectar Canva"}</button> : <button className="button button-primary" disabled={!canva.integrationConfigured || Boolean(action)} onClick={() => void startCanvaConnection()}>{action === "canva-connect" ? "Abrindo Canva..." : canva.integrationConfigured ? "Conectar Canva" : "Aguardando configuração"}</button>}</div>
          </article>

          <article className={`integration-card linkedin ${linkedin.connected ? "connected" : ""}`}>
            <div className="integration-card-header"><div className="integration-icon">in</div><div><small>AUTORIDADE PROFISSIONAL</small><h2>{linkedin.connected ? linkedin.displayName || "LinkedIn" : "LinkedIn"}</h2></div><span className={linkedin.connected ? "status connected" : "status"}>{linkedin.connected ? "Conectado" : "Desconectado"}</span></div>
            <p>{linkedin.message}</p>
            <div className="integration-actions">{linkedin.connected ? <button className="button button-outline" disabled={Boolean(action)} onClick={() => void disconnect("linkedin")}>{action === "linkedin-disconnect" ? "Desconectando..." : "Desconectar LinkedIn"}</button> : <button className="button button-primary" disabled={!linkedin.integrationConfigured || Boolean(action)} onClick={() => void startLinkedInConnection()}>{action === "linkedin-connect" ? "Abrindo LinkedIn..." : linkedin.integrationConfigured ? "Conectar LinkedIn" : "Aguardando configuração"}</button>}</div>
          </article>
        </section>

        <section className="integrations-security">
          <div><small>SEGURANÇA</small><h2>O controle continua com você.</h2></div>
          <ul><li>Nenhuma senha é armazenada pela MODO.</li><li>Tokens são criptografados antes de ir ao banco.</li><li>Instagram usa diretamente graph.instagram.com, sem token de Página do Facebook.</li><li>Você pode revogar cada conexão a qualquer momento.</li></ul>
        </section>
      </main>
    </div>
  );
}
