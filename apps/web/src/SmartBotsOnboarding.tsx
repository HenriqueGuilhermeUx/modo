import type { Dashboard } from "@modo/contracts";
import type { SmartBotsIntake, SmartBotsIntakePayload } from "@modo/contracts/smartbots";
import { type FormEvent, useEffect, useState } from "react";
import { getDashboard, getSessionToken } from "./api";
import { getSmartBotsIntake, submitSmartBotsIntake } from "./smartbots-api";

const emptyForm: SmartBotsIntakePayload = {
  partner: "modo",
  plan: "presenca",
  businessName: "",
  ownerName: "",
  email: "",
  phone: "",
  instagram: "",
  segment: "",
  services: "",
  openingHours: "",
  faq: "",
  prices: "",
  welcomeMessage: "Olá! Como podemos ajudar você hoje?",
  googleReviewLink: "",
  notes: "",
};

const statusCopy: Record<SmartBotsIntake["status"], string> = {
  submitted: "Briefing recebido para implantação",
  sent: "Briefing encaminhado para a SmartBots",
  setup_in_progress: "Implantação em andamento",
  ready: "SmartBots Assistido pronto",
  failed: "O briefing foi salvo, mas o encaminhamento precisa ser revisado",
};

function upgradeToPresence() {
  window.sessionStorage.setItem("modo.selectedPlan", "presenca");
  window.location.href = "/app/planos";
}

export default function SmartBotsOnboarding() {
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [form, setForm] = useState<SmartBotsIntakePayload>(emptyForm);
  const [intake, setIntake] = useState<SmartBotsIntake | null>(null);
  const [eligible, setEligible] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  useEffect(() => {
    if (!getSessionToken()) {
      window.sessionStorage.setItem("modo.smartbotsActivation", "true");
      window.location.href = "/app";
      return;
    }
    Promise.all([getDashboard(), getSmartBotsIntake()])
      .then(([nextDashboard, smartBots]) => {
        setDashboard(nextDashboard);
        setEligible(smartBots.eligible);
        setIntake(smartBots.intake);
        if (smartBots.intake) {
          const { id: _id, organizationId: _organizationId, userId: _userId, status: _status, providerMessage: _providerMessage, createdAt: _createdAt, updatedAt: _updatedAt, ...payload } = smartBots.intake;
          setForm(payload);
        } else {
          setForm((current) => ({
            ...current,
            businessName: nextDashboard.brands[0]?.name || nextDashboard.organization.name,
            ownerName: nextDashboard.user.name,
            email: nextDashboard.user.email,
            instagram: nextDashboard.brands[0]?.instagramHandle || "",
            segment: nextDashboard.brands[0]?.niche || "",
          }));
        }
      })
      .catch((caught) => setError(caught instanceof Error ? caught.message : "Não foi possível abrir a ativação."))
      .finally(() => setLoading(false));
  }, []);

  function field<K extends keyof SmartBotsIntakePayload>(key: K, value: SmartBotsIntakePayload[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError("");
    setSuccess("");
    try {
      const saved = await submitSmartBotsIntake({ ...form, partner: "modo", plan: "presenca" });
      setIntake(saved);
      setSuccess("Briefing recebido. A equipe já pode iniciar a implantação assistida do seu SmartBots.");
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Não foi possível enviar o briefing.");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <main className="smartbots-loading"><img src="/logo.svg" alt="MODO" /><div className="portal-spinner" /><p>Preparando a ativação SmartBots...</p></main>;
  }

  if (!dashboard) {
    return <main className="smartbots-loading"><p>{error || "Sua sessão expirou."}</p><a className="button button-primary" href="/app">Entrar novamente</a></main>;
  }

  if (!eligible) {
    return (
      <main className="smartbots-gate">
        <a href="/"><img src="/logo.svg" alt="MODO" /></a>
        <section>
          <span>BENEFÍCIO DO MODO PRESENÇA</span>
          <h1>O SmartBots Assistido começa no plano Presença.</h1>
          <p>Além de direção, conteúdo e agenda, o Presença acrescenta mini site com bot, captação de leads, CRM simples e mensagens prontas para WhatsApp.</p>
          <div><strong>Marketing + captação + organização comercial</strong><small>O envio das mensagens continua manual e sob seu controle.</small></div>
          <button className="button button-primary" onClick={upgradeToPresence}>Conhecer e ativar MODO Presença</button>
          <a href="/smartbots.html">Ver como o SmartBots funciona</a>
        </section>
      </main>
    );
  }

  return (
    <div className="smartbots-onboarding-shell">
      <header className="smartbots-onboarding-header">
        <a href="/app"><img src="/logo.svg" alt="MODO" /></a>
        <div><small>SMARTBOTS ASSISTIDO</small><strong>Incluído no {dashboard.usage.plan === "presenca" ? "MODO Presença" : "seu plano MODO"}</strong></div>
        <a href="/app">Voltar ao painel</a>
      </header>

      <main className="smartbots-onboarding-main">
        <section className="smartbots-onboarding-hero">
          <div>
            <span>ATIVAÇÃO ASSISTIDA</span>
            <h1>Conte como seu negócio funciona. <strong>A equipe prepara o resto.</strong></h1>
            <p>Estas informações serão usadas para montar o mini site, configurar o bot, organizar a captação e preparar as primeiras mensagens comerciais.</p>
          </div>
          <aside><small>IMPORTANTE</small><strong>O WhatsApp não envia mensagens automaticamente.</strong><p>O SmartBots prepara textos e próximos passos. Você revisa e faz o envio manual.</p></aside>
        </section>

        {intake && <section className={`smartbots-status ${intake.status}`}><span>✓</span><div><small>STATUS DA IMPLANTAÇÃO</small><strong>{statusCopy[intake.status]}</strong><p>Atualizado em {new Date(intake.updatedAt).toLocaleString("pt-BR")}</p>{intake.providerMessage && <p>{intake.providerMessage}</p>}</div></section>}
        {error && <div className="portal-error portal-error-wide">{error}</div>}
        {success && <div className="workspace-success">{success}</div>}

        <form className="smartbots-form" onSubmit={submit}>
          <section>
            <div className="smartbots-form-heading"><span>01</span><div><small>IDENTIFICAÇÃO</small><h2>Quem é o negócio?</h2></div></div>
            <div className="smartbots-fields two">
              <label>Nome da empresa<input value={form.businessName} onChange={(event) => field("businessName", event.target.value)} required /></label>
              <label>Responsável<input value={form.ownerName} onChange={(event) => field("ownerName", event.target.value)} required /></label>
              <label>E-mail<input type="email" value={form.email} onChange={(event) => field("email", event.target.value)} required /></label>
              <label>WhatsApp<input value={form.phone} onChange={(event) => field("phone", event.target.value)} placeholder="(11) 99999-9999" required /></label>
              <label>Instagram<input value={form.instagram} onChange={(event) => field("instagram", event.target.value)} placeholder="@seunegocio" /></label>
              <label>Segmento<input value={form.segment} onChange={(event) => field("segment", event.target.value)} placeholder="Ex.: clínica, consultoria, loja local" required /></label>
            </div>
          </section>

          <section>
            <div className="smartbots-form-heading"><span>02</span><div><small>OFERTA E ATENDIMENTO</small><h2>O que o bot precisa saber?</h2></div></div>
            <div className="smartbots-fields">
              <label>Serviços ou produtos<textarea value={form.services} onChange={(event) => field("services", event.target.value)} placeholder="Liste os principais serviços, produtos e diferenciais." required /></label>
              <label>Horários de atendimento<textarea value={form.openingHours} onChange={(event) => field("openingHours", event.target.value)} placeholder="Ex.: segunda a sexta, das 8h às 18h." /></label>
              <label>Preços ou planos<textarea value={form.prices} onChange={(event) => field("prices", event.target.value)} placeholder="Informe valores que podem ser exibidos. Deixe claro quando o preço depende de orçamento." /></label>
            </div>
          </section>

          <section>
            <div className="smartbots-form-heading"><span>03</span><div><small>CONVERSA INICIAL</small><h2>Como o SmartBots deve receber o visitante?</h2></div></div>
            <div className="smartbots-fields">
              <label>Mensagem inicial<textarea value={form.welcomeMessage} onChange={(event) => field("welcomeMessage", event.target.value)} placeholder="Ex.: Olá! Sou o assistente da empresa. Posso ajudar a conhecer nossos serviços ou solicitar atendimento." required /></label>
              <label>Perguntas frequentes<textarea value={form.faq} onChange={(event) => field("faq", event.target.value)} placeholder={'Uma por linha. Ex.:\nVocês atendem online?\nQual é o prazo?\nComo peço um orçamento?'} /></label>
              <label>Link das avaliações no Google<input type="url" value={form.googleReviewLink} onChange={(event) => field("googleReviewLink", event.target.value)} placeholder="https://g.page/r/..." /></label>
              <label>Observações para implantação<textarea value={form.notes} onChange={(event) => field("notes", event.target.value)} placeholder="Restrições, palavras que não devem ser usadas, cidades atendidas, regras comerciais ou outras informações." /></label>
            </div>
          </section>

          <section className="smartbots-submit-card">
            <div><small>PRÓXIMO PASSO</small><h2>Enviar para implantação assistida</h2><p>A equipe revisará os dados e configurará a estrutura inicial. Você poderá acompanhar o status nesta mesma página.</p></div>
            <button className="button button-primary" disabled={saving}>{saving ? "Enviando briefing..." : intake ? "Atualizar briefing" : "Enviar para implantação"}</button>
          </section>
        </form>
      </main>
    </div>
  );
}
