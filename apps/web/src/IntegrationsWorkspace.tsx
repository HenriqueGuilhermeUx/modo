import type { Dashboard } from "@modo/contracts";
import type { InstagramConnectionStatus } from "@modo/contracts/instagram";
import type { LinkedInConnectionStatus } from "@modo/contracts/linkedin";
import { useEffect, useState } from "react";
import { getDashboard, getSessionToken } from "./api";
import { connectCanva, disconnectCanva, getCanvaStatus, type CanvaStatus } from "./canva-api";
import { connectInstagram, disconnectInstagram, getInstagramStatus } from "./instagram-api";
import { connectLinkedIn, disconnectLinkedIn, getLinkedInStatus } from "./linkedin-api";

type Action = "canva" | "linkedin" | "instagram" | "";
export default function IntegrationsWorkspace() {
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [canva, setCanva] = useState<CanvaStatus | null>(null);
  const [linkedin, setLinkedin] = useState<LinkedInConnectionStatus | null>(null);
  const [instagram, setInstagram] = useState<InstagramConnectionStatus | null>(null);
  const [brandId, setBrandId] = useState("");
  const [loading, setLoading] = useState(true);
  const [action, setAction] = useState<Action>("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [returnContentId, setReturnContentId] = useState("");

  async function load() {
    setLoading(true);
    try {
      const [currentDashboard, canvaStatus, linkedInStatus, instagramStatus] = await Promise.all([getDashboard(), getCanvaStatus(), getLinkedInStatus(), getInstagramStatus()]);
      setDashboard(currentDashboard); setCanva(canvaStatus); setLinkedin(linkedInStatus); setInstagram(instagramStatus);
      setBrandId((current) => current || instagramStatus.brandId || currentDashboard.brands[0]?.id || "");
      setError("");
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Não foi possível carregar as integrações.") }
    finally { setLoading(false) }
  }

  useEffect(() => {
    if (!getSessionToken()) { window.location.href = "/app"; return }
    const query = new URLSearchParams(window.location.search);
    const result = query.get("instagram");
    if (result === "connected") {
      setSuccess("Instagram conectado com sucesso. A conta já pode receber conteúdos aprovados.");
      const contentId = window.sessionStorage.getItem("modo.instagramReturnContent") || "";
      setReturnContentId(contentId);
      window.sessionStorage.removeItem("modo.instagramReturnContent");
    }
    if (result === "error") setError(query.get("instagramMessage") || "A conexão com o Instagram não foi concluída.");
    if (result) {
      query.delete("instagram"); query.delete("instagramMessage");
      const next = query.toString();
      window.history.replaceState({}, "", window.location.pathname + (next ? `?${next}` : ""));
    }
    void load();
  }, []);

  async function connect(provider: Exclude<Action, "">) {
    setAction(provider); setError("");
    try {
      if (provider === "canva") { window.location.assign((await connectCanva()).authorizationUrl); return }
      if (provider === "linkedin") { window.location.assign((await connectLinkedIn({ authorType: "member" })).authorizationUrl); return }
      window.location.assign((await connectInstagram(brandId ? { brandId } : {})).authorizationUrl);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Não foi possível iniciar a conexão."); setAction("") }
  }
  async function disconnect(provider: Exclude<Action, "">) {
    setAction(provider); setError("");
    try {
      if (provider === "canva") await disconnectCanva();
      if (provider === "linkedin") await disconnectLinkedIn();
      if (provider === "instagram") await disconnectInstagram();
      setSuccess(`${provider === "linkedin" ? "LinkedIn" : provider === "instagram" ? "Instagram" : "Canva"} desconectado.`);
      await load();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Não foi possível desconectar a integração.") }
    finally { setAction("") }
  }

  if (loading && !dashboard) return <main className="portal-loading"><img src="/logo.svg" alt="MODO" /><div className="portal-spinner" /><p>Carregando integrações...</p></main>;
  if (!dashboard || !canva || !linkedin || !instagram) return <main className="portal-loading"><p>{error || "Sua sessão expirou."}</p><a className="button button-primary" href="/app">Entrar novamente</a></main>;

  return (
    <div className="integrations-shell">
      <header className="workspace-header">
        <a href="/app"><img src="/logo.svg" alt="MODO" /></a>
        <nav><a href="/app">Painel</a><a href="/app/content">Criar</a><a href="/app/linkedin">LinkedIn</a><a className="active" href="/app/settings/integrations">Integrações</a><a href="/app/planos">Planos</a></nav>
        <div className="workspace-balance"><small>Saldo</small><strong>{dashboard.usage.creditsRemaining}</strong><span>créditos</span></div>
      </header>
      <main className="integrations-main">
        <section className="integrations-hero">
          <div><div className="section-kicker">CONFIGURAÇÕES</div><h1>Conecte os canais que completam sua operação.</h1><p>Autorize cada serviço diretamente. Tokens são protegidos e nenhuma publicação acontece sem uma ação explícita.</p></div>
          <a className="button button-outline" href="/app">← Voltar ao painel</a>
        </section>
        {error && <div className="portal-error">{error}</div>}
        {success && <div className="workspace-success">{success}{returnContentId && <a href={`/app/content?open=${returnContentId}`}> Voltar ao conteúdo aprovado →</a>}</div>}
        <section className="integrations-grid">
          <article className={`integration-card instagram ${instagram.connected ? "connected" : ""}`}>
            <div className="integration-card-head"><span>Instagram</span><b>{instagram.connected ? "Conectado" : instagram.integrationConfigured ? "Disponível" : "Aguardando configuração"}</b></div>
            <h2>{instagram.connected ? `@${instagram.instagramUsername}` : "Instagram Business Login"}</h2><p>{instagram.message}</p>
            {dashboard.brands.length > 0 && !instagram.connected && <label>Vincular à marca<select value={brandId} onChange={(event) => setBrandId(event.target.value)}>{dashboard.brands.map((brand) => <option key={brand.id} value={brand.id}>{brand.name}</option>)}</select></label>}
            <div className="integration-scopes">{instagram.scopes.map((scope) => <span key={scope}>{scope.replace("instagram_business_", "")}</span>)}</div>
            {instagram.connected ? <button className="button button-outline" disabled={action === "instagram"} onClick={() => void disconnect("instagram")}>{action === "instagram" ? "Desconectando..." : "Desconectar Instagram"}</button> : <button className="button button-primary" disabled={!instagram.integrationConfigured || action === "instagram"} onClick={() => void connect("instagram")}>{action === "instagram" ? "Abrindo Instagram..." : "Conectar Instagram"}</button>}
          </article>
          <article className={`integration-card ${canva.connected ? "connected" : ""}`}>
            <div className="integration-card-head"><span>Canva</span><b>{canva.connected ? "Conectado" : canva.integrationConfigured ? "Disponível" : "Aguardando configuração"}</b></div>
            <h2>Acabamento e edição visual</h2><p>{canva.message}</p><div className="integration-scopes">{canva.scopes.map((scope) => <span key={scope}>{scope}</span>)}</div>
            {canva.connected ? <button className="button button-outline" disabled={action === "canva"} onClick={() => void disconnect("canva")}>{action === "canva" ? "Desconectando..." : "Desconectar Canva"}</button> : <button className="button button-primary" disabled={!canva.integrationConfigured || action === "canva"} onClick={() => void connect("canva")}>{action === "canva" ? "Abrindo Canva..." : "Conectar Canva"}</button>}
          </article>
          <article className={`integration-card ${linkedin.connected ? "connected" : ""}`}>
            <div className="integration-card-head"><span>LinkedIn</span><b>{linkedin.connected ? "Conectado" : linkedin.integrationConfigured ? "Disponível" : "Aguardando configuração"}</b></div>
            <h2>{linkedin.connected ? linkedin.displayName : "Perfil profissional"}</h2><p>{linkedin.message}</p><div className="integration-scopes">{linkedin.scopes.map((scope) => <span key={scope}>{scope}</span>)}</div>
            {linkedin.connected ? <button className="button button-outline" disabled={action === "linkedin"} onClick={() => void disconnect("linkedin")}>{action === "linkedin" ? "Desconectando..." : "Desconectar LinkedIn"}</button> : <button className="button button-primary" disabled={!linkedin.integrationConfigured || action === "linkedin"} onClick={() => void connect("linkedin")}>{action === "linkedin" ? "Abrindo LinkedIn..." : "Conectar LinkedIn"}</button>}
          </article>
        </section>
        <section className="integrations-governance"><strong>Governança MODO</strong><p>As credenciais não aparecem no navegador nem nos logs. Desconectar remove a autorização armazenada para a organização.</p></section>
      </main>
    </div>
  );
}
