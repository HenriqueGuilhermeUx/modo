import { nicheLabels, type DiagnosticJob, type Niche } from "@modo/contracts";
import { type FormEvent, useEffect, useMemo, useRef, useState } from "react";
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
  ["Quick", "Comece com link, tema, texto ou voz"],
  ["Director", "Decisões, campanhas e missões"],
  ["Create", "Conteúdos e adaptações"],
  ["Studio", "Edição e exportação sem outra ferramenta"],
  ["Week", "Agenda prática e próximos passos"],
  ["Capture", "Direção para vídeos e bastidores"],
  ["Approve", "Revisão simples"],
  ["Publish", "Agendamento e distribuição"],
  ["Signal", "Desempenho e aprendizado"],
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
    window.location.href = "/app";
  }

  return (
    <div className="site-shell">
      <header className="header container">
        <a href="#top"><Logo /></a>
        <nav className="nav"><a href="#como-funciona">Como funciona</a><a href="#linkedin">LinkedIn</a><a href="#plataforma">Plataforma</a><a href="#plano">Planos</a></nav>
        <div className="header-actions"><a className="header-login" href="/app">Entrar</a><a className="button button-small button-primary" href="#diagnostico">Analisar minha marca</a></div>
      </header>

      <main id="top">
        <section className="hero container">
          <div className="hero-copy">
            <div className="eyebrow"><span /> Agência inteligente de presença digital</div>
            <h1>Sua marca em <strong>modo presença.</strong></h1>
            <p className="hero-description">A MODO conhece sua empresa, decide o que vale comunicar, cria conteúdos para Instagram, Facebook e LinkedIn, orienta vídeos com pessoas reais e aprende com o desempenho.</p>
            <div className="hero-actions"><a className="button button-primary" href="#diagnostico">Analisar minha marca <span>↗</span></a><a className="text-link" href="#como-funciona">Entender o potencial ↓</a></div>
            <div className="hero-proof"><span>Sem precisar criar prompts</span><span>Com direção profissional</span><span>Com aprovação da empresa</span></div>
          </div>
          <div className="hero-visual">
            <div className="orb orb-one" /><div className="orb orb-two" />
            <div className="mode-card mode-card-main"><div className="card-topline"><span className="status-dot" /> MODO está ativa <span className="card-menu">•••</span></div><div className="brand-row"><div className="brand-avatar">M</div><div><strong>Inteligência da marca</strong><small>Contexto atualizado</small></div></div><div className="progress-label"><span>Estratégia do ciclo</span><b>82%</b></div><div className="mini-progress"><span /></div><div className="task-list"><div><i className="done">✓</i><span>LinkedIn de autoridade</span><b>Planejado</b></div><div><i className="done">✓</i><span>Vídeo com fundador</span><b>Dirigido</b></div><div><i>3</i><span>Conteúdos</span><b>Para aprovar</b></div></div></div>
            <div className="floating-card floating-approve"><span>Conteúdo aprovado</span><strong>✓</strong></div><div className="floating-card floating-signal"><small>Sinal da semana</small><strong>Autoridade ↑</strong></div>
          </div>
        </section>

        <section className="diagnostic-section" id="diagnostico">
          {result && <div className="container diagnostic-ready"><div><span>✓</span><div><strong>Seu diagnóstico está pronto.</strong><p>O resultado continua salvo nesta sessão.</p></div></div><button type="button" className="button button-small button-primary" onClick={revealResult}>Ver diagnóstico</button></div>}
          <div className="container diagnostic-grid">
            <div className="diagnostic-intro"><div className="section-kicker">MODO SCAN</div><h2>Veja o que sua marca deveria fazer e publicar <strong>antes de contratar.</strong></h2><p>Informe seu site. A MODO identifica o contexto e prepara oportunidades de autoridade, demanda, relacionamento e presença profissional.</p><ul className="check-list"><li>Leitura inicial de posicionamento</li><li>Diagnóstico de oportunidade</li><li>Campanhas para Instagram, Facebook e LinkedIn</li><li>Sugestões de vídeos, histórias e bastidores</li></ul></div>
            <form className="diagnostic-form" onSubmit={handleDiagnostic}>
              <label>Site da marca<input type="text" inputMode="url" placeholder="www.suamarca.com.br" value={websiteUrl} onChange={(event) => setWebsiteUrl(event.target.value)} required /></label>
              <label>Instagram <span>(opcional)</span><input type="text" placeholder="@suamarca" value={instagramHandle} onChange={(event) => setInstagramHandle(event.target.value)} /></label>
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
          {!leadCaptured ? <form className="lead-capture" onSubmit={handleLead}><div><small>RECEBA O PLANO COMPLETO</small><h3>Encontramos mais duas direções para sua marca.</h3></div><input placeholder="Seu nome" value={name} onChange={(event) => setName(event.target.value)} required /><input placeholder="WhatsApp ou e-mail" value={contact} onChange={(event) => setContact(event.target.value)} required /><button className="button button-primary" disabled={leadLoading}>{leadLoading ? "Liberando..." : "Liberar plano"}</button><small className="consent-copy">Ao continuar, você aceita receber contato sobre a MODO.</small></form> : <div className="lead-success"><span>✓</span><div><strong>Plano liberado.</strong><p>Agora você pode revisar todas as campanhas sugeridas.</p></div><button className="button button-primary" onClick={() => activatePlan("presenca")}>Ativar minha presença</button></div>}
        </div></section>}

        <section className="how-section container" id="como-funciona">
          <div className="section-heading centered"><div className="section-kicker">COMO FUNCIONA</div><h2>Uma diretoria de criação para quem <strong>não sabe por onde começar.</strong></h2><p>A MODO entrega opções, explica as escolhas e transforma a realidade da empresa em um plano executável.</p></div>
          <div className="steps-grid">{[
            ["01", "Conhece", "Organiza contexto, produtos, público, voz, provas, pessoas e objetivos da empresa."],
            ["02", "Decide", "Escolhe os temas, formatos, campanhas e canais com maior potencial."],
            ["03", "Cria", "Produz posts, carrosséis, stories, documentos e roteiros prontos para revisão."],
            ["04", "Dirige", "Explica quem deve aparecer, o que falar, como gravar e quais cenas registrar."],
            ["05", "Aprende", "Usa aprovações, revisões, leads e desempenho para melhorar o próximo ciclo."],
          ].map(([number, title, copy]) => <article className="step" key={number}><span>{number}</span><h3>{title}</h3><p>{copy}</p></article>)}</div>
        </section>

        <section className="business-potential-section">
          <div className="container">
            <div className="business-potential-heading"><div className="section-kicker">O QUE A MODO ENTREGA</div><h2>Mais do que peças visuais. Uma operação criativa que continua acontecendo.</h2><p>A empresa recebe conteúdo pronto, mas também direção para gerar histórias, provas, rostos e matéria-prima real — o que torna a presença menos genérica e mais difícil de copiar.</p></div>
            <div className="business-potential-grid">
              <article><span>01</span><h3>Conteúdo que a MODO cria</h3><p>Posts, carrosséis, stories, documentos, legendas, roteiros e adaptações.</p></article>
              <article><span>02</span><h3>Conteúdo que a MODO dirige</h3><p>Vídeo com fundador, bastidores, demonstrações, entrevistas, histórias e depoimentos.</p></article>
              <article><span>03</span><h3>Planos e campanhas</h3><p>Sequências coordenadas de conteúdo para autoridade, relacionamento, oferta e geração de demanda.</p></article>
              <article><span>04</span><h3>Inteligência que aprende</h3><p>Aceites, revisões, publicações, leads e resultados alimentam as próximas recomendações.</p></article>
            </div>
          </div>
        </section>

        <section className="linkedin-public-section" id="linkedin">
          <div className="container linkedin-public-grid">
            <div className="linkedin-public-copy">
              <div className="section-kicker">MODO LINKEDIN</div>
              <h2>Transforme conhecimento profissional em <strong>autoridade e oportunidades.</strong></h2>
              <p>A MODO cria uma presença específica para LinkedIn — não apenas reaproveita uma legenda do Instagram. Ela organiza pontos de vista, histórias profissionais, cases, documentos em PDF, marca empregadora e conteúdo para founders e empresas B2B.</p>
              <div className="linkedin-benefits">
                <article><strong>Perfil profissional</strong><span>Conteúdo para founders, especialistas, executivos e consultores.</span></article>
                <article><strong>Página da empresa</strong><span>Autoridade institucional, cultura, cases, soluções e recrutamento.</span></article>
                <article><strong>Documentos em PDF</strong><span>Estruturas educativas e visuais prontas para publicação.</span></article>
                <article><strong>Planejamento contínuo</strong><span>Séries editoriais, calendário, aprovação e aprendizado.</span></article>
              </div>
              <a className="button button-primary" href="/app/onboarding">Configurar minha presença no LinkedIn</a>
            </div>
            <aside className="linkedin-public-card">
              <small>EXEMPLO DE FLUXO</small>
              <h3>A MODO transforma uma experiência da empresa em uma campanha profissional.</h3>
              <div className="linkedin-flow">
                <div><span>01</span><p>Identifica uma história, resultado ou ponto de vista relevante.</p></div>
                <div><span>02</span><p>Propõe três ângulos e escolhe o mais adequado ao objetivo.</p></div>
                <div><span>03</span><p>Cria post, documento, abertura, CTA e direção visual.</p></div>
                <div><span>04</span><p>A empresa revisa, aprova, publica e registra o desempenho.</p></div>
                <div><span>05</span><p>O resultado influencia o próximo plano de autoridade.</p></div>
              </div>
              <p className="linkedin-public-note">A publicação direta depende das permissões oficiais do LinkedIn. A criação, aprovação, cópia e geração de documentos funcionam desde o primeiro acesso.</p>
            </aside>
          </div>
        </section>

        <section className="platform-section" id="plataforma"><div className="container platform-grid"><div><div className="section-kicker light">MODO OPERATING SYSTEM</div><h2>Uma operação contínua para toda a presença da empresa.</h2><p>O diagnóstico é só o começo. A MODO reúne memória, direção criativa, planejamento, produção, vídeos com participação humana, LinkedIn, aprovação, distribuição e aprendizado em um único fluxo.</p><a className="button button-light" href="/app/onboarding">Conhecer a MODO por dentro</a></div><div className="module-list">{moduleItems.map(([moduleName, description], index) => <div key={moduleName}><span>{String(index + 1).padStart(2, "0")}</span><strong>MODO {moduleName}</strong><p>{description}</p><i>↗</i></div>)}</div></div></section>

        <section className="pricing-section" id="plano"><div className="container"><div className="pricing-heading"><div className="section-kicker">PLANOS MODO</div><h2>Capacidade clara para cada <strong>ritmo de presença.</strong></h2><p>Você sabe exatamente quantos conteúdos, marcas, canais e revisões estão incluídos. Sem promessa ilimitada escondendo custo ou perda de qualidade.</p></div><div className="pricing-grid">{pricingPlans.map((plan) => <article className={plan.featured ? "pricing-card featured" : "pricing-card"} key={plan.slug}>{plan.featured && <div className="pricing-badge">MAIS ESCOLHIDO</div>}<div className="pricing-card-head"><h3>{plan.name}</h3><p>{plan.audience}</p></div><div className="pricing-price">{plan.pricePrefix && <small>{plan.pricePrefix}</small>}<div><span>R$</span><strong>{plan.price}</strong><b>/mês</b></div></div><p className="pricing-description">{plan.description}</p><ul className="pricing-limits">{plan.limits.map((limit) => <li key={limit}>{limit}</li>)}</ul><button className={plan.featured ? "button button-primary button-full" : "button button-outline button-full"} onClick={() => activatePlan(plan.slug)}>{plan.cta} ↗</button></article>)}</div><div className="credit-rules"><div><strong>Como os créditos funcionam</strong><p>Post estático ou story: 1 crédito. Carrossel de até 7 páginas: 2 créditos. Roteiro de vídeo curto: 2 créditos.</p></div><div><strong>Canais e adaptações</strong><p>Instagram, Facebook, LinkedIn e outros canais podem compartilhar uma estratégia. Uma adaptação específica de formato ou texto consome 1 crédito.</p></div><div><strong>Revisões e excedentes</strong><p>Revisões além do limite e capacidade adicional serão contratadas por pacotes, sem transformar o plano em uso ilimitado.</p></div></div></div></section>

        <section className="final-cta"><div className="container"><div><div className="section-kicker light">MODO ON</div><h2>Sua empresa não precisa chegar com criatividade pronta.</h2><p>A MODO ajuda a descobrir, decidir, produzir e aprender.</p></div><a className="button button-green" href="/app/onboarding">Começar com orientação</a></div></section>
      </main>

      <footer className="footer container">
        <Logo />
        <p>Agência inteligente de presença digital.</p>
        <div><a href="#top">Início</a><a href="#diagnostico">Diagnóstico</a><a href="#linkedin">LinkedIn</a><a href="#plano">Planos</a></div>
        <div className="footer-company"><strong>Uma solução da Alternative Ventures</strong><span>CNPJ 61.920.356/0001-38</span><span>© {new Date().getFullYear()} MODO. Todos os direitos reservados.</span></div>
      </footer>
    </div>
  );
}
