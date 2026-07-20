import { nicheLabels, type Dashboard, type Niche } from "@modo/contracts";
import { type FormEvent, useEffect, useState } from "react";
import {
  createBrand,
  getDashboard,
  getSessionToken,
  loginAccount,
  logoutAccount,
  registerAccount,
} from "./api";

const planNames: Record<Dashboard["usage"]["plan"], string> = {
  trial: "Teste gratuito",
  start: "MODO Start",
  presenca: "MODO Presença",
  pro: "MODO Pro",
  business: "MODO Business",
};

function formatDate(value: string) {
  return new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "short", year: "numeric" }).format(
    new Date(value),
  );
}

export default function Portal() {
  const [mode, setMode] = useState<"login" | "register">("register");
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [loading, setLoading] = useState(Boolean(getSessionToken()));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [organizationName, setOrganizationName] = useState("");

  const [brandName, setBrandName] = useState("");
  const [brandWebsite, setBrandWebsite] = useState("");
  const [brandInstagram, setBrandInstagram] = useState("");
  const [brandNiche, setBrandNiche] = useState<Niche>("servicos_profissionais");

  async function refreshDashboard() {
    setLoading(true);
    try {
      setDashboard(await getDashboard());
      setError("");
    } catch (caught) {
      setDashboard(null);
      setError(caught instanceof Error ? caught.message : "Não foi possível carregar sua conta.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (getSessionToken()) void refreshDashboard();
  }, []);

  async function handleAuth(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError("");
    try {
      if (mode === "register") {
        await registerAccount({ name, email, password, organizationName });
      } else {
        await loginAccount({ email, password });
      }
      await refreshDashboard();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Não foi possível entrar.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleCreateBrand(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError("");
    try {
      const normalizedUrl = brandWebsite
        ? /^https?:\/\//i.test(brandWebsite)
          ? brandWebsite
          : `https://${brandWebsite}`
        : "";
      await createBrand({
        name: brandName,
        websiteUrl: normalizedUrl,
        instagramHandle: brandInstagram,
        niche: brandNiche,
      });
      setBrandName("");
      setBrandWebsite("");
      setBrandInstagram("");
      await refreshDashboard();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Não foi possível cadastrar a marca.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleLogout() {
    await logoutAccount();
    setDashboard(null);
    setMode("login");
  }

  if (loading && !dashboard) {
    return (
      <main className="portal-loading">
        <img src="/logo.svg" alt="MODO" />
        <div className="portal-spinner" />
        <p>Organizando sua operação...</p>
      </main>
    );
  }

  if (!dashboard) {
    const selectedPlan = window.sessionStorage.getItem("modo.selectedPlan");
    return (
      <main className="portal-auth">
        <a className="portal-logo" href="/"><img src="/logo.svg" alt="MODO" /></a>
        <section className="portal-auth-copy">
          <div className="section-kicker">MODO ACCOUNT</div>
          <h1>Entre no modo contínuo da sua marca.</h1>
          <p>Cadastre sua operação, organize a primeira marca e acompanhe créditos, limites e produção em um único lugar.</p>
          <div className="portal-benefits">
            <span>3 créditos gratuitos para começar</span>
            <span>1 marca no trial</span>
            <span>Sem publicação automática</span>
          </div>
        </section>

        <section className="portal-auth-card">
          <div className="portal-auth-tabs">
            <button className={mode === "register" ? "active" : ""} onClick={() => setMode("register")}>Criar conta</button>
            <button className={mode === "login" ? "active" : ""} onClick={() => setMode("login")}>Entrar</button>
          </div>

          {selectedPlan && mode === "register" && (
            <div className="portal-plan-intent">Plano selecionado: <strong>{selectedPlan}</strong>. Você poderá ativá-lo após criar a conta.</div>
          )}

          <form className="portal-form" onSubmit={handleAuth}>
            {mode === "register" && (
              <>
                <label>Seu nome<input value={name} onChange={(event) => setName(event.target.value)} required /></label>
                <label>Nome da marca ou empresa<input value={organizationName} onChange={(event) => setOrganizationName(event.target.value)} required /></label>
              </>
            )}
            <label>E-mail<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} required /></label>
            <label>Senha<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} minLength={8} required /></label>
            {mode === "register" && <small>A senha deve ter pelo menos 8 caracteres, uma letra e um número.</small>}
            {error && <div className="portal-error">{error}</div>}
            <button className="button button-primary button-full" disabled={submitting}>
              {submitting ? "Processando..." : mode === "register" ? "Criar minha conta" : "Entrar na MODO"}
            </button>
          </form>
          <a className="portal-back" href="/">← Voltar para o site</a>
        </section>
      </main>
    );
  }

  const usagePercent = Math.min(100, Math.round((dashboard.usage.creditsUsed / dashboard.usage.creditsGranted) * 100));
  const brandLimitReached = dashboard.brands.length >= dashboard.usage.entitlements.maxBrands;

  return (
    <div className="portal-shell">
      <aside className="portal-sidebar">
        <a href="/"><img src="/logo.svg" alt="MODO" /></a>
        <nav>
          <a className="active" href="#overview">Visão geral</a>
          <a href="#brands">Marcas</a>
          <a href="#credits">Créditos</a>
        </nav>
        <div className="portal-account">
          <strong>{dashboard.user.name}</strong>
          <span>{dashboard.user.email}</span>
          <button onClick={handleLogout}>Sair</button>
        </div>
      </aside>

      <main className="portal-main">
        <header className="portal-topbar">
          <div>
            <small>{dashboard.organization.name}</small>
            <h1>Bom ter você em modo presença.</h1>
          </div>
          <a className="button button-primary" href="/#diagnostico">Novo diagnóstico</a>
        </header>

        {error && <div className="portal-error portal-error-wide">{error}</div>}

        <section className="portal-overview" id="overview">
          <article className="portal-stat portal-stat-primary">
            <small>Saldo disponível</small>
            <strong>{dashboard.usage.creditsRemaining}</strong>
            <span>de {dashboard.usage.creditsGranted} créditos neste ciclo</span>
          </article>
          <article className="portal-stat">
            <small>Plano atual</small>
            <strong>{planNames[dashboard.usage.plan]}</strong>
            <span>Renova em {formatDate(dashboard.usage.periodEnd)}</span>
          </article>
          <article className="portal-stat">
            <small>Marcas ativas</small>
            <strong>{dashboard.brands.length}/{dashboard.usage.entitlements.maxBrands}</strong>
            <span>Limite do plano atual</span>
          </article>
        </section>

        <section className="portal-panel" id="credits">
          <div className="portal-panel-heading">
            <div><small>CAPACIDADE MENSAL</small><h2>Uso de créditos</h2></div>
            <strong>{usagePercent}% utilizado</strong>
          </div>
          <div className="portal-usage-bar"><span style={{ width: `${usagePercent}%` }} /></div>
          <div className="portal-usage-details">
            <span>Posts: {dashboard.usage.usageByType.static_post}</span>
            <span>Stories: {dashboard.usage.usageByType.story}</span>
            <span>Carrosséis: {dashboard.usage.usageByType.carousel}/{dashboard.usage.entitlements.maxCarouselsPerMonth}</span>
            <span>Roteiros: {dashboard.usage.usageByType.short_video_script}/{dashboard.usage.entitlements.maxShortVideoScriptsPerMonth}</span>
          </div>
        </section>

        <section className="portal-brands" id="brands">
          <div className="portal-section-heading">
            <div><small>MODO BRAND</small><h2>Suas marcas</h2></div>
            <span>{dashboard.brands.length} cadastrada(s)</span>
          </div>

          <div className="portal-brand-grid">
            {dashboard.brands.map((brand) => (
              <article className="portal-brand-card" key={brand.id}>
                <div className="portal-brand-avatar">{brand.name.slice(0, 1).toUpperCase()}</div>
                <div><h3>{brand.name}</h3><p>{nicheLabels[brand.niche]}</p></div>
                <small>{brand.instagramHandle || brand.websiteUrl || "Contexto inicial"}</small>
              </article>
            ))}

            {!brandLimitReached && (
              <form className="portal-brand-form" onSubmit={handleCreateBrand}>
                <div><small>NOVA MARCA</small><h3>Organize o primeiro contexto</h3></div>
                <input placeholder="Nome da marca" value={brandName} onChange={(event) => setBrandName(event.target.value)} required />
                <input placeholder="Site (opcional)" value={brandWebsite} onChange={(event) => setBrandWebsite(event.target.value)} />
                <input placeholder="Instagram (opcional)" value={brandInstagram} onChange={(event) => setBrandInstagram(event.target.value)} />
                <select value={brandNiche} onChange={(event) => setBrandNiche(event.target.value as Niche)}>
                  {(Object.keys(nicheLabels) as Niche[]).map((niche) => <option value={niche} key={niche}>{nicheLabels[niche]}</option>)}
                </select>
                <button className="button button-primary" disabled={submitting}>{submitting ? "Salvando..." : "Cadastrar marca"}</button>
              </form>
            )}
          </div>

          {brandLimitReached && <div className="portal-limit-note">Você atingiu o limite de marcas do plano atual. O upgrade liberará mais operações.</div>}
        </section>
      </main>
    </div>
  );
}
