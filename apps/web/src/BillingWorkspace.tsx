import {
  planEntitlements,
  type Dashboard,
  type PublicPlanSlug,
  type SubscriptionStatus,
} from "@modo/contracts";
import type { WooviCheckoutResponse } from "@modo/contracts/payment";
import { type FormEvent, useEffect, useMemo, useState } from "react";
import {
  cancelWooviSubscription,
  createWooviCheckout,
  getDashboard,
  getSessionToken,
  logoutAccount,
} from "./api";

const planNames: Record<PublicPlanSlug, string> = {
  start: "MODO Começar",
  presenca: "MODO Presença",
  pro: "MODO Crescer",
  business: "MODO Business",
  agency_professional: "MODO Professional",
  agency_studio: "MODO Studio",
  agency: "MODO Agency",
};

const planDescriptions: Record<PublicPlanSlug, string> = {
  start: "Para sair da tela em branco.",
  presenca: "Para publicar toda semana.",
  pro: "Para quem já vende e quer avançar.",
  business: "Para equipes e operações mais complexas.",
  agency_professional: "Para social medias e publicitários independentes.",
  agency_studio: "Para microagências e times enxutos.",
  agency: "Para operações com carteira ativa e escala.",
};

const directPlans: PublicPlanSlug[] = ["start", "presenca", "pro", "business"];
const agencyPlans: PublicPlanSlug[] = ["agency_professional", "agency_studio", "agency"];

const statusLabels: Record<SubscriptionStatus, string> = {
  active: "Ativa",
  retrying: "Pagamento em retentativa",
  suspended: "Suspensa",
  canceled: "Cancelada",
};

function normalizeDigits(value: string) {
  return value.replace(/\D/g, "");
}

function money(cents: number) {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(cents / 100);
}

function isOperational(dashboard: Dashboard) {
  return dashboard.usage.plan !== "trial" &&
    ["active", "retrying"].includes(dashboard.usage.status);
}

export default function BillingWorkspace() {
  const params = new URLSearchParams(window.location.search);
  const agencyMode = params.get("mode") === "agency" || window.sessionStorage.getItem("modo.accountMode") === "agency";
  const allowedPlans = agencyMode ? agencyPlans : directPlans;
  const requestedPlan = params.get("plan") || window.sessionStorage.getItem("modo.selectedPlan");
  const initialPlan: PublicPlanSlug = requestedPlan && allowedPlans.includes(requestedPlan as PublicPlanSlug)
    ? requestedPlan as PublicPlanSlug
    : agencyMode ? "agency_studio" : "presenca";
  const homeHref = agencyMode ? "/app/agency" : "/app";

  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [plan, setPlan] = useState<PublicPlanSlug>(initialPlan);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [canceling, setCanceling] = useState(false);
  const [error, setError] = useState("");
  const [checkout, setCheckout] = useState<WooviCheckoutResponse | null>(null);
  const [copied, setCopied] = useState(false);

  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [taxID, setTaxID] = useState("");
  const [zipcode, setZipcode] = useState("");
  const [street, setStreet] = useState("");
  const [number, setNumber] = useState("");
  const [neighborhood, setNeighborhood] = useState("");
  const [city, setCity] = useState("");
  const [state, setState] = useState("");
  const [complement, setComplement] = useState("");
  const [couponCode, setCouponCode] = useState("");

  const selectedEntitlement = planEntitlements[plan];
  const price = useMemo(
    () =>
      new Intl.NumberFormat("pt-BR", {
        style: "currency",
        currency: "BRL",
        maximumFractionDigits: 0,
      }).format(selectedEntitlement.priceCents / 100),
    [selectedEntitlement.priceCents],
  );

  useEffect(() => {
    if (!getSessionToken()) {
      window.location.href = agencyMode ? "/app/agency" : "/app";
      return;
    }
    getDashboard()
      .then((data) => {
        setDashboard(data);
        setName(data.user.name);
      })
      .catch((caught) => setError(caught instanceof Error ? caught.message : "Não foi possível carregar sua conta."))
      .finally(() => setLoading(false));
  }, [agencyMode]);

  useEffect(() => {
    if (!checkout || !dashboard || isOperational(dashboard)) return;
    const timer = window.setInterval(() => {
      getDashboard()
        .then((data) => {
          setDashboard(data);
          if (data.usage.plan === plan && data.usage.status === "active") {
            window.clearInterval(timer);
          }
        })
        .catch(() => undefined);
    }, 5000);
    return () => window.clearInterval(timer);
  }, [checkout, dashboard, plan]);

  async function handleCheckout(event: FormEvent) {
    event.preventDefault();
    if (!dashboard) return;
    setSubmitting(true);
    setError("");
    setCopied(false);
    try {
      const result = await createWooviCheckout({
        plan,
        couponCode: couponCode.trim() || undefined,
        customer: {
          name,
          email: dashboard.user.email,
          phone: normalizeDigits(phone),
          taxID: normalizeDigits(taxID),
          address: {
            zipcode: normalizeDigits(zipcode),
            street,
            number,
            neighborhood,
            city,
            state,
            complement,
          },
        },
      });
      setCheckout(result);
      window.sessionStorage.removeItem("modo.selectedPlan");
      window.open(result.paymentLinkUrl, "_blank", "noopener,noreferrer");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Não foi possível iniciar a assinatura.");
    } finally {
      setSubmitting(false);
    }
  }

  async function copyPix() {
    if (!checkout) return;
    await navigator.clipboard.writeText(checkout.emv);
    setCopied(true);
  }

  async function handleCancel() {
    if (!window.confirm(`Cancelar a recorrência da ${agencyMode ? "MODO Agency" : "MODO"}? A produção será bloqueada imediatamente.`)) return;
    setCanceling(true);
    setError("");
    try {
      const result = await cancelWooviSubscription();
      if (dashboard) setDashboard({ ...dashboard, usage: result.usage });
      setCheckout(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Não foi possível cancelar a assinatura.");
    } finally {
      setCanceling(false);
    }
  }

  async function handleLogout() {
    await logoutAccount();
    window.location.href = agencyMode ? "/app/agency" : "/app";
  }

  if (loading) {
    return (
      <main className="billing-loading">
        <img src="/logo.svg" alt="MODO" />
        <div className="portal-spinner" />
        <p>{agencyMode ? "Carregando planos para sua carteira..." : "Carregando seus planos..."}</p>
      </main>
    );
  }

  if (!dashboard) {
    return (
      <main className="billing-loading">
        <img src="/logo.svg" alt="MODO" />
        <div className="portal-error">{error || "Sua sessão expirou."}</div>
        <a className="button button-primary" href={homeHref}>Voltar ao login</a>
      </main>
    );
  }

  const operational = isOperational(dashboard);
  const paidPlan = dashboard.usage.plan !== "trial";
  const currentPlanLabel = dashboard.usage.plan === "trial" ? (agencyMode ? "Teste Agency" : "Teste gratuito") : planNames[dashboard.usage.plan];

  return (
    <div className="billing-shell">
      <header className="billing-topbar">
        <a href={homeHref}><img src="/logo.svg" alt="MODO" /></a>
        <div>
          <a href={homeHref}>{agencyMode ? "Carteira" : "Painel"}</a>
          <a href={`/app/content${agencyMode ? "?mode=agency" : ""}`}>Criar conteúdo</a>
          <button onClick={handleLogout}>Sair</button>
        </div>
      </header>

      <main className="billing-main">
        <section className="billing-hero">
          <div>
            <span>PIX AUTOMÁTICO • WOOVI{agencyMode ? " • MODO AGENCY" : ""}</span>
            <h1>{agencyMode ? "Escolha o tamanho da sua carteira." : "Escolha o ritmo da sua presença."}</h1>
            <p>{agencyMode ? "O plano acompanha o número de clientes e a capacidade operacional da sua agência. A cobrança mensal fica centralizada em uma única assinatura." : "A primeira mensalidade e a autorização das próximas cobranças acontecem em um único fluxo seguro no seu banco."}</p>
          </div>
          <aside>
            <small>Plano atual</small>
            <strong>{currentPlanLabel}</strong>
            <span className={`billing-status status-${dashboard.usage.status}`}>{statusLabels[dashboard.usage.status]}</span>
          </aside>
        </section>

        {error && <div className="portal-error portal-error-wide">{error}</div>}

        {operational ? (
          <section className={`billing-success ${dashboard.usage.status === "retrying" ? "billing-warning" : ""}`}>
            <div>{dashboard.usage.status === "retrying" ? "!" : "✓"}</div>
            <span>{dashboard.usage.status === "retrying" ? "COBRANÇA EM RETENTATIVA" : "ASSINATURA ATIVA"}</span>
            <h2>{dashboard.usage.status === "retrying" ? "Seu acesso segue ativo durante as tentativas." : agencyMode ? "Sua carteira Agency está liberada." : "Seu plano está em modo presença."}</h2>
            <p>{dashboard.usage.status === "retrying" ? "A Woovi fará novas tentativas. Atualize o saldo da conta vinculada para evitar suspensão." : agencyMode ? "Clientes, créditos, equipe e limites estão disponíveis até o fim deste ciclo." : "Créditos e limites estão disponíveis até o fim deste ciclo."}</p>
            <div className="billing-success-actions">
              <a className="button button-primary" href={homeHref}>{agencyMode ? "Voltar à carteira" : "Ir para o painel"}</a>
              <button className="button button-secondary" onClick={handleCancel} disabled={canceling}>
                {canceling ? "Cancelando..." : "Cancelar assinatura"}
              </button>
            </div>
          </section>
        ) : (
          <>
            {paidPlan && (
              <section className={`billing-lifecycle-alert ${dashboard.usage.status}`}>
                <strong>{dashboard.usage.status === "suspended" ? "Assinatura suspensa" : "Assinatura cancelada"}</strong>
                <p>{dashboard.usage.status === "suspended" ? "As tentativas de cobrança terminaram sem pagamento. Ative novamente para liberar um novo ciclo." : "A recorrência foi encerrada. Escolha um plano para voltar a produzir."}</p>
              </section>
            )}

            <section className="billing-plan-grid">
              {allowedPlans.map((slug) => {
                const item = planEntitlements[slug];
                return (
                  <button
                    type="button"
                    key={slug}
                    className={`billing-plan-card ${plan === slug ? "selected" : ""}`}
                    onClick={() => setPlan(slug)}
                  >
                    {(agencyMode ? slug === "agency_studio" : slug === "presenca") && <em>Mais escolhido</em>}
                    <small>{planNames[slug]}</small>
                    <strong>R$ {item.priceCents / 100}<span>/mês</span></strong>
                    <p>{planDescriptions[slug]}</p>
                    <ul>
                      <li>{item.monthlyCredits} créditos mensais</li>
                      <li>{item.maxBrands} {agencyMode ? "cliente(s)" : "marca(s)"}</li>
                      <li>Até {item.maxUsers} {item.maxUsers === 1 ? "usuário" : "usuários"}</li>
                    </ul>
                  </button>
                );
              })}
            </section>

            <section className="billing-checkout-grid">
              <form className="billing-form" onSubmit={handleCheckout}>
                <div className="billing-form-heading">
                  <div><small>DADOS DE COBRANÇA</small><h2>Ativar {planNames[plan]}</h2></div>
                  <strong>{price}<span>/mês</span></strong>
                </div>

                <div className="billing-fields two-columns">
                  <label>Nome completo<input value={name} onChange={(event) => setName(event.target.value)} required /></label>
                  <label>E-mail<input value={dashboard.user.email} readOnly /></label>
                  <label>CPF ou CNPJ<input inputMode="numeric" value={taxID} onChange={(event) => setTaxID(event.target.value)} placeholder="Somente números" required /></label>
                  <label>Telefone<input inputMode="tel" value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="DDD + número" required /></label>
                  <label>CEP<input inputMode="numeric" value={zipcode} onChange={(event) => setZipcode(event.target.value)} placeholder="Somente números" required /></label>
                  <label>Estado<input value={state} onChange={(event) => setState(event.target.value.toUpperCase().slice(0, 2))} maxLength={2} placeholder="SP" required /></label>
                  <label className="field-wide">Rua<input value={street} onChange={(event) => setStreet(event.target.value)} required /></label>
                  <label>Número<input value={number} onChange={(event) => setNumber(event.target.value)} required /></label>
                  <label>Bairro<input value={neighborhood} onChange={(event) => setNeighborhood(event.target.value)} required /></label>
                  <label>Cidade<input value={city} onChange={(event) => setCity(event.target.value)} required /></label>
                  <label>Complemento<input value={complement} onChange={(event) => setComplement(event.target.value)} /></label>
                  <label className="field-wide billing-coupon-field">Cupom de desconto<input value={couponCode} onChange={(event) => setCouponCode(event.target.value.toUpperCase().replace(/[^A-Z0-9_-]/g, ""))} placeholder="Ex.: MODO20" /></label>
                </div>

                <button className="button button-primary button-full" disabled={submitting}>
                  {submitting ? "Criando Pix Automático..." : `Ativar por ${price}/mês`}
                </button>
                <p className="billing-consent">Ao continuar, você será direcionado à Woovi para pagar a primeira mensalidade e autorizar a recorrência no aplicativo do seu banco.</p>
              </form>

              <aside className="billing-summary">
                <span>RESUMO DA ASSINATURA</span>
                <h3>{planNames[plan]}</h3>
                <div><small>Mensalidade</small><strong>{price}</strong></div>
                <div><small>Créditos</small><strong>{selectedEntitlement.monthlyCredits}/mês</strong></div>
                <div><small>{agencyMode ? "Clientes" : "Marcas"}</small><strong>{selectedEntitlement.maxBrands}</strong></div>
                <div><small>Equipe</small><strong>{selectedEntitlement.maxUsers}</strong></div>
                <ul>
                  <li>Cancelamento direto pelo painel</li>
                  <li>Ativação automática após pagamento</li>
                  <li>Pagamento processado pela Woovi</li>
                </ul>
              </aside>
            </section>

            {checkout && (
              <section className="billing-pending">
                <div>
                  <span>AGUARDANDO AUTORIZAÇÃO</span>
                  <h2>Conclua no seu banco.</h2>
                  <p>Depois do pagamento, esta tela atualizará automaticamente e liberará seu novo ciclo.</p>
                 {checkout.discount && <p><strong>{checkout.discount.code}</strong> aplicado: de {money(checkout.discount.originalPriceCents)} por {money(checkout.discount.finalPriceCents)}.</p>}
                </div>
                <div className="billing-pending-actions">
                  <a className="button button-primary" href={checkout.paymentLinkUrl} target="_blank" rel="noreferrer">Abrir pagamento</a>
                  <button className="button button-secondary" type="button" onClick={copyPix}>{copied ? "Pix copiado" : "Copiar Pix"}</button>
                </div>
              </section>
            )}
          </>
        )}
      </main>
    </div>
  );
}
