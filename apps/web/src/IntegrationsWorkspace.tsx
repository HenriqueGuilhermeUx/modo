import type { Dashboard } from "@modo/contracts";
import type { NativeConnection, NativeSocialPlatform } from "@modo/contracts/native-publisher";
import { useEffect, useMemo, useState } from "react";
import { getDashboard, getSessionToken } from "./api";
import {
  connectCanva,
  disconnectCanva,
  getCanvaStatus,
  type CanvaStatus,
} from "./canva-api";
import { connectInstagram } from "./instagram-api";
import { connectLinkedIn } from "./linkedin-api";
import {
  connectNativeMeta,
  disconnectNativeChannel,
  listFacebookCandidates,
  listNativeConnections,
  selectFacebookPage,
} from "./native-publisher-api";

const platformLabels: Record<NativeSocialPlatform, string> = {
  instagram: "Instagram",
  facebook: "Facebook",
  threads: "Threads",
  linkedin: "LinkedIn",
};

const platformEyebrows: Record<NativeSocialPlatform, string> = {
  instagram: "INSTAGRAM BUSINESS LOGIN",
  facebook: "FACEBOOK PAGES",
  threads: "THREADS API",
  linkedin: "AUTORIDADE PROFISSIONAL",
};

const platformIcons: Record<NativeSocialPlatform, string> = {
  instagram: "◎",
  facebook: "f",
  threads: "@",
  linkedin: "in",
};

export default function IntegrationsWorkspace() {
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [connections, setConnections] = useState<NativeConnection[]>([]);
  const [canva, setCanva] = useState<CanvaStatus | null>(null);
  const [brandId, setBrandId] = useState("");
  const [loading, setLoading] = useState(true);
  const [action, setAction] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [selectionId, setSelectionId] = useState("");
  const [facebookPages, setFacebookPages] = useState<Array<{ id: string; name: string; pictureUrl: string | null }>>([]);

  async function loadBrand(nextBrandId: string) {
    if (!nextBrandId) {
      setConnections([]);
      return;
    }
    setConnections(await listNativeConnections(nextBrandId));
  }

  async function load(showLoader = true) {
    if (showLoader) setLoading(true);
    try {
      const [currentDashboard, canvaStatus] = await Promise.all([
        getDashboard(),
        getCanvaStatus(),
      ]);
      setDashboard(currentDashboard);
      setCanva(canvaStatus);
      const query = new URLSearchParams(window.location.search);
      const requestedBrand = query.get("brandId");
      const validRequested = requestedBrand && currentDashboard.brands.some((item) => item.id === requestedBrand)
        ? requestedBrand
        : "";
      const nextBrand = validRequested || brandId || currentDashboard.brands[0]?.id || "";
      setBrandId(nextBrand);
      await loadBrand(nextBrand);
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
    const messages: string[] = [];
    if (query.get("instagram") === "connected") messages.push("Instagram conectado com sucesso.");
    if (query.get("canva") === "connected") messages.push("Canva conectado com sucesso.");
    if (query.get("linkedin") === "connected") messages.push("LinkedIn conectado com sucesso.");
    if (query.get("facebook") === "connected") messages.push("Página do Facebook conectada com sucesso.");
    if (query.get("threads") === "connected") messages.push("Threads conectado com sucesso.");
    const oauthError =
      query.get("instagramMessage") ||
      query.get("canvaMessage") ||
      query.get("message");
    if (oauthError || ["instagram", "canva", "linkedin", "facebook", "threads"].some((key) => query.get(key) === "error")) {
      setError(oauthError || "A autorização não foi concluída.");
    }
    if (messages.length) setSuccess(messages.join(" "));
    const selection = query.get("selection") || "";
    if (query.get("facebook") === "select" && selection) setSelectionId(selection);
    void load();
  }, []);

  useEffect(() => {
    if (!selectionId) {
      setFacebookPages([]);
      return;
    }
    listFacebookCandidates(selectionId)
      .then(setFacebookPages)
      .catch((caught) => setError(caught instanceof Error ? caught.message : "Não foi possível listar suas Páginas."));
  }, [selectionId]);

  const selectedBrand = useMemo(
    () => dashboard?.brands.find((item) => item.id === brandId) || null,
    [dashboard, brandId],
  );

  async function changeBrand(nextBrandId: string) {
    setBrandId(nextBrandId);
    setLoading(true);
    try {
      await loadBrand(nextBrandId);
      setError("");
      window.history.replaceState({}, "", `/app/settings/integrations?brandId=${encodeURIComponent(nextBrandId)}`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Não foi possível mudar de marca.");
    } finally {
      setLoading(false);
    }
  }

  async function connect(platform: NativeSocialPlatform) {
    if (!brandId) return;
    setAction(`connect:${platform}`);
    setError("");
    try {
      if (platform === "instagram") {
        const result = await connectInstagram(brandId);
        window.location.assign(result.authorizationUrl);
        return;
      }
      if (platform === "linkedin") {
        const result = await connectLinkedIn({ authorType: "member" });
        window.location.assign(result.authorizationUrl);
        return;
      }
      const result = await connectNativeMeta(platform, brandId);
      window.location.assign(result.authorizationUrl);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : `Não foi possível conectar ${platformLabels[platform]}.`);
      setAction("");
    }
  }

  async function disconnect(platform: NativeSocialPlatform) {
    if (!brandId) return;
    if (!window.confirm(`Desconectar ${platformLabels[platform]} da marca ${selectedBrand?.name || "selecionada"}?`)) return;
    setAction(`disconnect:${platform}`);
    try {
      await disconnectNativeChannel(brandId, platform);
      setSuccess(`${platformLabels[platform]} desconectado desta marca.`);
      await loadBrand(brandId);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Não foi possível desconectar a integração.");
    } finally {
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

  async function disconnectCurrentCanva() {
    if (!window.confirm("Desconectar o Canva da MODO?")) return;
    setAction("canva-disconnect");
    try {
      await disconnectCanva();
      setSuccess("Canva desconectado.");
      setCanva(await getCanvaStatus());
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Não foi possível desconectar o Canva.");
    } finally {
      setAction("");
    }
  }

  async function chooseFacebookPage(pageId: string) {
    if (!selectionId) return;
    setAction(`facebook-page:${pageId}`);
    try {
      await selectFacebookPage(selectionId, pageId);
      setSelectionId("");
      setFacebookPages([]);
      setSuccess("Página do Facebook conectada à marca.");
      await loadBrand(brandId);
      window.history.replaceState({}, "", `/app/settings/integrations?brandId=${encodeURIComponent(brandId)}`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Não foi possível conectar a Página.");
    } finally {
      setAction("");
    }
  }

  if (loading && !dashboard) {
    return <main className="portal-loading"><img src="/logo.svg" alt="MODO" /><div className="portal-spinner" /><p>Carregando integrações...</p></main>;
  }
  if (!dashboard || !canva) {
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
          <div><div className="section-kicker">CONFIGURAÇÕES · INTEGRAÇÕES</div><h1>Uma marca. Os canais certos. Nenhuma conta misturada.</h1><p>Cada autorização fica vinculada à sua organização e à marca selecionada. A MODO nunca pede sua senha.</p></div>
          <a className="button button-outline" href="/app">Voltar ao painel</a>
        </section>

        <section className="integration-brand-context">
          <div><small>MARCA QUE VOCÊ ESTÁ CONFIGURANDO</small><strong>{selectedBrand?.name || "Escolha uma marca"}</strong><span>Os canais abaixo publicam somente conteúdo desta marca.</span></div>
          <select value={brandId} onChange={(event) => void changeBrand(event.target.value)}>
            {dashboard.brands.map((brand) => <option key={brand.id} value={brand.id}>{brand.name}</option>)}
          </select>
        </section>

        {error && <div className="portal-error">{error}</div>}
        {success && <div className="workspace-success">{success}</div>}

        {selectionId && facebookPages.length > 0 && (
          <section className="facebook-page-picker">
            <div><small>FACEBOOK PAGES</small><h2>Qual Página representa {selectedBrand?.name}?</h2><p>Sua conta administra mais de uma Página. Escolha uma vez; a MODO guarda somente a Página selecionada para esta marca.</p></div>
            <div>{facebookPages.map((page) => <button key={page.id} disabled={Boolean(action)} onClick={() => void chooseFacebookPage(page.id)}>{page.pictureUrl ? <img src={page.pictureUrl} alt="" /> : <span>f</span>}<strong>{page.name}</strong><em>{action === `facebook-page:${page.id}` ? "Conectando..." : "Usar esta Página"}</em></button>)}</div>
          </section>
        )}

        <section className="integration-grid native-grid">
          {connections.map((connection) => (
            <article className={`integration-card ${connection.platform} ${connection.connected ? "connected" : ""}`} key={connection.platform}>
              <div className="integration-card-header">
                {connection.pictureUrl ? <img src={connection.pictureUrl} alt="" /> : <div className="integration-icon">{platformIcons[connection.platform]}</div>}
                <div><small>{platformEyebrows[connection.platform]}</small><h2>{connection.displayName || platformLabels[connection.platform]}</h2></div>
                <span className={connection.connected ? "status connected" : "status"}>{connection.connected ? "Conectado" : connection.configured ? "Pronto" : "Configurar app"}</span>
              </div>
              <p>{connection.message}</p>
              <div className="integration-actions">
                {connection.connected ? (
                  <button className="button button-outline" disabled={Boolean(action)} onClick={() => void disconnect(connection.platform)}>
                    {action === `disconnect:${connection.platform}` ? "Desconectando..." : `Desconectar ${platformLabels[connection.platform]}`}
                  </button>
                ) : (
                  <button className="button button-primary" disabled={!connection.configured || Boolean(action)} onClick={() => void connect(connection.platform)}>
                    {action === `connect:${connection.platform}` ? "Abrindo autorização..." : connection.configured ? `Conectar ${platformLabels[connection.platform]}` : "Aguardando credenciais"}
                  </button>
                )}
              </div>
              <small className="integration-governance">Vínculo: {selectedBrand?.name}. Publicação somente após aprovação e confirmação.</small>
            </article>
          ))}

          <article className={`integration-card canva ${canva.connected ? "connected" : ""}`}>
            <div className="integration-card-header"><div className="integration-icon">C</div><div><small>EDIÇÃO E ACABAMENTO</small><h2>Canva</h2></div><span className={canva.connected ? "status connected" : "status"}>{canva.connected ? "Conectado" : "Desconectado"}</span></div>
            <p>{canva.message}</p>
            <div className="integration-actions">{canva.connected ? <button className="button button-outline" disabled={Boolean(action)} onClick={() => void disconnectCurrentCanva()}>{action === "canva-disconnect" ? "Desconectando..." : "Desconectar Canva"}</button> : <button className="button button-primary" disabled={!canva.integrationConfigured || Boolean(action)} onClick={() => void startCanvaConnection()}>{action === "canva-connect" ? "Abrindo Canva..." : canva.integrationConfigured ? "Conectar Canva" : "Aguardando configuração"}</button>}</div>
          </article>
        </section>

        <section className="integrations-security">
          <div><small>SEGURANÇA E GOVERNANÇA</small><h2>Cada cliente controla os próprios canais.</h2></div>
          <ul><li>Um cliente nunca utiliza a autorização social de outro cliente.</li><li>Tokens são criptografados antes de ir ao PostgreSQL.</li><li>Conexões sociais são resolvidas por organização + marca.</li><li>Agendamentos passam pelo Quality Gate e são idempotentes.</li><li>Você pode desconectar um canal a qualquer momento.</li></ul>
        </section>
      </main>
    </div>
  );
}
