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
  {
    slug: "start",
    name: "MODO Começar",
    price: "49",
    audience: "Para sair da tela em branco.",
    description: "Direção, criação e uma rotina simples para começar a divulgar seu trabalho.",
    limits: ["4 créditos por mês", "1 marca e até 2 canais", "Posts, stories e 1 carrossel", "1 roteiro de vídeo curto", "Studio e exportação", "1 ciclo de revisão"],
    cta: "Começar por R$ 49",
  },
  {
    slug: "presenca",
    name: "MODO Presença",
    price: "99",
    audience: "Para publicar toda semana.",
    description: "O plano principal para transformar divulgação em uma rotina que cabe na agenda.",
    limits: ["10 créditos por mês", "1 marca e até 3 canais", "Posts, carrosséis e roteiros", "Minha Semana e agendamento", "Direção para vídeos com rosto", "2 ciclos de revisão", "Signal e aprendizado"],
    cta: "Ativar MODO Presença",
    featured: true,
  },
  {
    slug: "pro",
    name: "MODO Crescer",
    price: "199",
    audience: "Para quem já vende e quer avançar.",
    description: "Mais campanhas, formatos e capacidade para gerar demanda com consistência.",
    limits: ["24 créditos por mês", "Até 2 marcas e 4 canais", "Campanhas coordenadas", "Mais carrosséis e roteiros", "Agenda e publicação", "3 ciclos de revisão", "Insights orientados a resultado"],
    cta: "Escolher MODO Crescer",
  },
];

const startingPoints = [
  ["Vendo serviços", "A MODO transforma conhecimento, casos e dúvidas em autoridade e oportunidades."],
  ["Vendo produtos", "A MODO organiza oferta, demonstração, benefícios, provas e chamadas para compra."],
  ["Quero divulgar meu trabalho", "A MODO ajuda a construir reputação sem obrigar você a virar influenciador."],
  ["Não sei como começar", "A MODO escolhe o primeiro movimento e entrega opções prontas para aprovar."],
];

const valuePillars = [
  ["01", "Diz o que publicar", "Analisa a marca, escolhe objetivos, temas, formatos e canais. Você não precisa escrever prompts."],
  ["02", "Cria texto e design", "Entrega posts, carrosséis, stories, documentos para LinkedIn, legendas, roteiros e arquivos para publicar."],
  ["03", "Dirige vídeos e histórias", "Explica quem aparece, o que falar, como enquadrar, quais cenas gravar e oferece uma alternativa sem rosto."],
  ["04", "Organiza sua semana", "Mostra o que aprovar, gravar, publicar e medir, com tempo estimado e próximo passo claro."],
  ["05", "Aprende o que funciona", "Usa revisões, conversas, leads, vendas e desempenho para melhorar o próximo plano."],
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
    } catch {
      window.sessionStorage.removeItem(DIAGNOSTIC_CACHE_KEY);
    }
  }, []);

  function revealResult() {
    window.setTimeout(() => {
      document.getElementById("modo-impact-result-root")?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 220);
  }

  async function handleDiagnostic(event: FormEvent) {
    event.preventDefault();
    setError("");
    window.sessionStorage.removeItem(DIAGNOSTIC_CACHE_KEY);
    setJob({ id: "temporary", status: "processing", progress: 3, stage: "queued", createdAt: new Date().toISOString() });

    try {
      const normalizedUrl = /^https?:\/\//i.test(websiteUrl) ? websiteUrl : `https://${websiteUrl}`;
      const created = await createDiagnostic({ websiteUrl: normalizedUrl, niche, instagramHandle });

      for (let attempt = 0; attempt < 70; attempt += 1) {
        const current = await getDiagnostic(created.id);
        setJob(current);
        if (current.status === "completed") {
          if (!current.result) throw new Error("A análise terminou sem um resultado utilizável. Tente novamente.");
          window.sessionStorage.setItem(DIAGNOSTIC_CACHE_KEY, JSON.stringify(current));
          revealResult();
          return;
        }
        if (current.status === "failed") throw new Error(current.error || "Não foi possível concluir o diagnóstico.");
        await new Promise((resolve) => setTimeout(resolve, 900));
      }
      throw new Error("A análise está levando mais tempo que o esperado. Tente novamente em instantes.");
    } catch (caught) {
      setJob(null);
      setError(caught instanceof Error ? caught.message : "Não foi possível gerar o diagnóstico.");
    }
  }

  function activatePlan(planSlug: PricingPlan["slug"] = "presenca") {
    window.sessionStorage.setItem("modo.selectedPlan", planSlug);
    window.location.href = "/app";
  }

  return (
    <div className="site-shell fishing-landing">
      <header className="header container fishing-header">
        <a href="#top"><Logo /></a>
        <nav className="nav">
          <a href="#como-funciona">Como funciona</a>
          <a href="#entregas">O que você recebe</a>
          <a href="#linkedin">LinkedIn</a>
          <a href="#teste">Teste grátis</a>
          <a href="#planos">Planos</a>
        </nav>
        <div className="header-actions">
          <a className="header-login" href="/app">Entrar</a>
          <a className="button button-small button-primary" href="/app">Começar grátis</a>
        </div>
      </header>

      <main id="top">
        <section className="fishing-hero container">
          <div className="fishing-hero-copy">
            <div className="eyebrow"><span /> Direção, criação e rotina para vender nas redes</div>
            <h1>Você sabe o que vende. <strong>A MODO mostra o que publicar.</strong></h1>
            <p>Conte o que você faz. A MODO decide os melhores conteúdos, cria o texto e o design, orienta vídeos, organiza sua semana e aprende com os resultados.</p>
            <div className="hero-actions">
              <a className="button button-primary" href="/app">Testar grátis por 7 dias <span>↗</span></a>
              <a className="text-link" href="#diagnostico">Analisar minha marca primeiro ↓</a>
            </div>
            <div className="hero-proof">
              <span>Sem cartão</span><span>3 créditos incluídos</span><span>Sem precisar saber marketing</span>
            </div>
          </div>

          <div className="fishing-transformation" aria-label="Exemplo do fluxo MODO">
            <div className="fishing-input-card"><small>VOCÊ CONTA</small><strong>“Vendo consultoria, mas não sei como me divulgar.”</strong></div>
            <div className="fishing-arrow">↓</div>
            <div className="fishing-output-card">
              <div><span>HOJE</span><strong>Post de autoridade</strong><small>Pronto para aprovar</small></div>
              <div><span>AMANHÃ</span><strong>Vídeo de 45 segundos</strong><small>Roteiro + direção</small></div>
              <div><span>SEXTA</span><strong>Oferta para WhatsApp</strong><small>CTA pronto</small></div>
            </div>
            <p>Você não recebe um painel vazio. Recebe o próximo passo.</p>
          </div>
        </section>

        <section className="fishing-audience container">
          <div className="fishing-section-heading">
            <div className="section-kicker">PARA QUEM PRECISA COMEÇAR</div>
            <h2>Uma ajuda prática entre <strong>fazer tudo sozinho</strong> e contratar uma agência.</h2>
          </div>
          <div className="fishing-audience-grid">
            {startingPoints.map(([title, copy]) => <article key={title}><h3>{title}</h3><p>{copy}</p><a href="#diagnostico">Ver meu ponto de partida →</a></article>)}
          </div>
        </section>

        <section className="diagnostic-section fishing-diagnostic" id="diagnostico">
          {result && <div className="container diagnostic-ready"><div><span>✓</span><div><strong>Seu diagnóstico está pronto.</strong><p>Encontramos um ponto específico e uma campanha inicial.</p></div></div><button type="button" className="button button-small button-primary" onClick={revealResult}>Ver resultado</button></div>}
          <div className="container diagnostic-grid">
            <div className="diagnostic-intro">
              <div className="section-kicker">MODO SCAN</div>
              <h2>Veja o que pode estar fazendo as pessoas <strong>passarem pela sua marca.</strong></h2>
              <p>Informe seu site. A MODO lê a página, encontra uma oportunidade concreta e abre uma campanha antes de pedir qualquer contato.</p>
              <ul className="check-list"><li>Leitura real do conteúdo público</li><li>Descoberta e consequência comercial</li><li>Primeiro movimento recomendado</li><li>Uma campanha completa liberada</li></ul>
            </div>
            <form className="diagnostic-form" onSubmit={handleDiagnostic}>
              <label>Site, loja ou página profissional<input type="text" inputMode="url" placeholder="www.seunegocio.com.br" value={websiteUrl} onChange={(event) => setWebsiteUrl(event.target.value)} required /></label>
              <label>Instagram <span>(opcional)</span><input type="text" placeholder="@seuperfil" value={instagramHandle} onChange={(event) => setInstagramHandle(event.target.value)} /></label>
              <fieldset><legend>O que você quer divulgar?</legend><div className="niche-grid">{(Object.keys(nicheLabels) as Niche[]).map((key) => <button className={niche === key ? "niche active" : "niche"} type="button" key={key} onClick={() => setNiche(key)}><span>{nicheIcons[key]}</span>{nicheLabels[key]}</button>)}</div></fieldset>
              <button className="button button-primary button-full" disabled={job?.status === "processing"}>{job?.status === "processing" ? "Lendo sua marca..." : result ? "Analisar novamente" : "Encontrar minha oportunidade"} <span>↗</span></button>
              <small className="form-note">Grátis. Nenhuma publicação é feita sem sua aprovação.</small>
              {error && <div className="form-error"><strong>Não conseguimos exibir a análise.</strong><span>{error}</span></div>}
            </form>
          </div>
        </section>

        {job?.status === "processing" && <section className="processing container"><div className="processing-card"><div className="scan-animation"><span /><span /><span /></div><div><div className="section-kicker">ANÁLISE EM ANDAMENTO</div><h2>{stageCopy[job.stage]}</h2><p>A MODO está procurando uma descoberta específica — não uma frase que serviria para qualquer empresa.</p><div className="large-progress"><span style={{ width: `${job.progress}%` }} /></div><small>{job.progress}% concluído</small></div></div></section>}

        <section className="how-section fishing-how container" id="como-funciona">
          <div className="fishing-section-heading centered">
            <div className="section-kicker">DO “NÃO SEI” AO “ESTÁ PUBLICADO”</div>
            <h2>Quatro passos. <strong>Nenhuma tela em branco.</strong></h2>
          </div>
          <div className="fishing-flow-grid">
            <article><span>01</span><h3>Conte o que vende</h3><p>Use um link, tema, texto, transcrição, voz ou diga que precisa de ideias.</p></article>
            <article><span>02</span><h3>A MODO decide</h3><p>Escolhe o objetivo, o canal, o formato e o melhor ângulo para começar.</p></article>
            <article><span>03</span><h3>Revise e publique</h3><p>Receba texto, design, CTA, roteiro e arquivos prontos para usar.</p></article>
            <article><span>04</span><h3>Repita melhor</h3><p>A agenda organiza a próxima semana e os resultados refinam o plano.</p></article>
          </div>
        </section>

        <section className="fishing-deliveries" id="entregas">
          <div className="container">
            <div className="fishing-section-heading">
              <div className="section-kicker">TUDO O QUE VOCÊ PRECISA — SEM PARECER COMPLICADO</div>
              <h2>A MODO atua como seu <strong>Diretor de Criação particular.</strong></h2>
              <p>Os módulos trabalham por trás. Você enxerga decisões, conteúdos e tarefas claras.</p>
            </div>
            <div className="fishing-value-grid">{valuePillars.map(([number, title, copy]) => <article key={number}><span>{number}</span><div><h3>{title}</h3><p>{copy}</p></div></article>)}</div>
          </div>
        </section>

        <section className="fishing-sources container">
          <div>
            <div className="section-kicker">COMECE COM O QUE JÁ TEM</div>
            <h2>Qualquer matéria-prima pode virar <strong>conteúdo útil.</strong></h2>
            <p>A MODO organiza o que está solto e transforma em uma peça, uma semana ou uma campanha.</p>
          </div>
          <div className="fishing-source-grid">{sourceOptions.map((option) => <div key={option}><span>+</span><strong>{option}</strong></div>)}</div>
        </section>

        <section className="fishing-channels" id="linkedin">
          <div className="container fishing-channels-grid">
            <div>
              <div className="section-kicker light">CADA REDE COM UMA FUNÇÃO</div>
              <h2>Instagram para mostrar. WhatsApp para conversar. <strong>LinkedIn para construir autoridade.</strong></h2>
              <p>A MODO não copia a mesma legenda em todo lugar. Ela adapta mensagem, formato e chamada para o comportamento de cada canal.</p>
              <div className="fishing-channel-tags"><span>Instagram</span><span>Facebook</span><span>LinkedIn</span><span>WhatsApp</span><span>Reels</span><span>Stories</span><span>TikTok</span><span>E-mail</span></div>
            </div>
            <aside>
              <small>EXEMPLO: UMA HISTÓRIA REAL</small>
              <h3>Uma experiência do seu trabalho pode gerar:</h3>
              <ul><li>1 post profissional para LinkedIn</li><li>1 carrossel educativo para Instagram</li><li>1 roteiro de vídeo com rosto</li><li>3 stories e uma chamada para WhatsApp</li></ul>
              <a className="button button-green" href="/app">Criar minha primeira campanha</a>
            </aside>
          </div>
        </section>

        <section className="fishing-trial container" id="teste">
          <div className="fishing-trial-copy">
            <div className="section-kicker">DESAFIO MODO</div>
            <h2>Sete dias para parar de adiar sua presença.</h2>
            <p>O teste é guiado. Você entra, explica o que vende e recebe um caminho para produzir e publicar — não uma plataforma vazia para explorar sozinho.</p>
            <div className="fishing-trial-badges"><span>7 dias</span><span>3 créditos</span><span>1 marca</span><span>Sem cartão</span><span>Sem marca-d’água</span></div>
            <a className="button button-primary" href="/app">Começar meu teste grátis ↗</a>
          </div>
          <div className="fishing-trial-plan">
            <strong>O que dá para criar no teste</strong>
            <div><span>Opção A</span><p>1 post + 1 carrossel</p></div>
            <div><span>Opção B</span><p>3 posts ou stories</p></div>
            <div><span>Incluído</span><p>Diagnóstico, onboarding, plano semanal, revisão e exportação</p></div>
          </div>
        </section>

        <section className="pricing-section fishing-pricing" id="planos">
          <div className="container">
            <div className="pricing-heading"><div className="section-kicker">DEPOIS DO TESTE</div><h2>Escolha o ritmo — não um pacote de ferramentas.</h2><p>Comece pequeno e avance quando a presença começar a gerar rotina, conversas e oportunidades.</p></div>
            <div className="pricing-grid fishing-pricing-grid">{pricingPlans.map((plan) => <article className={plan.featured ? "pricing-card featured" : "pricing-card"} key={plan.slug}>{plan.featured && <div className="pricing-badge">MAIS ESCOLHIDO</div>}<div className="pricing-card-head"><h3>{plan.name}</h3><p>{plan.audience}</p></div><div className="pricing-price"><div><span>R$</span><strong>{plan.price}</strong><b>/mês</b></div></div><p className="pricing-description">{plan.description}</p><ul className="pricing-limits">{plan.limits.map((limit) => <li key={limit}>{limit}</li>)}</ul><button className={plan.featured ? "button button-primary button-full" : "button button-outline button-full"} onClick={() => activatePlan(plan.slug)}>{plan.cta} ↗</button></article>)}</div>
            <p className="fishing-business-note">Precisa operar várias marcas, unidades ou usuários? O MODO Business continua disponível sob consulta, sem desviar a experiência de quem está começando.</p>
          </div>
        </section>

        <section className="fishing-faq container">
          <div className="fishing-section-heading"><div className="section-kicker">DÚVIDAS DE QUEM ESTÁ COMEÇANDO</div><h2>Você não precisa chegar pronto.</h2></div>
          <div className="fishing-faq-grid">
            <details><summary>Preciso saber fazer design?</summary><p>Não. A MODO cria a estrutura visual e permite editar e exportar dentro do Studio.</p></details>
            <details><summary>Preciso aparecer em vídeo?</summary><p>Não. A MODO oferece alternativas sem rosto. Quando vídeo fizer sentido, você recebe roteiro e direção simples.</p></details>
            <details><summary>A MODO publica automaticamente?</summary><p>Ela organiza e agenda onde as integrações oficiais estão disponíveis. Nos demais canais, entrega tudo pronto para publicar com poucos cliques.</p></details>
            <details><summary>Posso usar para LinkedIn?</summary><p>Sim. A MODO cria posts, documentos, cases e séries específicas para profissionais e empresas.</p></details>
            <details><summary>O teste exige cartão?</summary><p>Não. São sete dias e três créditos para experimentar uma entrega utilizável.</p></details>
            <details><summary>O conteúdo fica genérico?</summary><p>A MODO usa o contexto, as provas, as preferências e os resultados da sua marca para aprender a cada ciclo.</p></details>
          </div>
        </section>

        <section className="final-cta fishing-final-cta"><div className="container"><div><div className="section-kicker light">SEU TRABALHO MERECE SER PERCEBIDO</div><h2>Você cuida do que sabe fazer. A MODO ajuda as pessoas a enxergarem esse valor.</h2><p>Comece gratuitamente e receba seu primeiro próximo passo.</p></div><a className="button button-green" href="/app">Começar grátis por 7 dias</a></div></section>
      </main>

      <footer className="footer container fishing-footer">
        <Logo />
        <p>Direção, criação e rotina para quem precisa divulgar o próprio trabalho.</p>
        <div><a href="#diagnostico">Diagnóstico</a><a href="#entregas">O que você recebe</a><a href="#teste">Teste grátis</a><a href="#planos">Planos</a></div>
        <div className="footer-company"><strong>Uma solução da Alternative Ventures</strong><span>CNPJ 61.920.356/0001-38</span><span>© {new Date().getFullYear()} MODO. Todos os direitos reservados.</span></div>
      </footer>
    </div>
  );
}
