import { nicheLabels, type DiagnosticJob, type Niche } from "@modo/contracts";
import { type FormEvent, useEffect, useState } from "react";
import { createDiagnostic, getDiagnostic } from "./api";

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
  extracting: "Lendo produtos, serviços e posicionamento...",
  structuring: "Encontrando o ponto com maior potencial...",
  generating: "Preparando uma direção e uma campanha...",
  completed: "Diagnóstico pronto.",
  failed: "Não foi possível concluir.",
};

type PricingPlan = {
  slug: "start" | "presenca" | "pro";
  name: string;
  price: string;
  audience: string;
  description: string;
  limits: string[];
  cta: string;
  featured?: boolean;
};

const pricingPlans: PricingPlan[] = [
  { slug: "start", name: "MODO Começar", price: "49", audience: "Para sair da tela em branco.", description: "Direção, criação e uma rotina simples para começar a divulgar seu trabalho.", limits: ["4 créditos por mês", "1 marca e até 2 canais", "Posts, stories e 1 carrossel", "1 Reel curto com MODO Video", "Studio e exportação", "1 ciclo de revisão"], cta: "Começar por R$ 49" },
  { slug: "presenca", name: "MODO Presença", price: "99", audience: "Para publicar toda semana.", description: "O plano principal para transformar divulgação em uma rotina que cabe na agenda.", limits: ["10 créditos por mês", "1 marca e até 3 canais", "Posts, carrosséis e roteiros", "Minha Semana e agendamento", "2 Reels curtos com First Cut", "2 ciclos de revisão", "Signal e aprendizado"], cta: "Ativar MODO Presença", featured: true },
  { slug: "pro", name: "MODO Crescer", price: "199", audience: "Para quem já vende e quer avançar.", description: "Mais campanhas, formatos e capacidade para gerar demanda com consistência.", limits: ["24 créditos por mês", "Até 2 marcas e 4 canais", "Campanhas coordenadas", "Mais carrosséis e até 5 Reels", "Agenda e publicação", "3 ciclos de revisão", "Insights orientados a resultado"], cta: "Escolher MODO Crescer" },
];

const startingPoints = [
  ["Vendo serviços", "A MODO transforma conhecimento, casos e dúvidas em autoridade, campanhas e oportunidades."],
  ["Vendo produtos", "A MODO organiza oferta, conteúdo, benefícios, provas e caminhos para gerar demanda."],
  ["Quero conseguir mais clientes", "A MODO conecta conteúdo, campanhas, páginas e leads em um fluxo de crescimento."],
  ["Não sei como começar", "A MODO escolhe o primeiro movimento e entrega opções prontas para você aprovar."],
];

const valuePillars = [
  ["01", "Entende o negócio", "Analisa sua marca, oferta, objetivo e contexto para definir onde começar — sem exigir prompts de marketing."],
  ["02", "Cria e publica", "Produz posts, carrosséis, stories, roteiros, vídeos curtos e peças para os canais certos."],
  ["03", "Gera demanda", "Estrutura campanhas, público, mensagem, landing page e tracking para transformar atenção em oportunidade."],
  ["04", "Ajuda a prospectar", "Organiza campanhas de prospecção, encontra leads e prepara abordagens para revisão antes do contato."],
  ["05", "Organiza a operação", "Mostra o que aprovar, publicar, acompanhar e melhorar, com próximos passos claros."],
  ["06", "Aprende com resultado", "Usa desempenho, leads, conversões e feedback para melhorar o próximo ciclo de crescimento."],
];

const sourceOptions = ["Um link", "Um tema", "Um texto", "Uma transcrição", "Uma ideia por voz", "Nada — preciso de ideias"];
const Logo = () => <img className="logo" src="/logo.svg" alt="MODO" />;

export default function App() {
  const [websiteUrl, setWebsiteUrl] = useState("");
  const [instagramHandle, setInstagramHandle] = useState("");
  const [niche, setNiche] = useState<Niche>("servicos_profissionais");
  const [job, setJob] = useState<DiagnosticJob | null>(null);
  const [error, setError] = useState("");
  const result = job?.result;

  useEffect(() => {
    try {
      const cached = window.sessionStorage.getItem(DIAGNOSTIC_CACHE_KEY);
      if (!cached) return;
      const restored = JSON.parse(cached) as DiagnosticJob;
      if (restored.status === "completed" && restored.result) setJob(restored);
    } catch { window.sessionStorage.removeItem(DIAGNOSTIC_CACHE_KEY); }
  }, []);

  function revealResult() { window.setTimeout(() => document.getElementById("modo-impact-result-root")?.scrollIntoView({ behavior: "smooth", block: "start" }), 220); }

  async function handleDiagnostic(event: FormEvent) {
    event.preventDefault(); setError(""); window.sessionStorage.removeItem(DIAGNOSTIC_CACHE_KEY);
    setJob({ id: "temporary", status: "processing", progress: 3, stage: "queued", createdAt: new Date().toISOString() });
    try {
      const normalizedUrl = /^https?:\/\//i.test(websiteUrl) ? websiteUrl : `https://${websiteUrl}`;
      const created = await createDiagnostic({ websiteUrl: normalizedUrl, niche, instagramHandle });
      for (let attempt = 0; attempt < 70; attempt += 1) {
        const current = await getDiagnostic(created.id); setJob(current);
        if (current.status === "completed") {
          if (!current.result) throw new Error("A análise terminou sem um resultado utilizável. Tente novamente.");
          window.sessionStorage.setItem(DIAGNOSTIC_CACHE_KEY, JSON.stringify(current)); revealResult(); return;
        }
        if (current.status === "failed") throw new Error(current.error || "Não foi possível concluir o diagnóstico.");
        await new Promise((resolve) => setTimeout(resolve, 900));
      }
      throw new Error("A análise está levando mais tempo que o esperado. Tente novamente em instantes.");
    } catch (caught) { setJob(null); setError(caught instanceof Error ? caught.message : "Não foi possível gerar o diagnóstico."); }
  }

  function activatePlan(planSlug: PricingPlan["slug"] = "presenca") { window.sessionStorage.setItem("modo.selectedPlan", planSlug); window.location.href = "/app"; }

  return (
    <div className="site-shell fishing-landing">
      <header className="header container fishing-header">
        <a href="#top"><Logo /></a>
        <nav className="nav"><a href="#como-funciona">Como funciona</a><a href="#entregas">O que a MODO faz</a><a href="#crescimento">Crescimento</a><a href="#teste">Teste grátis</a><a href="#planos">Planos</a></nav>
        <div className="header-actions"><a className="header-login" href="/app">Entrar</a><a className="button button-small button-primary" href="/app">Começar grátis</a></div>
      </header>

      <main id="top">
        <section className="fishing-hero container">
          <div className="fishing-hero-copy">
            <div className="eyebrow"><span /> Marketing e crescimento, do plano ao cliente</div>
            <h1>Você cuida do seu negócio. <strong>A MODO ajuda a fazer ele crescer.</strong></h1>
            <p>Uma operação de marketing com IA que entende sua marca, cria conteúdo, estrutura campanhas, ajuda a prospectar, organiza páginas e leads e aprende com os resultados — sem obrigar você a virar especialista em marketing.</p>
            <div className="hero-actions"><a className="button button-primary" href="/app">Testar grátis por 7 dias <span>↗</span></a><a className="text-link" href="#diagnostico">Analisar minha marca primeiro ↓</a></div>
            <div className="hero-proof"><span>Sem cartão</span><span>3 créditos incluídos</span><span>Você aprova antes de publicar</span></div>
          </div>
          <div className="fishing-transformation" aria-label="Exemplo do fluxo MODO">
            <div className="fishing-input-card"><small>VOCÊ CONTA</small><strong>“Tenho R$ 1.500 e quero conseguir mais clientes.”</strong></div>
            <div className="fishing-arrow">↓</div>
            <div className="fishing-output-card"><div><span>ESTRATÉGIA</span><strong>Público + oferta + canais</strong><small>Direção preparada</small></div><div><span>EXECUÇÃO</span><strong>Conteúdo + campanha + landing</strong><small>Prontos para revisar</small></div><div><span>RESULTADO</span><strong>Leads + conversões + aprendizado</strong><small>Próximo ciclo mais inteligente</small></div></div>
            <p>Você não recebe um painel vazio. Recebe o próximo passo para gerar demanda.</p>
          </div>
        </section>

        <section className="fishing-audience container">
          <div className="fishing-section-heading"><div className="section-kicker">DA PRESENÇA AO CRESCIMENTO</div><h2>Uma operação prática entre <strong>fazer tudo sozinho</strong> e montar um time inteiro de marketing.</h2></div>
          <div className="fishing-audience-grid">{startingPoints.map(([title, copy]) => <article key={title}><h3>{title}</h3><p>{copy}</p><a href="#diagnostico">Ver meu ponto de partida →</a></article>)}</div>
        </section>

        <section className="diagnostic-section fishing-diagnostic" id="diagnostico">
          {result && <div className="container diagnostic-ready"><div><span>✓</span><div><strong>Seu diagnóstico está pronto.</strong><p>Encontramos um ponto específico e uma campanha inicial.</p></div></div><button type="button" className="button button-small button-primary" onClick={revealResult}>Ver resultado</button></div>}
          <div className="container diagnostic-grid">
            <div className="diagnostic-intro"><div className="section-kicker">MODO SCAN</div><h2>Descubra onde sua marca pode <strong>gerar mais demanda.</strong></h2><p>Informe seu site. A MODO lê a página, identifica uma oportunidade concreta e propõe um primeiro movimento antes de pedir qualquer contato.</p><ul className="check-list"><li>Leitura real do conteúdo público</li><li>Descoberta e consequência comercial</li><li>Primeiro movimento recomendado</li><li>Uma campanha inicial liberada</li></ul></div>
            <form className="diagnostic-form" onSubmit={handleDiagnostic}>
              <label>Site, loja ou página profissional<input type="text" inputMode="url" placeholder="www.seunegocio.com.br" value={websiteUrl} onChange={(event) => setWebsiteUrl(event.target.value)} required /></label>
              <label>Instagram <span>(opcional)</span><input type="text" placeholder="@seuperfil" value={instagramHandle} onChange={(event) => setInstagramHandle(event.target.value)} /></label>
              <fieldset><legend>O que você quer divulgar?</legend><div className="niche-grid">{(Object.keys(nicheLabels) as Niche[]).map((key) => <button className={niche === key ? "niche active" : "niche"} type="button" key={key} onClick={() => setNiche(key)}><span>{nicheIcons[key]}</span>{nicheLabels[key]}</button>)}</div></fieldset>
              <button className="button button-primary button-full" disabled={job?.status === "processing"}>{job?.status === "processing" ? "Lendo sua marca..." : result ? "Analisar novamente" : "Encontrar minha oportunidade"} <span>↗</span></button>
              <small className="form-note">Grátis. Nenhuma publicação ou investimento em mídia é feito sem sua aprovação.</small>{error && <div className="form-error"><strong>Não conseguimos exibir a análise.</strong><span>{error}</span></div>}
            </form>
          </div>
        </section>

        {job?.status === "processing" && <section className="processing container"><div className="processing-card"><div className="scan-animation"><span /><span /><span /></div><div><div className="section-kicker">ANÁLISE EM ANDAMENTO</div><h2>{stageCopy[job.stage]}</h2><p>A MODO está procurando uma descoberta específica — não uma frase que serviria para qualquer empresa.</p><div className="large-progress"><span style={{ width: `${job.progress}%` }} /></div><small>{job.progress}% concluído</small></div></div></section>}

        <section className="how-section fishing-how container" id="como-funciona">
          <div className="fishing-section-heading centered"><div className="section-kicker">DO NEGÓCIO AO APRENDIZADO</div><h2>Um ciclo contínuo. <strong>Sem montar o quebra-cabeça sozinho.</strong></h2></div>
          <div className="fishing-flow-grid"><article><span>01</span><h3>Conte o objetivo</h3><p>A MODO entende negócio, oferta, público e o resultado que você quer buscar.</p></article><article><span>02</span><h3>A MODO planeja e cria</h3><p>Define canais, conteúdo, campanha, abordagem e página conforme o objetivo.</p></article><article><span>03</span><h3>Você revisa e aprova</h3><p>Conexões oficiais e guardrails mantêm contas, orçamento e decisões sob seu controle.</p></article><article><span>04</span><h3>A MODO aprende</h3><p>Leads, conversões e desempenho alimentam o próximo ciclo de marketing.</p></article></div>
        </section>

        <section className="fishing-deliveries" id="entregas"><div className="container"><div className="fishing-section-heading"><div className="section-kicker">UMA OPERAÇÃO, NÃO UMA CAIXA DE FERRAMENTAS</div><h2>A MODO conecta <strong>criação, demanda e aprendizado.</strong></h2><p>Os módulos trabalham por trás. Você enxerga decisões, entregas, aprovações e próximos passos.</p></div><div className="fishing-value-grid">{valuePillars.map(([number, title, copy]) => <article key={number}><span>{number}</span><div><h3>{title}</h3><p>{copy}</p></div></article>)}</div></div></section>

        <section className="fishing-sources container"><div><div className="section-kicker">COMECE COM O QUE JÁ TEM</div><h2>Qualquer matéria-prima pode virar <strong>uma ação de crescimento.</strong></h2><p>A MODO organiza o que está solto e transforma em conteúdo, campanha, página ou abordagem.</p></div><div className="fishing-source-grid">{sourceOptions.map((option) => <div key={option}><span>+</span><strong>{option}</strong></div>)}</div></section>

        <section className="fishing-channels" id="crescimento"><div className="container fishing-channels-grid"><div><div className="section-kicker light">CADA CANAL COM UMA FUNÇÃO</div><h2>Conteúdo para atrair. Prospecção para abrir portas. <strong>Campanhas para gerar demanda.</strong></h2><p>A MODO coordena mensagem e objetivo entre canais. Onde há integração oficial e autorização, conecta a operação; onde não há, prepara a execução para revisão.</p><div className="fishing-channel-tags"><span>Instagram</span><span>Facebook</span><span>LinkedIn</span><span>WhatsApp</span><span>Google Ads</span><span>Meta Ads</span><span>Landing Pages</span><span>Prospecção</span></div></div><aside><small>O CICLO MODO</small><h3>Da atenção ao aprendizado:</h3><ul><li>Atrair com conteúdo e campanhas</li><li>Identificar e organizar oportunidades</li><li>Prospectar com abordagem preparada</li><li>Converter em landing pages e conversas</li><li>Medir leads, conversões e desempenho</li><li>Aprender e melhorar o próximo ciclo</li></ul><a className="button button-green" href="/app">Começar meu ciclo de crescimento</a></aside></div></section>

        <section className="fishing-trial container" id="teste"><div className="fishing-trial-copy"><div className="section-kicker">DESAFIO MODO</div><h2>Sete dias para transformar intenção em movimento.</h2><p>O teste é guiado. Você explica o que vende e o que quer alcançar; a MODO mostra um caminho prático para começar — sem uma plataforma vazia para explorar sozinho.</p><div className="fishing-trial-badges"><span>7 dias</span><span>3 créditos</span><span>1 marca</span><span>Sem cartão</span><span>Sem marca-d’água</span></div><a className="button button-primary" href="/app">Começar meu teste grátis ↗</a></div><div className="fishing-trial-plan"><strong>O que dá para fazer no teste</strong><div><span>Diagnóstico</span><p>Entender uma oportunidade real da sua marca</p></div><div><span>Criação</span><p>Produzir suas primeiras peças e campanha</p></div><div><span>Incluído</span><p>Onboarding, direção, revisão e próximos passos</p></div></div></section>

        <section className="pricing-section fishing-pricing" id="planos"><div className="container"><div className="pricing-heading"><div className="section-kicker">DEPOIS DO TESTE</div><h2>Escolha o ritmo — não um pacote de ferramentas.</h2><p>Comece pequeno e avance quando marketing começar a gerar rotina, conversas e oportunidades.</p></div><div className="pricing-grid fishing-pricing-grid">{pricingPlans.map((plan) => <article className={plan.featured ? "pricing-card featured" : "pricing-card"} key={plan.slug}>{plan.featured && <div className="pricing-badge">MAIS ESCOLHIDO</div>}<div className="pricing-card-head"><h3>{plan.name}</h3><p>{plan.audience}</p></div><div className="pricing-price"><div><span>R$</span><strong>{plan.price}</strong><b>/mês</b></div></div><p className="pricing-description">{plan.description}</p><ul className="pricing-limits">{plan.limits.map((limit) => <li key={limit}>{limit}</li>)}</ul><button className={plan.featured ? "button button-primary button-full" : "button button-outline button-full"} onClick={() => activatePlan(plan.slug)}>{plan.cta} ↗</button></article>)}</div><p className="fishing-business-note">Precisa operar várias marcas, unidades ou usuários? O MODO Business continua disponível sob consulta, sem desviar a experiência de quem está começando.</p></div></section>

        <section className="fishing-faq container"><div className="fishing-section-heading"><div className="section-kicker">DÚVIDAS DE QUEM ESTÁ COMEÇANDO</div><h2>Você não precisa chegar pronto.</h2></div><div className="fishing-faq-grid"><details><summary>A MODO é só para criar posts?</summary><p>Não. Conteúdo é uma parte do ciclo. A MODO também estrutura demanda, campanhas, páginas, prospecção, leads e aprendizado conforme o objetivo.</p></details><details><summary>Preciso saber marketing ou tráfego pago?</summary><p>Não. A MODO traduz a operação em decisões e próximos passos claros. Contas e orçamento continuam sob seu controle.</p></details><details><summary>A MODO publica ou investe automaticamente?</summary><p>Não sem autorização. Publicação e mídia usam integrações oficiais quando disponíveis, com revisão, permissões e guardrails antes de ações externas.</p></details><details><summary>Posso usar para LinkedIn?</summary><p>Sim. A MODO cria conteúdo profissional e também pode apoiar campanhas de prospecção e autoridade.</p></details><details><summary>O teste exige cartão?</summary><p>Não. São sete dias e três créditos para experimentar uma entrega utilizável.</p></details><details><summary>A MODO aprende com meu negócio?</summary><p>Sim. Contexto, revisões, leads, conversões e desempenho ajudam a melhorar os próximos ciclos.</p></details></div></section>

        <section className="final-cta fishing-final-cta"><div className="container"><div><div className="section-kicker light">MARKETING QUE SAI DO PLANO</div><h2>Da primeira ideia ao próximo cliente, a MODO organiza o caminho.</h2><p>Comece gratuitamente e receba seu primeiro próximo passo.</p></div><a className="button button-green" href="/app">Começar grátis por 7 dias</a></div></section>
      </main>

      <footer className="footer container fishing-footer"><Logo /><p>Marketing e crescimento com IA para transformar direção em execução e aprendizado.</p><div><a href="#diagnostico">Diagnóstico</a><a href="#entregas">O que a MODO faz</a><a href="#teste">Teste grátis</a><a href="#planos">Planos</a></div><div className="footer-company"><strong>Uma solução da Alternative Ventures</strong><span>CNPJ 61.920.356/0001-38</span><span>© {new Date().getFullYear()} MODO. Todos os direitos reservados.</span></div></footer>
    </div>
  );
}
