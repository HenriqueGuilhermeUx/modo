import { nicheLabels, type Dashboard, type Niche } from "@modo/contracts";
import type { ContentRequest } from "@modo/contracts/content";
import { type FormEvent, useEffect, useMemo, useState } from "react";
import { createAgencyApprovalLink, type AgencyApprovalLink } from "./agency-api";
import {
  createBrand,
  getDashboard,
  getSessionToken,
  listContentRequests,
  loginAccount,
  logoutAccount,
  registerAccount,
} from "./api";
import { listNativeConnections, listNativePublications } from "./native-publisher-api";

const agencyPlanNames: Record<string, string> = {
  trial: "Teste Agency",
  agency_professional: "MODO Professional",
  agency_studio: "MODO Studio",
  agency: "MODO Agency",
  "agency-pro": "Agency Pro · implantação assistida",
  business: "MODO Business",
};

const landingPlanToBillingPlan: Record<string, string> = {
  professional: "agency_professional",
  studio: "agency_studio",
  agency: "agency",
  "agency-pro": "agency-pro",
};

function selectedAgencyPlan() {
  const query = new URLSearchParams(window.location.search).get("plan");
  const stored = window.sessionStorage.getItem("modo.agency.selectedPlan");
  const raw = query || stored || "studio";
  return landingPlanToBillingPlan[raw] || raw;
}

function brandHref(path: string, brandId: string) {
  const separator = path.includes("?") ? "&" : "?";
  return `${path}${separator}brand=${encodeURIComponent(brandId)}&mode=agency`;
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "short" }).format(new Date(value));
}

function contactAgencyPro() {
  const subject = encodeURIComponent("Quero conhecer o MODO Agency Pro");
  const body = encodeURIComponent("Olá, quero conversar sobre uma operação MODO Agency Pro para mais de 40 clientes / white-label.");
  window.location.href = `mailto:henriquecampos66@gmail.com?subject=${subject}&body=${body}`;
}

export default function AgencyWorkspace() {
  const [authMode, setAuthMode] = useState<"login" | "register">("register");
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [contents, setContents] = useState<ContentRequest[]>([]);
  const [connectionCount, setConnectionCount] = useState<Record<string, number>>({});
  const [publicationCount, setPublicationCount] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(Boolean(getSessionToken()));
  const [submitting, setSubmitting] = useState(false);
  const [approvalBusy, setApprovalBusy] = useState("");
  const [approvalShare, setApprovalShare] = useState<AgencyApprovalLink | null>(null);
  const [copiedApproval, setCopiedApproval] = useState(false);
  const [error, setError] = useState("");
  const [showClientForm, setShowClientForm] = useState(false);

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [agencyName, setAgencyName] = useState("");

  const [clientName, setClientName] = useState("");
  const [clientWebsite, setClientWebsite] = useState("");
  const [clientInstagram, setClientInstagram] = useState("");
  const [clientNiche, setClientNiche] = useState<Niche>("servicos_profissionais");

  async function loadAgency() {
    setLoading(true);
    try {
      const nextDashboard = await getDashboard();
      setDashboard(nextDashboard);
      const requests = await listContentRequests().catch(() => [] as ContentRequest[]);
      setContents(requests);

      const connectionEntries = await Promise.all(
        nextDashboard.brands.map(async (brand) => {
          const connections = await listNativeConnections(brand.id).catch(() => []);
          return [brand.id, connections.filter((item) => item.connected).length] as const;
        }),
      );
      setConnectionCount(Object.fromEntries(connectionEntries));

      const publicationEntries = await Promise.all(
        nextDashboard.brands.map(async (brand) => {
          const publications = await listNativePublications(brand.id).catch(() => []);
          return [brand.id, publications.filter((item) => ["scheduled", "publishing", "published"].includes(item.status)).length] as const;
        }),
      );
      setPublicationCount(Object.fromEntries(publicationEntries));
      setError("");
    } catch (caught) {
      setDashboard(null);
      setError(caught instanceof Error ? caught.message : "Não foi possível carregar sua operação Agency.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    window.sessionStorage.setItem("modo.accountMode", "agency");
    if (getSessionToken()) void loadAgency();
  }, []);

  async function handleAuth(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError("");
    try {
      if (authMode === "register") {
        await registerAccount({ name, email, password, organizationName: agencyName });
      } else {
        await loginAccount({ email, password });
      }
      window.sessionStorage.setItem("modo.accountMode", "agency");
      await loadAgency();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Não foi possível entrar na MODO Agency.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleCreateClient(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError("");
    try {
      const websiteUrl = clientWebsite
        ? /^https?:\/\//i.test(clientWebsite)
          ? clientWebsite
          : `https://${clientWebsite}`
        : "";
      await createBrand({
        name: clientName,
        websiteUrl,
        instagramHandle: clientInstagram,
        niche: clientNiche,
      });
      setClientName("");
      setClientWebsite("");
      setClientInstagram("");
      setClientNiche("servicos_profissionais");
      setShowClientForm(false);
      await loadAgency();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Não foi possível cadastrar o cliente.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleApprovalLink(brandId: string) {
    setApprovalBusy(brandId);
    setCopiedApproval(false);
    setError("");
    try {
      setApprovalShare(await createAgencyApprovalLink(brandId));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Não foi possível gerar o portal de aprovação.");
    } finally {
      setApprovalBusy("");
    }
  }

  async function copyApprovalLink() {
    if (!approvalShare) return;
    await navigator.clipboard.writeText(approvalShare.approvalUrl);
    setCopiedApproval(true);
  }

  async function handleLogout() {
    await logoutAccount();
    setDashboard(null);
    setContents([]);
    setAuthMode("login");
  }

  const clientStats = useMemo(() => {
    if (!dashboard) return {} as Record<string, { waiting: number; approved: number; total: number }>;
    return Object.fromEntries(
      dashboard.brands.map((brand) => {
        const brandContent = contents.filter((item) => item.brandId === brand.id);
        return [
          brand.id,
          {
            waiting: brandContent.filter((item) => ["ready", "revision_requested"].includes(item.status)).length,
            approved: brandContent.filter((item) => item.status === "approved").length,
            total: brandContent.length,
          },
        ];
      }),
    );
  }, [dashboard, contents]);

  if (loading && !dashboard) {
    return (
      <main className="agency-ws-loading">
        <img src="/logo.svg" alt="MODO" />
        <div className="portal-spinner" />
        <p>Organizando sua carteira de clientes...</p>
      </main>
    );
  }

  if (!dashboard) {
    const chosenPlan = selectedAgencyPlan();
    return (
      <main className="agency-auth-shell">
        <section className="agency-auth-brand">
          <a href="/agency" className="agency-auth-logo"><img src="/logo.svg" alt="MODO" /><span>AGENCY</span></a>
          <div className="agency-auth-kicker">OPERAÇÃO MULTI-CLIENTE</div>
          <h1>Um cérebro de marketing para cada cliente da sua agência.</h1>
          <p>Entre para organizar contexto, criação, aprovação, publicação e aprendizado sem misturar contas ou perder a sua criatividade.</p>
          <div className="agency-auth-plan">
            <small>PLANO ESCOLHIDO</small>
            <strong>{agencyPlanNames[chosenPlan] || "MODO Studio"}</strong>
            <span>{chosenPlan === "agency-pro" ? "Plano personalizado com implantação assistida e condições definidas com o time MODO." : "Você começa com um cliente no teste e ativa a carteira completa quando quiser."}</span>
          </div>
          <div className="agency-auth-benefits">
            <span>✓ Contexto separado por cliente</span>
            <span>✓ Instagram, Facebook e LinkedIn</span>
            <span>✓ Publisher e calendário por marca</span>
            <span>✓ Toda criação continua editável pela agência</span>
          </div>
        </section>

        <section className="agency-auth-card">
          <div className="agency-auth-tabs">
            <button type="button" className={authMode === "register" ? "active" : ""} onClick={() => setAuthMode("register")}>Criar conta Agency</button>
            <button type="button" className={authMode === "login" ? "active" : ""} onClick={() => setAuthMode("login")}>Entrar</button>
          </div>
          <form onSubmit={handleAuth}>
            {authMode === "register" && (
              <>
                <label>Seu nome<input value={name} onChange={(event) => setName(event.target.value)} required /></label>
                <label>Nome da agência ou operação<input value={agencyName} onChange={(event) => setAgencyName(event.target.value)} required /></label>
              </>
            )}
            <label>E-mail<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} required /></label>
            <label>Senha<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} minLength={8} required /></label>
            {error && <div className="agency-ws-error">{error}</div>}
            <button className="agency-ws-primary" disabled={submitting}>{submitting ? "Processando..." : authMode === "register" ? "Criar minha operação Agency" : "Entrar na MODO Agency"}</button>
          </form>
          {chosenPlan === "agency-pro" && <button className="agency-ws-secondary agency-auth-contact" type="button" onClick={contactAgencyPro}>Falar sobre Agency Pro</button>}
          <a href="/agency" className="agency-auth-back">← Voltar para MODO Agency</a>
        </section>
      </main>
    );
  }

  const usage = dashboard.usage;
  const clientLimitReached = dashboard.brands.length >= usage.entitlements.maxBrands;
  const agencyPlan = agencyPlanNames[usage.plan] || (usage.plan === "trial" ? "Teste Agency" : String(usage.plan));
  const awaitingApproval = contents.filter((item) => ["ready", "revision_requested"].includes(item.status)).length;
  const approved = contents.filter((item) => item.status === "approved").length;
  const scheduledOrPublished = Object.values(publicationCount).reduce((sum, value) => sum + value, 0);

  function activatePlan() {
    const plan = selectedAgencyPlan();
    if (plan === "agency-pro") {
      contactAgencyPro();
      return;
    }
    window.sessionStorage.setItem("modo.selectedPlan", plan);
    window.sessionStorage.setItem("modo.accountMode", "agency");
    window.location.href = `/app/planos?mode=agency&plan=${encodeURIComponent(plan)}`;
  }

  return (
    <div className="agency-ws-shell">
      <aside className="agency-ws-sidebar">
        <a className="agency-ws-brand" href="/agency"><img src="/logo.svg" alt="MODO" /><span>AGENCY</span></a>
        <div className="agency-ws-agency-name"><small>WORKSPACE</small><strong>{dashboard.organization.name}</strong></div>
        <nav>
          <a className="active" href="#carteira"><span>⌂</span> Carteira</a>
          <a href="#operacao"><span>◎</span> Operação</a>
          <a href="/app/publisher?mode=agency"><span>↗</span> Publisher</a>
          <a href="/app/content?mode=agency"><span>✦</span> Criar</a>
          <a href="/app/inteligencia?mode=agency"><span>◫</span> Inteligência</a>
          <a href="/app/planos?mode=agency"><span>◇</span> Plano</a>
        </nav>
        <div className="agency-ws-account">
          <strong>{dashboard.user.name}</strong>
          <span>{dashboard.user.email}</span>
          <button type="button" onClick={handleLogout}>Sair</button>
        </div>
      </aside>

      <main className="agency-ws-main">
        <header className="agency-ws-topbar">
          <div>
            <div className="agency-ws-kicker">MODO AGENCY · {agencyPlan.toUpperCase()}</div>
            <h1>Sua carteira, <strong>sem perder o contexto de ninguém.</strong></h1>
            <p>Cada cliente abaixo usa o mesmo coração da MODO, mas com memória, estratégia, conteúdo e redes totalmente separados.</p>
          </div>
          <div className="agency-ws-top-actions">
            {usage.plan === "trial" && <button className="agency-ws-secondary" type="button" onClick={activatePlan}>Ativar plano</button>}
            <button className="agency-ws-primary" type="button" onClick={() => setShowClientForm(true)} disabled={clientLimitReached}>+ Novo cliente</button>
          </div>
        </header>

        {error && <div className="agency-ws-error wide">{error}</div>}

        <section className="agency-ws-stats" id="operacao">
          <article><small>CLIENTES ATIVOS</small><strong>{dashboard.brands.length}<span>/{usage.entitlements.maxBrands}</span></strong><p>workspaces de marca separados</p></article>
          <article><small>AGUARDANDO REVISÃO</small><strong>{awaitingApproval}</strong><p>conteúdos pedindo decisão</p></article>
          <article><small>APROVADOS</small><strong>{approved}</strong><p>conteúdos liberados</p></article>
          <article><small>PUBLICAÇÃO</small><strong>{scheduledOrPublished}</strong><p>agendados ou publicados</p></article>
        </section>

        {usage.plan === "trial" && (
          <section className="agency-ws-upgrade">
            <div><small>TESTE A OPERAÇÃO REAL</small><h2>Cadastre o primeiro cliente e use o motor completo.</h2><p>Quando estiver pronto para abrir a carteira, ative o plano Agency escolhido e amplie sua capacidade de clientes.</p></div>
            <button className="agency-ws-primary" type="button" onClick={activatePlan}>Liberar minha carteira ↗</button>
          </section>
        )}

        <section className="agency-ws-clients" id="carteira">
          <div className="agency-ws-section-head">
            <div><small>CARTEIRA</small><h2>Clientes</h2></div>
            <div className="agency-ws-capacity"><span style={{ width: `${Math.min(100, (dashboard.brands.length / Math.max(1, usage.entitlements.maxBrands)) * 100)}%` }} /></div>
          </div>

          {dashboard.brands.length === 0 ? (
            <button className="agency-ws-empty" type="button" onClick={() => setShowClientForm(true)}>
              <span>+</span><strong>Cadastre seu primeiro cliente</strong><p>A MODO criará um espaço independente para estratégia, memória, conteúdo e publicação.</p>
            </button>
          ) : (
            <div className="agency-ws-client-grid">
              {dashboard.brands.map((brand) => {
                const stats = clientStats[brand.id] || { waiting: 0, approved: 0, total: 0 };
                const connections = connectionCount[brand.id] || 0;
                const publications = publicationCount[brand.id] || 0;
                return (
                  <article className="agency-ws-client-card" key={brand.id}>
                    <div className="agency-ws-client-head">
                      <div className="agency-ws-avatar">{brand.name.slice(0, 2).toUpperCase()}</div>
                      <div><h3>{brand.name}</h3><p>{nicheLabels[brand.niche]}</p></div>
                      <span className={connections > 0 ? "connected" : "pending"}>{connections > 0 ? `${connections} rede${connections > 1 ? "s" : ""}` : "Conectar redes"}</span>
                    </div>
                    <div className="agency-ws-client-health">
                      <div><small>Conteúdos</small><strong>{stats.total}</strong></div>
                      <div><small>Revisão</small><strong>{stats.waiting}</strong></div>
                      <div><small>Publicação</small><strong>{publications}</strong></div>
                    </div>
                    <div className="agency-ws-client-context"><small>CONTEXTO</small><span>{brand.websiteUrl || brand.instagramHandle || "Pronto para completar a base estratégica"}</span><b>Atualizado {formatDate(brand.updatedAt)}</b></div>
                    <div className="agency-ws-client-actions">
                      <a href={brandHref("/app/base", brand.id)}>Base</a>
                      <a href={brandHref("/app/director", brand.id)}>Diretor</a>
                      <a href={brandHref("/app/content", brand.id)}>Criar</a>
                      <button type="button" onClick={() => void handleApprovalLink(brand.id)} disabled={approvalBusy === brand.id}>{approvalBusy === brand.id ? "Gerando..." : "Aprovar"}</button>
                      <a className="primary" href={brandHref("/app/publisher", brand.id)}>Publicar ↗</a>
                    </div>
                  </article>
                );
              })}
            </div>
          )}

          {clientLimitReached && (
            <div className="agency-ws-limit"><strong>Limite de clientes atingido.</strong><span>Amplie o plano para abrir novas contas sem apagar histórico.</span><a href="/app/planos?mode=agency">Ver planos Agency →</a></div>
          )}
        </section>

        <section className="agency-ws-flow">
          <div><small>FLUXO PADRÃO</small><h2>O trabalho da agência continua humano. <strong>A operação deixa de ser fragmentada.</strong></h2></div>
          <ol>
            <li><span>1</span><div><strong>Contexto</strong><p>Base, oferta, público e restrições por cliente.</p></div></li>
            <li><span>2</span><div><strong>Direção</strong><p>A MODO cruza objetivo com histórico e canal.</p></div></li>
            <li><span>3</span><div><strong>Criação + aprovação</strong><p>Sua ideia entra, você edita e o cliente decide por um link seguro.</p></div></li>
            <li><span>4</span><div><strong>Publicação</strong><p>Conta certa, horário certo e aprendizado depois.</p></div></li>
          </ol>
        </section>
      </main>

      {showClientForm && (
        <div className="agency-ws-modal-backdrop" role="presentation" onMouseDown={() => setShowClientForm(false)}>
          <section className="agency-ws-modal" role="dialog" aria-modal="true" aria-labelledby="agency-new-client" onMouseDown={(event) => event.stopPropagation()}>
            <button className="agency-ws-modal-close" type="button" onClick={() => setShowClientForm(false)}>×</button>
            <small>NOVO CLIENTE</small>
            <h2 id="agency-new-client">Abra um novo cérebro de marketing.</h2>
            <p>Esse cadastro cria uma marca isolada dentro da sua agência. Depois você completa estratégia, conecta redes e começa a produzir.</p>
            <form onSubmit={handleCreateClient}>
              <label>Nome do cliente<input value={clientName} onChange={(event) => setClientName(event.target.value)} required /></label>
              <label>Site <span>(opcional)</span><input value={clientWebsite} onChange={(event) => setClientWebsite(event.target.value)} placeholder="www.cliente.com.br" /></label>
              <label>Instagram <span>(opcional)</span><input value={clientInstagram} onChange={(event) => setClientInstagram(event.target.value)} placeholder="@cliente" /></label>
              <label>Segmento<select value={clientNiche} onChange={(event) => setClientNiche(event.target.value as Niche)}>{(Object.keys(nicheLabels) as Niche[]).map((niche) => <option value={niche} key={niche}>{nicheLabels[niche]}</option>)}</select></label>
              {error && <div className="agency-ws-error">{error}</div>}
              <button className="agency-ws-primary" disabled={submitting}>{submitting ? "Criando workspace..." : "Criar cliente na MODO"}</button>
            </form>
          </section>
        </div>
      )}

      {approvalShare && (
        <div className="agency-ws-modal-backdrop" role="presentation" onMouseDown={() => setApprovalShare(null)}>
          <section className="agency-ws-modal agency-ws-share-modal" role="dialog" aria-modal="true" onMouseDown={(event) => event.stopPropagation()}>
            <button className="agency-ws-modal-close" type="button" onClick={() => setApprovalShare(null)}>×</button>
            <small>APROVAÇÃO DO CLIENTE</small>
            <h2>Envie este portal para {approvalShare.brandName}.</h2>
            <p>O cliente verá somente os conteúdos compartilhados desta marca. Ele poderá aprovar ou solicitar um ajuste sem acessar sua operação interna.</p>
            <div className="agency-ws-share-link"><span>{approvalShare.approvalUrl}</span><button type="button" onClick={() => void copyApprovalLink()}>{copiedApproval ? "Copiado ✓" : "Copiar link"}</button></div>
            <div className="agency-ws-share-trust">Link válido por 30 dias. Ao gerar um novo portal para este cliente, o link anterior é revogado automaticamente.</div>
            <a className="agency-ws-primary agency-ws-share-open" href={approvalShare.approvalUrl} target="_blank" rel="noreferrer">Abrir portal como cliente ↗</a>
          </section>
        </div>
      )}
    </div>
  );
}
