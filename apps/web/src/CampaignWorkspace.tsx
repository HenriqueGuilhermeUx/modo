import type { Dashboard } from "@modo/contracts";
import { useEffect, useMemo, useState } from "react";
import { getDashboard, getSessionToken } from "./api";

type CampaignGoal = "messages" | "leads" | "sales" | "awareness";
type CampaignDuration = 7 | 14 | 30;

type CampaignAngle = {
  id: string;
  title: string;
  strategy: string;
  primaryText: string;
  headline: string;
  cta: string;
  visualDirection: string;
};

type CampaignPlan = {
  brandId: string;
  brandName: string;
  goal: CampaignGoal;
  goalLabel: string;
  metaObjective: string;
  offer: string;
  audience: string;
  location: string;
  destination: string;
  proof: string;
  budget: number;
  duration: CampaignDuration;
  dailyBudget: number;
  structure: string[];
  audiencePlan: string[];
  measurementPlan: string[];
  angles: CampaignAngle[];
  createdAt: string;
};

const DRAFT_KEY = "modo.campaignCopilotDraft";

const goalOptions: Array<{
  id: CampaignGoal;
  label: string;
  helper: string;
  metaObjective: string;
  cta: string;
}> = [
  {
    id: "messages",
    label: "Receber mensagens",
    helper: "Ideal para WhatsApp, direct, orçamento e agendamento.",
    metaObjective: "Engajamento · mensagens",
    cta: "Enviar mensagem",
  },
  {
    id: "leads",
    label: "Captar contatos",
    helper: "Ideal para formulário, lista de espera e diagnóstico.",
    metaObjective: "Leads",
    cta: "Cadastre-se",
  },
  {
    id: "sales",
    label: "Vender uma oferta",
    helper: "Ideal para página de venda, checkout e catálogo.",
    metaObjective: "Vendas",
    cta: "Comprar agora",
  },
  {
    id: "awareness",
    label: "Ser mais conhecido",
    helper: "Ideal para apresentar a marca e aumentar lembrança.",
    metaObjective: "Reconhecimento",
    cta: "Saiba mais",
  },
];

const durationOptions: CampaignDuration[] = [7, 14, 30];

function currency(value: number) {
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function normalizeSentence(value: string, fallback: string) {
  const clean = value.trim().replace(/\s+/g, " ");
  return clean || fallback;
}

function buildCampaignPlan(input: {
  brandId: string;
  brandName: string;
  goal: CampaignGoal;
  offer: string;
  audience: string;
  location: string;
  destination: string;
  proof: string;
  budget: number;
  duration: CampaignDuration;
}): CampaignPlan {
  const option = goalOptions.find((item) => item.id === input.goal) || goalOptions[0];
  const offer = normalizeSentence(input.offer, "sua principal oferta");
  const audience = normalizeSentence(input.audience, "pessoas que precisam dessa solução");
  const location = normalizeSentence(input.location, "Brasil");
  const destination = normalizeSentence(input.destination, "o canal de atendimento da marca");
  const proof = normalizeSentence(input.proof, "atendimento próximo e solução prática");
  const dailyBudget = Math.max(1, Math.round((input.budget / input.duration) * 100) / 100);
  const brandName = normalizeSentence(input.brandName, "Sua marca");

  const structure = input.budget < 300
    ? [
        "1 conjunto de anúncios para evitar fragmentar o orçamento.",
        "3 anúncios com ângulos diferentes dentro do mesmo público.",
        "Revisão após os primeiros resultados, sem alterar tudo ao mesmo tempo.",
      ]
    : [
        "70% do orçamento para alcançar novas pessoas.",
        "20% para reimpactar quem demonstrou interesse.",
        "10% para testar uma nova mensagem ou criativo.",
      ];

  const audiencePlan = [
    `Localização: ${location}.`,
    `Público principal: ${audience}.`,
    "Começar com segmentação simples; evitar empilhar interesses sem evidência.",
    "Excluir clientes atuais quando o objetivo for aquisição de novos clientes.",
  ];

  const measurementPlan = input.goal === "sales"
    ? ["Compras ou pedidos gerados", "Custo por compra", "Valor vendido e retorno sobre o investimento"]
    : input.goal === "leads"
      ? ["Leads válidos", "Custo por lead", "Percentual de leads que avançam no atendimento"]
      : input.goal === "messages"
        ? ["Conversas iniciadas", "Custo por conversa", "Percentual de conversas que viram oportunidade"]
        : ["Pessoas alcançadas", "Frequência média", "Cliques, visitas e sinais de interesse"];

  const angles: CampaignAngle[] = [
    {
      id: "pain-relief",
      title: "Resolver a dor agora",
      strategy: "Começa pelo problema que o cliente já reconhece e apresenta uma saída clara.",
      primaryText: `Se ${audience.toLowerCase()} estão enfrentando esse problema, existe um caminho mais simples. ${brandName} oferece ${offer.toLowerCase()} com ${proof.toLowerCase()}. Fale com a gente e entenda o próximo passo.`,
      headline: `${offer}: uma solução mais simples`,
      cta: option.cta,
      visualDirection: "Mostrar a situação-problema e a transformação em uma composição limpa, com benefício principal em destaque.",
    },
    {
      id: "proof",
      title: "Prova e confiança",
      strategy: "Reduz insegurança usando evidência, método, experiência ou diferencial concreto.",
      primaryText: `${proof}. É assim que ${brandName} entrega ${offer.toLowerCase()} para ${audience.toLowerCase()}. Conheça a proposta e veja como funciona antes de decidir.`,
      headline: `Por que escolher ${brandName}?`,
      cta: option.cta,
      visualDirection: "Usar prova visual real: bastidor, resultado, depoimento autorizado, processo ou demonstração do serviço.",
    },
    {
      id: "opportunity",
      title: "Oportunidade e movimento",
      strategy: "Apresenta uma oportunidade concreta e conduz a uma ação simples, sem pressão exagerada.",
      primaryText: `${brandName} preparou uma forma prática de acessar ${offer.toLowerCase()}. Para ${audience.toLowerCase()} em ${location}, este pode ser o momento de conhecer uma alternativa mais direta.`,
      headline: `Conheça ${offer}`,
      cta: option.cta,
      visualDirection: "Criativo direto, com oferta, público e chamada para ação visíveis em poucos segundos.",
    },
  ];

  return {
    ...input,
    brandName,
    offer,
    audience,
    location,
    destination,
    proof,
    budget: Math.max(35, input.budget),
    goalLabel: option.label,
    metaObjective: option.metaObjective,
    dailyBudget,
    structure,
    audiencePlan,
    measurementPlan,
    angles,
    createdAt: new Date().toISOString(),
  };
}

function campaignBrief(plan: CampaignPlan, angle: CampaignAngle) {
  return [
    `Crie um anúncio para a campanha “${plan.offer}”.`,
    `Marca: ${plan.brandName}.`,
    `Objetivo: ${plan.goalLabel}.`,
    `Público: ${plan.audience}.`,
    `Região: ${plan.location}.`,
    `Destino: ${plan.destination}.`,
    `Ângulo escolhido: ${angle.title} — ${angle.strategy}`,
    `Texto-base: ${angle.primaryText}`,
    `Título-base: ${angle.headline}`,
    `CTA: ${angle.cta}.`,
    `Direção visual: ${angle.visualDirection}`,
    "Entregue uma peça clara, confiável, sem promessas exageradas e pronta para revisão antes da publicação.",
  ].join("\n");
}

export default function CampaignWorkspace() {
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [step, setStep] = useState(0);
  const [brandId, setBrandId] = useState("");
  const [goal, setGoal] = useState<CampaignGoal>("messages");
  const [offer, setOffer] = useState("");
  const [audience, setAudience] = useState("");
  const [location, setLocation] = useState("");
  const [destination, setDestination] = useState("WhatsApp");
  const [proof, setProof] = useState("");
  const [budget, setBudget] = useState(350);
  const [duration, setDuration] = useState<CampaignDuration>(7);
  const [plan, setPlan] = useState<CampaignPlan | null>(null);
  const [copied, setCopied] = useState("");

  useEffect(() => {
    if (!getSessionToken()) {
      window.location.href = "/app";
      return;
    }
    getDashboard()
      .then((current) => {
        setDashboard(current);
        setBrandId(current.brands[0]?.id || "");
        const raw = window.localStorage.getItem(DRAFT_KEY);
        if (raw) {
          try {
            const restored = JSON.parse(raw) as CampaignPlan;
            if (current.brands.some((brand) => brand.id === restored.brandId)) {
              setPlan(restored);
              setBrandId(restored.brandId);
              setGoal(restored.goal);
              setOffer(restored.offer);
              setAudience(restored.audience);
              setLocation(restored.location);
              setDestination(restored.destination);
              setProof(restored.proof);
              setBudget(restored.budget);
              setDuration(restored.duration);
              setStep(4);
            }
          } catch {
            window.localStorage.removeItem(DRAFT_KEY);
          }
        }
      })
      .catch((caught) => setError(caught instanceof Error ? caught.message : "Não foi possível abrir o Copiloto de Campanhas."))
      .finally(() => setLoading(false));
  }, []);

  const selectedBrand = useMemo(
    () => dashboard?.brands.find((brand) => brand.id === brandId) || dashboard?.brands[0],
    [brandId, dashboard],
  );

  const progress = plan ? 100 : Math.round(((step + 1) / 4) * 100);
  const canContinue = step === 0
    ? Boolean(brandId && goal)
    : step === 1
      ? offer.trim().length >= 3
      : step === 2
        ? audience.trim().length >= 3
        : budget >= 35;

  function generatePlan() {
    if (!selectedBrand) return;
    const next = buildCampaignPlan({
      brandId: selectedBrand.id,
      brandName: selectedBrand.name,
      goal,
      offer,
      audience,
      location,
      destination,
      proof,
      budget,
      duration,
    });
    setPlan(next);
    setStep(4);
    window.localStorage.setItem(DRAFT_KEY, JSON.stringify(next));
    window.setTimeout(() => document.querySelector(".campaign-plan")?.scrollIntoView({ behavior: "smooth", block: "start" }), 80);
  }

  function prepareInStudio(angle: CampaignAngle) {
    if (!plan) return;
    const objective = plan.goal === "awareness" ? "autoridade" : "conversao";
    window.sessionStorage.setItem("modo.directorPrefill", JSON.stringify({
      brandId: plan.brandId,
      contentType: "static_post",
      objective,
      channel: "Meta Ads",
      brief: campaignBrief(plan, angle),
    }));
    window.location.href = "/app/content";
  }

  async function copyText(key: string, text: string) {
    await navigator.clipboard.writeText(text);
    setCopied(key);
    window.setTimeout(() => setCopied(""), 1600);
  }

  function reset() {
    setPlan(null);
    setStep(0);
    setOffer("");
    setAudience("");
    setLocation("");
    setDestination("WhatsApp");
    setProof("");
    setBudget(350);
    setDuration(7);
    window.localStorage.removeItem(DRAFT_KEY);
  }

  if (loading) return <main className="campaign-loading"><img src="/logo.svg" alt="MODO" /><div className="portal-spinner" /><p>Preparando seu copiloto de campanhas...</p></main>;
  if (!dashboard) return <main className="campaign-loading"><p>{error || "Sua sessão expirou."}</p><a className="button button-primary" href="/app">Entrar novamente</a></main>;

  return (
    <div className="campaign-shell">
      <header className="campaign-header">
        <a href="/app"><img src="/logo.svg" alt="MODO" /></a>
        <nav><a href="/app">Painel</a><a href="/app/director">Diretor</a><a className="active" href="/app/campanhas">Campanhas</a><a href="/app/content">Estúdio</a><a href="/app/inteligencia">Inteligência</a></nav>
        <a className="campaign-back" href="/app">Voltar ao painel</a>
      </header>

      <main className="campaign-main">
        <section className="campaign-hero">
          <div>
            <span>MODO CAMPAIGNS</span>
            <h1>Conte o que precisa vender. <strong>A Modo organiza a campanha.</strong></h1>
            <p>Sem jargão, painel vazio ou configuração escondida. Responda poucas perguntas e receba público, mensagem, orçamento, anúncios e próximos passos.</p>
          </div>
          <aside>
            <small>REGRA DE SEGURANÇA</small>
            <strong>Nada é publicado automaticamente.</strong>
            <p>Você revisa os anúncios e a estrutura antes de qualquer ativação ou gasto.</p>
          </aside>
        </section>

        <section className="campaign-progress" aria-label="Progresso da configuração">
          <div><span style={{ width: `${progress}%` }} /></div>
          <p>{plan ? "Plano pronto" : `Etapa ${step + 1} de 4`} · {progress}%</p>
        </section>

        {error && <div className="portal-error portal-error-wide">{error}</div>}

        {!plan && (
          <section className="campaign-wizard">
            <div className="campaign-wizard-copy">
              <small>AJUDA CONTEXTUAL</small>
              <h2>{step === 0 ? "O que esta campanha precisa fazer?" : step === 1 ? "O que você quer oferecer?" : step === 2 ? "Quem precisa dessa oferta?" : "Quanto deseja investir neste primeiro teste?"}</h2>
              <p>{step === 0 ? "Escolha o resultado mais próximo do que você realmente espera receber." : step === 1 ? "Descreva a oferta em linguagem simples. A Modo cuidará da estrutura." : step === 2 ? "Fale como você explicaria o cliente ideal para alguém da sua equipe." : "A Modo evita dividir um orçamento pequeno em campanhas demais."}</p>
            </div>

            <div className="campaign-step-card">
              {step === 0 && <>
                <label className="campaign-field">Marca<select value={brandId} onChange={(event) => setBrandId(event.target.value)}>{dashboard.brands.map((brand) => <option key={brand.id} value={brand.id}>{brand.name}</option>)}</select></label>
                <div className="campaign-choice-grid">{goalOptions.map((option) => <button type="button" key={option.id} className={goal === option.id ? "active" : ""} onClick={() => setGoal(option.id)}><strong>{option.label}</strong><span>{option.helper}</span></button>)}</div>
              </>}

              {step === 1 && <div className="campaign-fields">
                <label className="campaign-field">Oferta principal<textarea value={offer} onChange={(event) => setOffer(event.target.value)} placeholder="Ex.: avaliação gratuita para clínicas que querem aumentar os agendamentos" /></label>
                <label className="campaign-field">Para onde a pessoa deve ir?<select value={destination} onChange={(event) => setDestination(event.target.value)}><option>WhatsApp</option><option>Direct do Instagram</option><option>Formulário</option><option>Site ou landing page</option><option>Loja ou checkout</option></select></label>
                <label className="campaign-field">Prova ou diferencial <span>opcional</span><textarea value={proof} onChange={(event) => setProof(event.target.value)} placeholder="Ex.: 12 anos de experiência, atendimento em 24h, mais de 300 clientes" /></label>
              </div>}

              {step === 2 && <div className="campaign-fields">
                <label className="campaign-field">Cliente ideal<textarea value={audience} onChange={(event) => setAudience(event.target.value)} placeholder="Ex.: donos de clínicas de estética com agenda ociosa e equipe pequena" /></label>
                <label className="campaign-field">Onde estão essas pessoas?<input value={location} onChange={(event) => setLocation(event.target.value)} placeholder="Ex.: Campinas e região, São Paulo ou Brasil" /></label>
                <div className="campaign-helper"><strong>Não sabe segmentar?</strong><p>Descreva somente quem compra e onde está. A Modo começa simples e evita interesses aleatórios.</p></div>
              </div>}

              {step === 3 && <div className="campaign-fields">
                <label className="campaign-field">Orçamento total<input type="number" min={35} step={10} value={budget} onChange={(event) => setBudget(Math.max(35, Number(event.target.value)))} /></label>
                <div className="campaign-duration"><small>Duração do primeiro ciclo</small>{durationOptions.map((days) => <button type="button" key={days} className={duration === days ? "active" : ""} onClick={() => setDuration(days)}>{days} dias</button>)}</div>
                <div className="campaign-budget-preview"><span>Investimento médio por dia</span><strong>{currency(budget / duration)}</strong><p>A recomendação final ajustará a estrutura ao tamanho do orçamento.</p></div>
              </div>}

              <div className="campaign-wizard-actions">
                <button type="button" className="button button-outline" disabled={step === 0} onClick={() => setStep((current) => Math.max(0, current - 1))}>← Voltar</button>
                {step < 3
                  ? <button type="button" className="button button-primary" disabled={!canContinue} onClick={() => setStep((current) => Math.min(3, current + 1))}>Continuar →</button>
                  : <button type="button" className="button button-primary" disabled={!canContinue} onClick={generatePlan}>Montar minha campanha ↗</button>}
              </div>
            </div>
          </section>
        )}

        {plan && <section className="campaign-plan">
          <div className="campaign-plan-heading"><div><small>PLANO PRONTO PARA REVISÃO</small><h2>{plan.offer}</h2><p>{plan.goalLabel} para {plan.audience} em {plan.location}.</p></div><button type="button" className="button button-outline" onClick={reset}>Criar outra campanha</button></div>

          <div className="campaign-summary-grid">
            <article><small>OBJETIVO RECOMENDADO</small><strong>{plan.metaObjective}</strong><span>{plan.goalLabel}</span></article>
            <article><small>ORÇAMENTO</small><strong>{currency(plan.budget)}</strong><span>{currency(plan.dailyBudget)} por dia · {plan.duration} dias</span></article>
            <article><small>DESTINO</small><strong>{plan.destination}</strong><span>Nenhum anúncio será publicado sem revisão.</span></article>
          </div>

          <div className="campaign-plan-grid">
            <article className="campaign-strategy-card"><small>ESTRUTURA SIMPLES</small><h3>Como a campanha começa</h3><ol>{plan.structure.map((item) => <li key={item}>{item}</li>)}</ol></article>
            <article className="campaign-strategy-card"><small>PÚBLICO</small><h3>Quem será alcançado</h3><ul>{plan.audiencePlan.map((item) => <li key={item}>{item}</li>)}</ul></article>
            <article className="campaign-strategy-card"><small>MEDIÇÃO</small><h3>O que acompanhar</h3><ul>{plan.measurementPlan.map((item) => <li key={item}>{item}</li>)}</ul></article>
          </div>

          <div className="campaign-section-title"><small>3 ANÚNCIOS PARA TESTAR</small><h2>A Modo muda a mensagem, não apenas a cor.</h2><p>Comece com três hipóteses claras. Depois mantenha o que atrai oportunidades reais.</p></div>

          <div className="campaign-angle-grid">{plan.angles.map((angle) => <article key={angle.id}>
            <div className="campaign-angle-top"><span>{String(plan.angles.indexOf(angle) + 1).padStart(2, "0")}</span><div><small>ÂNGULO</small><h3>{angle.title}</h3></div></div>
            <p className="campaign-angle-strategy">{angle.strategy}</p>
            <div className="campaign-ad-preview"><small>TEXTO PRINCIPAL</small><p>{angle.primaryText}</p><small>TÍTULO</small><strong>{angle.headline}</strong><span>{angle.cta}</span></div>
            <div className="campaign-angle-actions"><button type="button" onClick={() => copyText(angle.id, `${angle.primaryText}\n\n${angle.headline}\nCTA: ${angle.cta}`)}>{copied === angle.id ? "Copiado ✓" : "Copiar texto"}</button><button type="button" className="primary" onClick={() => prepareInStudio(angle)}>Criar no Estúdio →</button></div>
          </article>)}</div>

          <div className="campaign-launch-card"><div><small>PRÓXIMO PASSO</small><h2>Produza os anúncios e revise antes de ativar.</h2><p>O Estúdio recebe a marca, o objetivo, o público, a copy e a direção visual deste plano. Depois da aprovação, conectaremos a publicação no Meta em modo pausado.</p></div><button type="button" className="button button-primary" onClick={() => prepareInStudio(plan.angles[0])}>Produzir primeiro anúncio ↗</button></div>
        </section>}
      </main>
    </div>
  );
}
