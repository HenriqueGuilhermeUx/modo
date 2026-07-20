import { nicheLabels, type DiagnosticJob, type Niche } from "@modo/contracts";
import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { captureLead, createDiagnostic, getDiagnostic } from "./api";

const DIAGNOSTIC_CACHE_KEY = "modo.lastDiagnostic";

const nicheIcons: Record<Niche, string> = {
  saude_estetica: "✦",
  servicos_profissionais: "◫",
  imoveis: "⌂",
  varejo: "◇",
  educacao: "△",
  creator: "◎",
  outro: "+",
};

const stageCopy: Record<DiagnosticJob["stage"], string> = {
  queued: "Organizando sua análise...",
  validating: "Validando o contexto da marca...",
  extracting: "Identificando produtos, serviços e posicionamento...",
  structuring: "Estruturando a inteligência inicial da marca...",
  generating: "Preparando oportunidades e campanhas...",
  completed: "Diagnóstico pronto.",
  failed: "Não foi possível concluir.",
};

const moduleItems = [
  ["Scan", "Diagnóstico e oportunidades"],
  ["Brand", "Memória e inteligência da marca"],
  ["Plan", "Estratégia e calendário"],
  ["Create", "Campanhas e conteúdos"],
  ["Approve", "Revisão simples"],
  ["Publish", "Agendamento e distribuição"],
];

type PricingPlan = {
  slug: string;
  name: string;
  price: string;
  pricePrefix?: string;
  audience: string;
  description: string;
  limits: string[];
  cta: string;
  featured?: boolean;
};

const pricingPlans: PricingPlan[] = [
  {
    slug: "start",
    name: "MODO Start",
    price: "99",
    audience: "Para começar com consistência.",
    description: "O essencial para uma marca manter presença sem depender da tela em branco.",
    limits: ["6 créditos de conteúdo por mês", "Equivale a até 6 posts estáticos", "1 marca e 1 canal", "Até 2 carrosséis por mês", "1 ciclo de revisão por conteúdo", "Aprovação e exportação"],
    cta: "Começar com Start",
  },
  {
    slug: "presenca",
    name: "MODO Presença",
    price: "199",
    audience: "Para transformar conteúdo em rotina.",
    description: "O plano principal para profissionais e marcas que precisam aparecer toda semana.",
    limits: ["15 créditos de conteúdo por mês", "Equivale a até 15 posts estáticos", "1 marca e até 2 canais", "Até 5 carrosséis por mês", "Até 2 roteiros de vídeo curto", "2 ciclos de revisão por conteúdo", "Calendário, aprovação e agendamento"],
    cta: "Ativar MODO Presença",
    featured: true,
  },
  {
    slug: "pro",
    name: "MODO Pro",
    price: "399",
    audience: "Para marcas em ritmo de crescimento.",
    description: "Mais volume, formatos e espaço para operar duas marcas ou frentes de conteúdo.",
    limits: ["30 créditos de conteúdo por mês", "Equivale a até 30 posts estáticos", "Até 2 marcas e 4 canais", "Até 10 carrosséis por mês", "Até 6 roteiros de vídeo curto", "3 ciclos de revisão por conteúdo", "Campanhas, agendamento e insights"],
    cta: "Escolher MODO Pro",
  },
  {
    slug: "business",
    name: "MODO Business",
    price: "790",
    pricePrefix: "a partir de",
    audience: "Para equipes, unidades e múltiplas marcas.",
    description: "Uma operação maior, com limites definidos e possibilidade de expansão por add-ons.",
    limits: ["60 créditos de conteúdo por mês", "Equivale a até 60 posts estáticos", "Até 4 marcas e 8 canais", "Até 12 carrosséis por mês", "Até 12 roteiros de vídeo curto", "Até 8 usuários", "Fluxos de aprovação e relatórios"],
    cta: "Falar sobre Business",
  },
];

const Logo = () => <img className="logo" src="/logo.svg" alt="MODO" />;

export default function App() {
  const [websiteUrl, setWebsiteUrl] = useState("");
  const [instagramHandle, setInstagramHandle] = useState("");
  const [niche, setNiche] = useState<Niche>("servicos_profissionais");
  const [job, setJob] = useState<DiagnosticJob | null>(null);
  const [diagnosticId, setDiagnosticId] = useState("");
  const [error, setError] = useState("");
  const [leadCaptured, setLeadCaptured] = useState(false);
  const [leadLoading, setLeadLoading] = useState(false);
  const [name, setName] = useState("");
  const [contact, setContact] = useState("");
  const resultRef = useRef<HTMLElement>(null);
  const result = job?.result;
  const campaigns = useMemo(() => result?.campaigns ?? [], [result]);

  useEffect(() => {
    try {
      const cached = window.sessionStorage.getItem(DIAGNOSTIC_CACHE_KEY);
      if (!cached) return;
      const restored = JSON.parse(cached) as DiagnosticJob;
      if (restored.status === "completed" && restored.result) {
        setJob(restored);
        setDiagnosticId(restored.id);
      }
    } catch {
      window.sessionStorage.removeItem(DIAGNOSTIC_CACHE_KEY);
    }
  }, []);

  function revealResult() {
    window.setTimeout(() => resultRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 280);
  }

  async function handleDiagnostic(event: FormEvent) {
    event.preventDefault();
    setError("");
    setLeadCaptured(false);
    window.sessionStorage.removeItem(DIAGNOSTIC_CACHE_KEY);
    setJob({ id: "temporary", status: "processing", progress: 3, stage: "queued", createdAt: new Date().toISOString() });

    try {
      const normalizedUrl = /^https?:\/\//i.test(websiteUrl) ? websiteUrl : `https://${websiteUrl}`;
      const created = await createDiagnostic({ websiteUrl: normalizedUrl, niche, instagramHandle });
      setDiagnosticId(created.id);

      for (let attempt = 0; attempt < 70; attempt += 1) {
        const current = await getDiagnostic(created.id);
        setJob(current);

        if (current.status === "completed") {
          if (!current.result) throw new Error("O diagnóstico terminou, mas o resultado não foi recebido. Tente novamente.");
          window.sessionStorage.setItem(DIAGNOSTIC_CACHE_KEY, JSON.stringify(current));
          revealResult();
          return;
        }

        if (current.status === "failed") {
          throw new Error(current.error || "Não foi possível concluir o diagnóstico.");
        }

        await new Promise((resolve) => setTimeout(resolve, 900));
      }

      throw new Error("A análise está levando mais tempo que o esperado. Tente novamente em instantes.");
    } catch (caught) {
      setJob(null);
      setError(caught instanceof Error ? caught.message : "Não foi possível gerar o diagnóstico.");
    }
  }

  async function handleLead(event: FormEvent) {
    event.preventDefault();
    setLeadLoading(true);
    setError("");
    try {
      await captureLead({ diagnosticId, name, contact, consent: true });
      setLeadCaptured(true);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Revise seus dados.");
    } finally {
      setLeadLoading(false);
    }
  }

  function activatePlan(planSlug = "presenca") {
    window.sessionStorage.setItem("modo.selectedPlan", planSlug);
    const target = import.meta.env.VITE_CHECKOUT_URL || import.meta.env.VITE_WHATSAPP_URL;
    if (target) {
      const separator = target.includes("?") ? "&" : "?";
      window.location.href = `${target}${separator}plan=${encodeURIComponent(planSlug)}`;
      return;
    }
    document.querySelector("#diagnostico")?.scrollIntoView({ behavior: "smooth" });
  }

  return (
    <div className="site-shell">
      <header className="header container">
        <a href="#top"><Logo /></a>
        <nav className="nav"><a href="#como-funciona">Como funciona</a><a href="#plataforma">Plataforma</a><a href="#plano">Planos</a></nav>
        <div className="header-actions"><a className="header-login" href="/app">Entrar</a><a className="button button-small button-primary" href="#diagnostico">Analisar minha marca</a></div>
      </header>

      <main id="top">
        <section className="hero container">
          <div className="hero-copy">
            <div className="eyebrow"><span /> Agência inteligente de presença digital</div>
            <h1>Sua marca em <strong>modo presença.</strong></h1>
            <p className="hero-description">A MODO entende seu contexto, prepara a estratégia e transforma objetivos em campanhas prontas para você revisar e aprovar.</p>
            <div className="hero-actions"><a className="button button-primary" href="#diagnostico">Analisar minha marca <span>↗</span></a><a className="text-link" href="#como-funciona">Ver como funciona ↓</a></div>
            <div className="hero-proof"><span>Sem briefing interminável</span><span>Sem tela em branco</span><span>Com controle da marca</span></div>
          </div>
          <div className="hero-visual">
            <div className="orb orb-one" /><div className="orb orb-two" />
            <div className="mode-card mode-card-main"><div className="card-topline"><span className="status-dot" /> MODO está ativa <span className="card-menu">•••</span></div><div className="brand-row"><div className="brand-avatar">M</div><div><strong>Inteligência da marca</strong><small>Contexto atualizado</small></div></div><div className="progress-label"><span>Estratégia do ciclo</span><b>82%</b></div><div className="mini-progress"><span /></div><div className="task-list"><div><i className="done">✓</i><span>Diagnóstico</span><b>Concluído</b></div><div><i className="done">✓</i><span>Calendário</span><b>Concluído</b></div><div><i>3</i><span>Conteúdos</span><b>Para aprovar</b></div></div></div>
            <div className="floating-card floating-approve"><span>Conteúdo aprovado</span><strong>✓</strong></div><div className="floating-card floating-signal"><small>Sinal da semana</small><strong>Autoridade ↑</strong></div>
          </div>
        </section>

        <section className="diagnostic-section" id="diagnostico">
          {result && <div className="container diagnostic-ready"><div><span>✓</span><div><strong>Seu diagnóstico está pronto.</strong><p>O resultado continua salvo nesta sessão.</p></div></div><button type="button" className="button button-small button-primary" onClick={revealResult}>Ver diagnóstico</button></div>}
          <div className="container diagnostic-grid">
            <div className="diagnostic-intro"><div className="section-kicker">MODO SCAN</div><h2>Veja o que sua marca deveria publicar <strong>antes de contratar.</strong></h2><p>Informe seu site. A MODO identifica o contexto da marca e prepara oportunidades personalizadas de conteúdo.</p><ul className="check-list"><li>Leitura inicial de posicionamento</li><li>Diagnóstico de oportunidade</li><li>Campanhas para autoridade, demanda e conexão</li></ul></div>
            <form className="diagnostic-form" onSubmit={handleDiagnostic}>
              <label>Site da marca<input type="text" inputMode="url" placeholder="www.suamarca.com.br" value={websiteUrl} onChange={(e) => setWebsiteUrl(e.target.value)} required /></label>
              <label>Instagram <span>(opcional)</span><input type="text" placeholder="@suamarca" value={instagramHandle} onChange={(e) => setInstagramHandle(e.target.value)} /></label>
              <fieldset><legend>Qual é o universo da marca?</legend><div className="niche-grid">{(Object.keys(nicheLabels) as Niche[]).map((key) => <button className={niche === key ? "niche active" : "niche"} type="button" key={key} onClick={() => setNiche(key)}><span>{nicheIcons[key]}</span>{nicheLabels[key]}</button>)}</div></fieldset>
              <button className="button button-primary button-full" disabled={job?.status === "processing"}>{job?.status === "processing" ? "Analisando..." : result ? "Gerar novo diagnóstico" : "Gerar meu diagnóstico"} <span>⚡</span></button>
              <small className="form-note">Demonstração gratuita. Nenhuma publicação é feita sem aprovação.</small>{error && <div className="form-error"><strong>Não conseguimos exibir o diagnóstico.</strong><span>{error}</span></div>}
            </form>
          </div>
        </section>

        {job?.status === "processing" && <section className="processing container"><div className="processing-card"><div className="scan-animation"><span /><span /><span /></div><div><div className="section-kicker">ANÁLISE EM ANDAMENTO</div><h2>{stageCopy[job.stage]}</h2><p>A MODO está transformando contexto público em uma direção inicial de presença.</p><div className="large-progress"><span style={{ width: `${job.progress}%` }} /></div><small>{job.progress}% concluído</small></div></div></section>}

        {result && <section className="result-section" ref={resultRef}><div className="container">
          <div className="result-heading"><div><div className="section-kicker">DIAGNÓSTICO MODO</div><h2>Uma direção inicial para <strong>{result.brandSummary.name}</strong></h2></div><div className="result-badge">Perfil estruturado <span>✓</span></div></div>
          <div className="summary-strip"><div><small>Segmento</small><strong>{result.brandSummary.segment}</strong></div><div><small>Oferta percebida</small><strong>{result.brandSummary.primaryOffer}</strong></div><div><small>Público percebido</small><strong>{result.brandSummary.audience}</strong></div></div>
          <div className="diagnosis-card"><div className="diagnosis-number">01</div><div><small>Oportunidade principal</small><h3>{result.diagnosis.opportunity}</h3><p>{result.diagnosis.impact}</p><div className="recommendation"><b>Direção recomendada:</b> {result.diagnosis.recommendation}</div></div></div>
          <div className="campaign-heading"><div><div className="section-kicker">3 CAMPANHAS INICIAIS</div><h2>Conteúdo com uma função clara.</h2></div><p>Cada ideia ocupa um papel diferente na presença da marca.</p></div>
          <div className="campaign-grid">{campaigns.map((campaign, index) => { const locked = index > 0 && !leadCaptured; return <article className={locked ? "campaign-card locked" : "campaign-card"} key={campaign.id}><div className="campaign-top"><span>0{index + 1}</span><b>{campaign.eyebrow}</b></div><h3>{campaign.title}</h3><small>Direção visual</small><p>{campaign.visualDirection}</p><small>Legenda</small><p>{campaign.caption}</p><div className="campaign-tags">{campaign.hashtags.join(" ")}</div><div className="campaign-cta">{campaign.cta}</div>{locked && <div className="lock-layer"><div className="lock-icon">↗</div><strong>Libere a campanha completa</strong><span>Informe seu contato abaixo.</span></div>}</article>; })}</div>
          {!leadCaptured ? <form className="lead-capture" onSubmit={handleLead}><div><small>RECEBA O PLANO COMPLETO</small><h3>Encontramos mais duas direções para sua marca.</h3></div><input placeholder="Seu nome" value={name} onChange={(e) => setName(e.target.value)} required /><input placeholder="WhatsApp ou e-mail" value={contact} onChange={(e) => setContact(e.target.value)} required /><button className="button button-primary" disabled={leadLoading}>{leadLoading ? "Liberando..." : "Liberar plano"}</button><small className="consent-copy">Ao continuar, você aceita receber contato sobre a MODO.</small></form> : <div className="lead-success"><span>✓</span><div><strong>Plano liberado.</strong><p>Agora você pode revisar todas as campanhas sugeridas.</p></div><button className="button button-primary" onClick={() => activatePlan("presenca")}>Ativar minha presença</button></div>}
        </div></section>}

        <section className="how-section container" id="como-funciona"><div className="section-heading centered"><div className="section-kicker">COMO FUNCIONA</div><h2>Da marca à publicação, <strong>sem tela em branco.</strong></h2><p>A MODO prepara as decisões. Você mantém o controle.</p></div><div className="steps-grid">{[["01", "Entende", "Organiza contexto, produtos, público, voz e objetivos da marca."], ["02", "Planeja", "Transforma o contexto em pilares, campanhas e um calendário coerente."], ["03", "Cria", "Prepara títulos, legendas, estruturas visuais e chamadas para ação."], ["04", "Você aprova", "Revise, ajuste e aprove sem reuniões ou briefings intermináveis."], ["05", "Publica e aprende", "Organiza a distribuição e melhora os próximos ciclos com cada decisão."]].map(([number, title, copy]) => <article className="step" key={number}><span>{number}</span><h3>{title}</h3><p>{copy}</p></article>)}</div></section>

        <section className="platform-section" id="plataforma"><div className="container platform-grid"><div><div className="section-kicker light">MODO OPERATING SYSTEM</div><h2>Uma operação contínua para a presença da sua marca.</h2><p>O diagnóstico é só o começo. A MODO reúne inteligência da marca, estratégia, produção, aprovação e distribuição em um único fluxo.</p><a className="button button-light" href="#diagnostico">Começar pelo diagnóstico</a></div><div className="module-list">{moduleItems.map(([moduleName, description], index) => <div key={moduleName}><span>0{index + 1}</span><strong>MODO {moduleName}</strong><p>{description}</p><i>↗</i></div>)}</div></div></section>

        <section className="pricing-section" id="plano"><div className="container"><div className="pricing-heading"><div className="section-kicker">PLANOS MODO</div><h2>Capacidade clara para cada <strong>ritmo de presença.</strong></h2><p>Você sabe exatamente quantos conteúdos, marcas, canais e revisões estão incluídos. Sem promessa ilimitada escondendo custo ou perda de qualidade.</p></div><div className="pricing-grid">{pricingPlans.map((plan) => <article className={plan.featured ? "pricing-card featured" : "pricing-card"} key={plan.slug}>{plan.featured && <div className="pricing-badge">MAIS ESCOLHIDO</div>}<div className="pricing-card-head"><h3>{plan.name}</h3><p>{plan.audience}</p></div><div className="pricing-price">{plan.pricePrefix && <small>{plan.pricePrefix}</small>}<div><span>R$</span><strong>{plan.price}</strong><b>/mês</b></div></div><p className="pricing-description">{plan.description}</p><ul className="pricing-limits">{plan.limits.map((limit) => <li key={limit}>{limit}</li>)}</ul><button className={plan.featured ? "button button-primary button-full" : "button button-outline button-full"} onClick={() => activatePlan(plan.slug)}>{plan.cta} ↗</button></article>)}</div><div className="credit-rules"><div><strong>Como os créditos funcionam</strong><p>Post estático ou story: 1 crédito. Carrossel de até 7 páginas: 2 créditos. Roteiro de vídeo curto: 2 créditos.</p></div><div><strong>Canais e adaptações</strong><p>Publicar a mesma peça em outro canal não consome crédito extra. Uma adaptação específica de formato ou texto consome 1 crédito.</p></div><div><strong>Revisões e excedentes</strong><p>Revisões além do limite e capacidade adicional serão contratadas por pacotes, sem transformar o plano em uso ilimitado.</p></div></div></div></section>

        <section className="final-cta"><div className="container"><div><div className="section-kicker light">MODO ON</div><h2>Sua marca não precisa de mais uma ferramenta.</h2><p>Precisa de uma operação que continue acontecendo.</p></div><a className="button button-green" href="#diagnostico">Colocar minha marca em modo presença</a></div></section>
      </main>

      <footer className="footer container"><Logo /><p>Agência inteligente de presença digital.</p><div><a href="#top">Início</a><a href="#diagnostico">Diagnóstico</a><a href="#plano">Planos</a></div><small>© {new Date().getFullYear()} MODO. Sua marca em modo presença.</small></footer>
    </div>
  );
}
