import type { Dashboard } from "@modo/contracts";
import type { ContentRequest } from "@modo/contracts/content";
import { useEffect, useMemo, useState } from "react";
import { getDashboard, getSessionToken, listContentRequests, logoutAccount } from "./api";

const planLabels: Record<string, string> = {
  trial: "Teste gratuito",
  start: "MODO Começar",
  presenca: "MODO Presença",
  pro: "MODO Crescer",
  business: "MODO Business",
  agency_professional: "MODO Agency Professional",
  agency_studio: "MODO Agency Studio",
  agency: "MODO Agency",
};

const statusLabels: Record<string, string> = {
  queued: "Na fila",
  processing: "Em produção",
  ready: "Pronto para revisar",
  approved: "Aprovado",
  revision_requested: "Em revisão",
  failed: "Falhou",
  cancelled: "Cancelado",
};

function firstName(value: string) {
  return value.trim().split(/\s+/)[0] || "você";
}

function statusTone(status: string) {
  if (status === "approved") return "green";
  if (status === "failed" || status === "cancelled") return "warning";
  return "neutral";
}

function MobileHome({ dashboard, recent }: { dashboard: Dashboard; recent: ContentRequest[] }) {
  const activeBrand = dashboard.brands[0];
  return (
    <>
      <header className="modo-mobile-header">
        <img src="/pwa-icon.svg" alt="" />
        <div className="modo-mobile-credits">
          <strong>{dashboard.usage.creditsRemaining}</strong>
          <span>créditos</span>
        </div>
      </header>

      <section className="modo-mobile-hero">
        <span className="modo-mobile-pill green">{planLabels[dashboard.usage.plan] || "MODO"}</span>
        <h1>Olá, {firstName(dashboard.user.name)}.</h1>
        <p>A MODO já conhece <strong>{activeBrand?.name || dashboard.organization.name}</strong>. Escolha o resultado que você precisa agora.</p>
      </section>

      <section className="modo-mobile-modules">
        <a className="modo-mobile-module social" href="/app/content">
          <span className="modo-mobile-pill">INSTAGRAM E FACEBOOK</span>
          <b className="modo-mobile-symbol">◎</b>
          <h2>Crie presença visual.</h2>
          <p>Posts, imagens, carrosséis, stories e campanhas construídos com o contexto da sua marca.</p>
          <strong>Criar agora →</strong>
        </a>
        <a className="modo-mobile-module linkedin" href="/app/linkedin">
          <span className="modo-mobile-pill green">LINKEDIN</span>
          <b className="modo-mobile-symbol">in</b>
          <h2>Transforme intenção em autoridade.</h2>
          <p>Posts, artigos, documentos e ideias profissionais alinhados ao seu posicionamento.</p>
          <strong>Criar para LinkedIn →</strong>
        </a>
        <a className="modo-mobile-module intelligence" href="/app/inteligencia">
          <span className="modo-mobile-pill purple">INTELIGÊNCIA</span>
          <b className="modo-mobile-symbol">✦</b>
          <h2>Descubra sinais antes de decidir.</h2>
          <p>Concorrentes, oportunidades, sinais de mercado e caminhos para gerar demanda.</p>
          <strong>Explorar inteligência →</strong>
        </a>
      </section>

      <section className="modo-mobile-section">
        <div className="modo-mobile-section-head">
          <div><small>PRODUÇÃO RECENTE</small><h2>Continue de onde parou</h2></div>
          <a href="/app/week">Ver agenda</a>
        </div>
        {recent.length ? recent.map((item) => (
          <a className="modo-mobile-recent" href={"/app/content?open=" + encodeURIComponent(item.id)} key={item.id}>
            <div><span className={"modo-mobile-pill " + statusTone(item.status)}>{statusLabels[item.status] || item.status}</span><small>{item.channel}</small></div>
            <h3>{item.output?.title || item.brief}</h3>
            <p>{item.output?.caption || "A MODO está preparando texto e direção visual."}</p>
          </a>
        )) : (
          <div className="modo-mobile-empty"><strong>Sua primeira criação começa aqui</strong><p>Conte o objetivo. A MODO recomenda o formato e prepara uma entrega para sua revisão.</p><a href="/app/content">Criar agora</a></div>
        )}
      </section>
    </>
  );
}

function MobileAccount({ dashboard }: { dashboard: Dashboard }) {
  const used = dashboard.usage.creditsUsed;
  const granted = dashboard.usage.creditsGranted;
  const percent = Math.min(100, granted ? Math.round((used / granted) * 100) : 0);
  return (
    <>
      <header className="modo-mobile-header">
        <img src="/pwa-icon.svg" alt="" />
        <a className="modo-mobile-toplink" href="/app">Portal web</a>
      </header>
      <section className="modo-mobile-account-hero">
        <div className="modo-mobile-avatar">{dashboard.user.name.slice(0,1).toUpperCase()}</div>
        <div><small>CONTA MODO</small><h1>{dashboard.user.name}</h1><p>{dashboard.user.email}</p></div>
      </section>

      <section className="modo-mobile-account-card">
        <div><small>Plano atual</small><strong>{planLabels[dashboard.usage.plan] || dashboard.usage.plan}</strong></div>
        <div><small>Créditos disponíveis</small><strong>{dashboard.usage.creditsRemaining}</strong></div>
        <div><small>Organização</small><strong>{dashboard.organization.name}</strong></div>
        <div><small>Marcas ativas</small><strong>{dashboard.brands.length}</strong></div>
      </section>

      <section className="modo-mobile-account-card">
        <div className="modo-mobile-usage-head"><span>Uso do ciclo</span><strong>{percent}%</strong></div>
        <div className="modo-mobile-progress"><span style={{ width: percent + "%" }} /></div>
        <p>{used} de {granted} créditos utilizados.</p>
      </section>

      <section className="modo-mobile-account-links">
        <a href="/app/planos">Plano e assinatura <span>›</span></a>
        <a href="/app/conexoes">Contas conectadas <span>›</span></a>
        <a href="/politica-de-privacidade">Política de Privacidade <span>›</span></a>
        <a href="/exclusao-de-dados">Excluir conta e dados <span>›</span></a>
      </section>

      <button className="modo-mobile-logout" onClick={async () => { await logoutAccount(); window.location.href = "/app"; }}>Sair da conta</button>
    </>
  );
}

export default function MobilePWA() {
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [recent, setRecent] = useState<ContentRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const account = window.location.pathname.replace(/\/$/, "").endsWith("/account");

  useEffect(() => {
    if (!getSessionToken()) {
      window.location.replace("/app");
      return;
    }
    let active = true;
    Promise.all([getDashboard(), listContentRequests()])
      .then(([nextDashboard, requests]) => {
        if (!active) return;
        if (!nextDashboard.brands.length) {
          window.location.replace("/app/onboarding");
          return;
        }
        setDashboard(nextDashboard);
        setRecent(requests.slice(0, 3));
      })
      .catch((caught) => {
        if (active) setError(caught instanceof Error ? caught.message : "Não foi possível abrir a MODO.");
      })
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, []);

  const content = useMemo(() => {
    if (loading) return <div className="modo-mobile-loading"><img src="/pwa-icon.svg" alt="" /><div className="portal-spinner" /><p>Preparando sua MODO...</p></div>;
    if (!dashboard) return <div className="modo-mobile-loading"><img src="/pwa-icon.svg" alt="" /><p>{error || "Sua sessão expirou."}</p><a href="/app">Entrar novamente</a></div>;
    return account ? <MobileAccount dashboard={dashboard} /> : <MobileHome dashboard={dashboard} recent={recent} />;
  }, [account, dashboard, error, loading, recent]);

  return <main className="modo-mobile-shell">{content}</main>;
}
