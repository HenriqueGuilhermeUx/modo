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
  start: "MODO Start",
  presenca: "MODO Presença",
  pro: "MODO Pro",
  business: "MODO Business",
};

const planDescriptions: Record<PublicPlanSlug, string> = {
  start: "Para começar uma presença consistente.",
  presenca: "Para transformar conteúdo em rotina.",
  pro: "Para marcas em ritmo de crescimento.",
  business: "Para equipes e operações mais complexas.",
};

const statusLabels: Record<SubscriptionStatus, string> = {
  active: "Ativa",
  retrying: "Pagamento em retentativa",
  suspended: "Suspensa",
  canceled: "Cancelada",
};

function normalizeDigits(value: string) {
  return value.replace(/\D/g, "");
}

function isOperational(dashboard: Dashboard) {
  return dashboard.usage.plan !== "trial" &&
    ["active", "retrying"].includes(dashboard.usage.status);
}

export default function BillingWorkspace() {
  const storedPlan = window.sessionStorage.getItem("modo.selectedPlan");
  const initialPlan: PublicPlanSlug =
    storedPlan && ["start", "presenca", "pro", "business"].includes(storedPlan)
      ? (storedPlan as PublicPlanSlug)
      : "presenca";

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
      window.location.href = "/app";
      return;
    }
    getDashboard()
      .then((data) => {
        setDashboard(data);
        setName(data.user.name);
      })
      .catch((caught) => setError(caught instanceof Error ? caught.message : "Não foi possível carregar sua conta."))
      .finally(() => setLoading(false));
  }, []);

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
    if (!window.confirm("Cancelar a recorrência da MODO? A produção será bloqueada imediatamente.")) return;
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
    window.location.href = "/app";
  }

  if (loading) {
    return (
      <main className="billing-loading">
        <img src="/logo.svg" alt="MODO" />
        <div className="portal-spinner" />
        <p>Carregando seus planos...</p>
      </main>
    );
  }

  if (!dashboard) {
    return (
      <main className="billing-loading">
        <img src="/logo.svg" alt="MODO" />
        <div className="portal-error">{error || "Sua sessão expirou."}</div>
        <a className="button button-primary" href="/app">Voltar ao login</a>
      </main>
    );
  }

  const operational = isOperational(dashboard);
  const paidPlan = dashboard.usage.plan !== "trial";

  return (
    <div className="billing-shell">
      <header className="billing-topbar">
        <a href="/app"><img src="/logo.svg" alt="MODO" /></a>
        <div>
          <a href="/app">Painel</a>
          <a href="/app/content">Criar conteúdo</a>
          <button onClick={handleLogout}>Sair</button>
        </div>
      </header>

      <main className="billing-main">
        <section className="billing-hero">
          <div>
            <span>PIX AUTOMÁTICO • WOOVI</span>
            <h1>Escolha o ritmo da sua presença.</h1>
            <p>A primeira mensalidade e a autorização das próximas cobranças acontecem em um único fluxo seguro no seu banco.</p>
          </div>
          <aside>
            <small>Plano atual</small>
            <strong>{dashboard.usage.plan === "trial" ? "Teste gratuito" : planNames[dashboard.usage.plan]}</strong>
            <span className={`billing-status status-${dashboard.usage.status}`}>{statusLabels[dashboard.usage.status]}</span>
          </aside>
        </section>

        {error && <div className="portal-error portal-error-wide">{error}</div>}

        {operational ? (
          <section className={`billing-success ${dashboard.usage.status === "retrying" ? "billing-warning" : ""}`}>
            <div>{dashboard.usage.status === "retrying" ? "!" : "✓"}</div>
            <span>{dashboard.usage.status === "retrying" ? "COBRANÇA EM RETENTATIVA" : "ASSINATURA ATIVA"}</span>
            <h2>{dashboard.usage.status === "retrying" ? "Seu acesso segue ativo durante as tentativas." : "Seu plano está em modo presença."}</h2>
            <p>{dashboard.usage.status === "retrying" ? "A Woovi fará novas tentativas. Atualize o saldo da conta vinculada para evitar suspensão." : "Créditos e limites estão disponíveis até o fim deste ciclo."}</p>
            <div className="billing-success-actions">
              <a className="button button-primary" href="/app">Ir para o painel</a>
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
              {(Object.keys(planNames) as PublicPlanSlug[]).map((slug) => {
                const item = planEntitlements[slug];
                return (
                  <button
                    type="button"
                    key={slug}
                    className={`billing-plan-card ${plan === slug ? "selected" : ""}`}
                    onClick={() => setPlan(slug)}
                  >
                    {slug === "presenca" && <em>Mais escolhido</em>}
                    <small>{planNames[slug]}</small>
                    <strong>R$ {item.priceCents / 100}<span>/mês</span></strong>
                    <p>{planDescriptions[slug]}</p>
                    <ul>
                      <li>{item.monthlyCredits} créditos mensais</li>
                      <li>{item.maxBrands} marca(s)</li>
                      <li>Até {item.maxChannels} canal(is)</li>
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
                <div><small>Marcas</small><strong>{selectedEntitlement.maxBrands}</strong></div>
                <div><small>Canais</small><strong>{selectedEntitlement.maxChannels}</strong></div>
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
