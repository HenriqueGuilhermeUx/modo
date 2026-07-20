import {
  type PlanSlug,
  type PublicPlanSlug,
  type SubscriptionStatus,
} from "@modo/contracts";
import type {
  AdminDiscountCampaign,
  AdminInvitation,
  AdminOrganization,
  AdminOverview,
  PlatformAdmin,
} from "@modo/contracts/admin";
import { type FormEvent, useEffect, useMemo, useState } from "react";
import {
  adjustOrganizationCredits,
  clearAdminToken,
  createAdminDiscount,
  createAdminInvitation,
  getAdminMe,
  getAdminOverview,
  getAdminToken,
  listAdminDiscounts,
  listAdminInvitations,
  listAdminOrganizations,
  loginAdmin,
  logoutAdmin,
  revokeAdminInvitation,
  setAdminDiscountActive,
  updateOrganizationSubscription,
} from "./admin-api";

type Tab = "overview" | "organizations" | "invitations" | "discounts";

const planLabels: Record<PlanSlug, string> = {
  trial: "Teste",
  start: "Start",
  presenca: "Presença",
  pro: "Pro",
  business: "Business",
};

const statusLabels: Record<SubscriptionStatus, string> = {
  active: "Ativa",
  retrying: "Retentativa",
  suspended: "Suspensa",
  canceled: "Cancelada",
};

const money = (cents: number) => (cents / 100).toLocaleString("pt-BR", {
  style: "currency",
  currency: "BRL",
});

function copy(value: string) {
  return navigator.clipboard.writeText(value);
}

export default function AdminWorkspace() {
  const [admin, setAdmin] = useState<PlatformAdmin | null>(null);
  const [tab, setTab] = useState<Tab>("overview");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [overview, setOverview] = useState<AdminOverview | null>(null);
  const [organizations, setOrganizations] = useState<AdminOrganization[]>([]);
  const [invitations, setInvitations] = useState<AdminInvitation[]>([]);
  const [discounts, setDiscounts] = useState<AdminDiscountCampaign[]>([]);
  const [loading, setLoading] = useState(Boolean(getAdminToken()));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [search, setSearch] = useState("");

  const [inviteEmail, setInviteEmail] = useState("");
  const [invitePlan, setInvitePlan] = useState<PlanSlug>("trial");
  const [inviteBonus, setInviteBonus] = useState(3);
  const [inviteDays, setInviteDays] = useState(14);
  const [inviteNote, setInviteNote] = useState("");
  const [latestInviteUrl, setLatestInviteUrl] = useState("");

  const [campaignName, setCampaignName] = useState("");
  const [campaignCode, setCampaignCode] = useState("");
  const [discountKind, setDiscountKind] = useState<"percent" | "fixed_cents">("percent");
  const [discountValue, setDiscountValue] = useState(20);
  const [discountPlans, setDiscountPlans] = useState<PublicPlanSlug[]>(["presenca"]);
  const [maxRedemptions, setMaxRedemptions] = useState(100);
  const [startsAt, setStartsAt] = useState(() => new Date().toISOString().slice(0, 16));
  const [endsAt, setEndsAt] = useState(() => {
    const date = new Date();
    date.setDate(date.getDate() + 30);
    return date.toISOString().slice(0, 16);
  });

  async function loadAll() {
    const [me, nextOverview, nextOrganizations, nextInvitations, nextDiscounts] = await Promise.all([
      getAdminMe(),
      getAdminOverview(),
      listAdminOrganizations(),
      listAdminInvitations(),
      listAdminDiscounts(),
    ]);
    setAdmin(me.admin);
    setOverview(nextOverview);
    setOrganizations(nextOrganizations);
    setInvitations(nextInvitations);
    setDiscounts(nextDiscounts);
  }

  useEffect(() => {
    if (!getAdminToken()) return;
    loadAll()
      .catch((caught) => {
        clearAdminToken();
        setError(caught instanceof Error ? caught.message : "Sessão administrativa inválida.");
      })
      .finally(() => setLoading(false));
  }, []);

  const filteredOrganizations = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return organizations;
    return organizations.filter((item) =>
      [item.name, item.ownerName, item.ownerEmail, item.plan, item.status]
        .some((value) => value.toLowerCase().includes(query)),
    );
  }, [organizations, search]);

  async function handleLogin(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const session = await loginAdmin(email, password);
      setAdmin(session.admin);
      setPassword("");
      await loadAll();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Não foi possível entrar.");
    } finally {
      setBusy(false);
      setLoading(false);
    }
  }

  async function handleLogout() {
    await logoutAdmin();
    setAdmin(null);
    setOverview(null);
  }

  async function refresh(message?: string) {
    setBusy(true);
    setError("");
    try {
      await loadAll();
      if (message) setSuccess(message);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Não foi possível atualizar o painel.");
    } finally {
      setBusy(false);
    }
  }

  async function handleCredits(item: AdminOrganization) {
    const raw = window.prompt("Quantos créditos? Use número negativo para remover.", "10");
    if (!raw) return;
    const credits = Number(raw);
    if (!Number.isInteger(credits) || credits === 0) return setError("Informe um número inteiro diferente de zero.");
    const reason = window.prompt("Motivo do ajuste:", "Ajuste comercial")?.trim();
    if (!reason) return;
    setBusy(true);
    try {
      await adjustOrganizationCredits(item.id, { credits, reason });
      await refresh(`${credits > 0 ? "+" : ""}${credits} créditos aplicados em ${item.name}.`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Não foi possível ajustar créditos.");
      setBusy(false);
    }
  }

  async function handleSubscription(item: AdminOrganization) {
    const plan = window.prompt("Novo plano: trial, start, presenca, pro ou business", item.plan)?.trim() as PlanSlug | undefined;
    if (!plan || !["trial", "start", "presenca", "pro", "business"].includes(plan)) return;
    const status = window.prompt("Status: active, retrying, suspended ou canceled", item.status)?.trim() as SubscriptionStatus | undefined;
    if (!status || !["active", "retrying", "suspended", "canceled"].includes(status)) return;
    setBusy(true);
    try {
      await updateOrganizationSubscription(item.id, { plan, status });
      await refresh(`Plano de ${item.name} atualizado.`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Não foi possível atualizar a assinatura.");
      setBusy(false);
    }
  }

  async function handleInvite(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setSuccess("");
    try {
      const created = await createAdminInvitation({
        email: inviteEmail,
        plan: invitePlan,
        bonusCredits: inviteBonus,
        expiresInDays: inviteDays,
        note: inviteNote,
      });
      setLatestInviteUrl(created.inviteUrl || "");
      setInviteEmail("");
      setInviteNote("");
      await refresh("Convite criado. O link aparece abaixo e só é exibido desta vez.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Não foi possível criar o convite.");
      setBusy(false);
    }
  }

  function togglePlan(plan: PublicPlanSlug) {
    setDiscountPlans((current) =>
      current.includes(plan)
        ? current.length === 1 ? current : current.filter((item) => item !== plan)
        : [...current, plan],
    );
  }

  async function handleCampaign(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await createAdminDiscount({
        name: campaignName,
        code: campaignCode,
        kind: discountKind,
        value: discountKind === "fixed_cents" ? Math.round(discountValue * 100) : Math.round(discountValue),
        plans: discountPlans,
        maxRedemptions,
        startsAt: new Date(startsAt).toISOString(),
        endsAt: new Date(endsAt).toISOString(),
        active: true,
      });
      setCampaignName("");
      setCampaignCode("");
      await refresh("Campanha de desconto criada e pronta para uso.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Não foi possível criar a campanha.");
      setBusy(false);
    }
  }

  if (loading) {
    return <main className="admin-login"><img src="/logo.svg" alt="MODO" /><div className="portal-spinner" /><p>Abrindo a central de comando...</p></main>;
  }

  if (!admin) {
    return (
      <main className="admin-login">
        <section>
          <img src="/logo.svg" alt="MODO" />
          <span>CENTRAL DE COMANDO</span>
          <h1>Administração da plataforma.</h1>
          <p>Acesso separado das contas de clientes. Use as credenciais protegidas no Render.</p>
          {error && <div className="portal-error">{error}</div>}
          <form onSubmit={handleLogin}>
            <label>E-mail administrativo<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} required autoComplete="username" /></label>
            <label>Senha<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} required autoComplete="current-password" /></label>
            <button className="button button-primary button-full" disabled={busy}>{busy ? "Autenticando..." : "Entrar na central"}</button>
          </form>
          <a href="/">Voltar ao site</a>
        </section>
      </main>
    );
  }

  return (
    <div className="admin-shell">
      <aside className="admin-sidebar">
        <a href="/admin"><img src="/logo.svg" alt="MODO" /></a>
        <div><small>ADMINISTRADOR</small><strong>{admin.name}</strong><span>{admin.email}</span></div>
        <nav>
          <button className={tab === "overview" ? "active" : ""} onClick={() => setTab("overview")}>Visão geral</button>
          <button className={tab === "organizations" ? "active" : ""} onClick={() => setTab("organizations")}>Clientes</button>
          <button className={tab === "invitations" ? "active" : ""} onClick={() => setTab("invitations")}>Convites</button>
          <button className={tab === "discounts" ? "active" : ""} onClick={() => setTab("discounts")}>Descontos</button>
        </nav>
        <button className="admin-logout" onClick={() => void handleLogout()}>Sair</button>
      </aside>

      <main className="admin-main">
        <header><div><span>MODO CONTROL</span><h1>{tab === "overview" ? "Visão geral" : tab === "organizations" ? "Clientes e assinaturas" : tab === "invitations" ? "Convites de onboarding" : "Campanhas de desconto"}</h1></div><button onClick={() => void refresh()} disabled={busy}>{busy ? "Atualizando..." : "Atualizar dados"}</button></header>
        {error && <div className="portal-error portal-error-wide">{error}</div>}
        {success && <div className="workspace-success">{success}</div>}

        {tab === "overview" && overview && (
          <>
            <section className="admin-metrics">
              <article><small>ORGANIZAÇÕES</small><strong>{overview.organizations}</strong><span>{overview.users} usuários</span></article>
              <article><small>ASSINATURAS ATIVAS</small><strong>{overview.activeSubscriptions}</strong><span>{overview.trialSubscriptions} em teste</span></article>
              <article><small>MRR ESTIMADO</small><strong>{money(overview.estimatedMrrCents)}</strong><span>antes de descontos</span></article>
              <article><small>CONTEÚDOS</small><strong>{overview.contentRequests}</strong><span>{overview.contentReady} prontos/aprovados</span></article>
              <article><small>PAGAMENTOS</small><strong>{overview.paymentsReceived}</strong><span>eventos confirmados</span></article>
              <article><small>OPERAÇÃO</small><strong>{overview.invitationsOpen}</strong><span>convites · {overview.discountCampaignsActive} campanhas</span></article>
            </section>
            <section className="admin-command-grid">
              <article><span>01</span><h2>Trazer um cliente</h2><p>Crie um convite com plano inicial e créditos bônus.</p><button onClick={() => setTab("invitations")}>Criar convite</button></article>
              <article><span>02</span><h2>Executar uma oferta</h2><p>Defina código, planos, período e limite de utilizações.</p><button onClick={() => setTab("discounts")}>Criar desconto</button></article>
              <article><span>03</span><h2>Acompanhar operação</h2><p>Veja saldo, produção e situação de cada organização.</p><button onClick={() => setTab("organizations")}>Ver clientes</button></article>
            </section>
          </>
        )}

        {tab === "organizations" && (
          <section className="admin-section">
            <div className="admin-toolbar"><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar empresa, responsável, e-mail, plano..." /><span>{filteredOrganizations.length} conta(s)</span></div>
            <div className="admin-table">
              <div className="admin-table-head"><span>Cliente</span><span>Plano</span><span>Créditos</span><span>Uso</span><span>Ações</span></div>
              {filteredOrganizations.map((item) => (
                <article key={item.id}>
                  <div><strong>{item.name}</strong><span>{item.ownerName} · {item.ownerEmail}</span><small>Desde {new Date(item.createdAt).toLocaleDateString("pt-BR")}</small></div>
                  <div><b>{planLabels[item.plan]}</b><span className={`admin-status ${item.status}`}>{statusLabels[item.status]}</span></div>
                  <div><strong>{item.creditsRemaining}</strong><span>{item.creditsUsed} usados de {item.creditsGranted}</span></div>
                  <div><span>{item.brands} marcas</span><span>{item.users} usuários</span><span>{item.contentRequests} conteúdos</span></div>
                  <div><button onClick={() => void handleCredits(item)}>Créditos</button><button onClick={() => void handleSubscription(item)}>Plano/status</button></div>
                </article>
              ))}
            </div>
          </section>
        )}

        {tab === "invitations" && (
          <div className="admin-two-columns">
            <form className="admin-form" onSubmit={handleInvite}>
              <span>NOVO CONVITE</span><h2>Onboarding guiado</h2>
              <label>E-mail do cliente<input type="email" value={inviteEmail} onChange={(event) => setInviteEmail(event.target.value)} required /></label>
              <div className="admin-form-grid"><label>Plano inicial<select value={invitePlan} onChange={(event) => setInvitePlan(event.target.value as PlanSlug)}>{Object.entries(planLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label>Créditos bônus<input type="number" min="0" max="1000" value={inviteBonus} onChange={(event) => setInviteBonus(Number(event.target.value))} /></label></div>
              <label>Validade em dias<input type="number" min="1" max="90" value={inviteDays} onChange={(event) => setInviteDays(Number(event.target.value))} /></label>
              <label>Observação<textarea value={inviteNote} onChange={(event) => setInviteNote(event.target.value)} placeholder="Ex.: parceria, onboarding acompanhado, condição comercial..." /></label>
              <button className="button button-primary button-full" disabled={busy}>Gerar convite</button>
              {latestInviteUrl && <div className="admin-invite-result"><strong>Copie agora</strong><p>{latestInviteUrl}</p><button type="button" onClick={() => void copy(latestInviteUrl).then(() => setSuccess("Link copiado."))}>Copiar link</button></div>}
            </form>
            <section className="admin-list"><span>HISTÓRICO</span><h2>Convites gerados</h2>{invitations.map((item) => <article key={item.id}><div><strong>{item.email}</strong><span>{planLabels[item.plan]} · {item.bonusCredits} créditos bônus</span><small>Expira em {new Date(item.expiresAt).toLocaleDateString("pt-BR")}</small></div><b className={`admin-status ${item.status}`}>{item.status}</b>{item.status === "open" && <button onClick={() => void revokeAdminInvitation(item.id).then(() => refresh("Convite revogado."))}>Revogar</button>}</article>)}</section>
          </div>
        )}

        {tab === "discounts" && (
          <div className="admin-two-columns">
            <form className="admin-form" onSubmit={handleCampaign}>
              <span>NOVA CAMPANHA</span><h2>Oferta com cupom</h2>
              <label>Nome da campanha<input value={campaignName} onChange={(event) => setCampaignName(event.target.value)} placeholder="Ex.: Lançamento julho" required /></label>
              <label>Código<input value={campaignCode} onChange={(event) => setCampaignCode(event.target.value.toUpperCase().replace(/[^A-Z0-9_-]/g, ""))} placeholder="MODO20" required /></label>
              <div className="admin-form-grid"><label>Tipo<select value={discountKind} onChange={(event) => setDiscountKind(event.target.value as "percent" | "fixed_cents")}><option value="percent">Percentual</option><option value="fixed_cents">Valor em reais</option></select></label><label>{discountKind === "percent" ? "Percentual" : "Valor R$"}<input type="number" min="1" value={discountValue} onChange={(event) => setDiscountValue(Number(event.target.value))} /></label></div>
              <fieldset><legend>Planos válidos</legend>{(["start", "presenca", "pro", "business"] as PublicPlanSlug[]).map((plan) => <label key={plan}><input type="checkbox" checked={discountPlans.includes(plan)} onChange={() => togglePlan(plan)} />{planLabels[plan]}</label>)}</fieldset>
              <label>Máximo de usos<input type="number" min="1" value={maxRedemptions} onChange={(event) => setMaxRedemptions(Number(event.target.value))} /></label>
              <div className="admin-form-grid"><label>Início<input type="datetime-local" value={startsAt} onChange={(event) => setStartsAt(event.target.value)} required /></label><label>Término<input type="datetime-local" value={endsAt} onChange={(event) => setEndsAt(event.target.value)} required /></label></div>
              <button className="button button-primary button-full" disabled={busy}>Ativar campanha</button>
            </form>
            <section className="admin-list"><span>CAMPANHAS</span><h2>Cupons configurados</h2>{discounts.map((item) => <article key={item.id}><div><strong>{item.code}</strong><span>{item.name} · {item.kind === "percent" ? `${item.value}%` : money(item.value)}</span><small>{item.redemptions}/{item.maxRedemptions} usos · até {new Date(item.endsAt).toLocaleDateString("pt-BR")}</small></div><b className={`admin-status ${item.active ? "active" : "canceled"}`}>{item.active ? "ativa" : "inativa"}</b><button onClick={() => void setAdminDiscountActive(item.id, !item.active).then(() => refresh(item.active ? "Campanha pausada." : "Campanha ativada."))}>{item.active ? "Pausar" : "Ativar"}</button></article>)}</section>
          </div>
        )}
      </main>
    </div>
  );
}
