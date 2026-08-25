const agencyPlans = [
  {
    slug: "professional",
    name: "Professional",
    price: "199",
    audience: "Para social medias e publicitários independentes.",
    clients: "Até 5 clientes",
    features: ["1 cérebro de marketing por cliente", "Criação com contexto e memória", "Instagram, Facebook e LinkedIn", "Calendário e publicação", "Aprovação organizada", "Uso individual"],
  },
  {
    slug: "studio",
    name: "Studio",
    price: "499",
    audience: "Para microagências e operações enxutas.",
    clients: "Até 15 clientes",
    featured: true,
    features: ["Tudo do Professional", "Até 15 clientes ativos", "Clientes separados por workspace", "Portal externo de aprovação", "Performance por marca", "Gestão central da operação"],
  },
  {
    slug: "agency",
    name: "Agency",
    price: "999",
    audience: "Para operações com carteira ativa e escala.",
    clients: "Até 40 clientes",
    features: ["Tudo do Studio", "Até 40 clientes ativos", "Operação multi-cliente", "Gestão de conexões sociais", "Visão executiva por carteira", "Prioridade de suporte"],
  },
  {
    slug: "agency-pro",
    name: "Agency Pro",
    price: "Sob consulta",
    audience: "Para estruturas maiores que precisam de implantação assistida.",
    clients: "40+ clientes",
    features: ["Capacidade acima de 40 clientes", "Implantação assistida", "Configuração da operação", "Condições comerciais personalizadas", "Prioridade de implantação", "Escopo definido em proposta"],
  },
];

const capabilities = [
  ["01", "Um cérebro por cliente", "Posicionamento, público, oferta, tom, restrições, histórico, feedback e performance ficam separados e persistentes para cada conta."],
  ["02", "Direção antes da criação", "A MODO ajuda a decidir o que vale comunicar, em qual canal, com qual objetivo e formato — antes de gerar mais uma peça."],
  ["03", "Sua ideia entra no motor", "O criativo pode partir de um insight próprio, campanha, referência, briefing, texto, link, voz ou rascunho. A MODO amplia, não substitui."],
  ["04", "Produção multicanal", "Posts, carrosséis, stories, roteiros, peças e adaptações específicas para Instagram, Facebook e LinkedIn."],
  ["05", "Aprovação sem caos", "Organize revisão, aprovação e histórico sem depender de mensagens soltas e versões perdidas em conversas."],
  ["06", "Publique e agende", "Conecte as contas dos clientes, escolha a conta correta e publique agora ou agende pela Central de Publicação."],
  ["07", "Aprenda por conta", "Performance e feedback alimentam o próximo ciclo para que cada cliente fique mais consistente com o tempo."],
  ["08", "Escala sem perder identidade", "Mais clientes não precisam significar mais conteúdo genérico. Cada marca mantém sua própria memória e lógica criativa."],
];

const workflow = [
  ["1", "Cadastre o cliente", "Crie a marca, registre contexto, posicionamento, oferta e objetivos."],
  ["2", "Conecte os canais", "Instagram, Facebook e LinkedIn ficam vinculados ao cliente certo."],
  ["3", "Crie com liberdade", "Use ideias próprias ou peça direção à MODO. Edite tudo antes de entregar."],
  ["4", "Aprove", "Centralize revisão e aprovação do que realmente vai ao ar."],
  ["5", "Publique", "Envie agora ou agende para a conta escolhida."],
  ["6", "Aprenda", "Use resultado, feedback e histórico para melhorar o próximo movimento."],
];

function Logo() {
  return <img className="agency-logo" src="/logo.svg" alt="MODO" />;
}

function startAgency(plan = "studio") {
  window.sessionStorage.setItem("modo.accountMode", "agency");
  window.sessionStorage.setItem("modo.agency.selectedPlan", plan);
  window.location.href = `/app?mode=agency&plan=${encodeURIComponent(plan)}`;
}

export default function AgencyLanding() {
  return (
    <div className="agency-site">
      <header className="agency-header agency-container">
        <a className="agency-brand" href="/agency"><Logo /><span>AGENCY</span></a>
        <nav className="agency-nav">
          <a href="#como-funciona">Como funciona</a>
          <a href="#recursos">Recursos</a>
          <a href="#planos">Planos</a>
        </nav>
        <div className="agency-header-actions">
          <a className="agency-back-link" href="/">MODO para empresas</a>
          <button className="agency-button agency-button-small" type="button" onClick={() => startAgency("studio")}>Entrar na MODO Agency</button>
        </div>
      </header>

      <main>
        <section className="agency-hero agency-container">
          <div className="agency-hero-copy">
            <div className="agency-eyebrow"><span /> PARA AGÊNCIAS, SOCIAL MEDIAS E PUBLICITÁRIOS</div>
            <h1>Um cérebro de marketing <strong>para cada cliente da sua agência.</strong></h1>
            <p>Centralize estratégia, memória, criação, aprovação, publicação e aprendizado em um único fluxo. Sua equipe mantém a criatividade. A MODO organiza, acelera e dá contexto para a operação inteira.</p>
            <div className="agency-hero-actions">
              <button className="agency-button" type="button" onClick={() => startAgency("studio")}>Quero operar meus clientes na MODO <span>↗</span></button>
              <a className="agency-text-link" href="#como-funciona">Ver como funciona ↓</a>
            </div>
            <div className="agency-proof-row"><span>Multi-cliente</span><span>Multi-marca</span><span>Publicação nativa</span><span>Memória por conta</span></div>
          </div>

          <div className="agency-hero-board" aria-label="Exemplo de operação MODO Agency">
            <div className="agency-board-top"><span>MODO AGENCY</span><small>OPERAÇÃO DE HOJE</small></div>
            <div className="agency-client-card active"><div><strong>Clínica Aurora</strong><small>Instagram · Facebook</small></div><span>3 aprovações</span></div>
            <div className="agency-client-card"><div><strong>Construtora Alfa</strong><small>Instagram · LinkedIn</small></div><span>2 agendados</span></div>
            <div className="agency-client-card"><div><strong>Escritório Nexo</strong><small>LinkedIn</small></div><span>Direção pronta</span></div>
            <div className="agency-board-insight"><small>MODO LEARNING</small><strong>Cases + bastidores estão performando melhor para a Clínica Aurora.</strong><p>Próxima recomendação: transformar o case aprovado em carrossel e Reel.</p></div>
          </div>
        </section>

        <section className="agency-positioning">
          <div className="agency-container agency-positioning-grid">
            <div><div className="agency-section-kicker">NÃO É MAIS UMA IA DE POSTS</div><h2>A infraestrutura criativa da sua operação.</h2></div>
            <p>Ferramentas isoladas ajudam em uma etapa. A MODO conecta o raciocínio inteiro: entende cada cliente, recebe suas ideias, cria, revisa, distribui e usa o resultado para melhorar o que vem depois.</p>
          </div>
        </section>

        <section className="agency-workflow agency-container" id="como-funciona">
          <div className="agency-section-heading"><div className="agency-section-kicker">DO BRIEFING AO RESULTADO</div><h2>Uma linha de produção que <strong>preserva a criatividade.</strong></h2><p>O publicitário continua no comando. A MODO reduz o trabalho repetitivo e mantém o contexto de cada conta vivo.</p></div>
          <div className="agency-workflow-grid">{workflow.map(([number, title, copy]) => <article key={number}><span>{number}</span><h3>{title}</h3><p>{copy}</p></article>)}</div>
        </section>

        <section className="agency-compare">
          <div className="agency-container agency-compare-grid">
            <div><div className="agency-section-kicker light">ANTES</div><h2>ChatGPT + Canva + planilha + WhatsApp + scheduler + memória do atendimento.</h2></div>
            <div className="agency-arrow">→</div>
            <div><div className="agency-section-kicker light">COM MODO AGENCY</div><h2>Cliente, estratégia, criação, aprovação, publicação e aprendizado no mesmo contexto.</h2></div>
          </div>
        </section>

        <section className="agency-capabilities agency-container" id="recursos">
          <div className="agency-section-heading"><div className="agency-section-kicker">O QUE MUDA NA PRÁTICA</div><h2>Atenda mais contas sem transformar sua agência em <strong>fábrica de conteúdo genérico.</strong></h2></div>
          <div className="agency-capabilities-grid">{capabilities.map(([number, title, copy]) => <article key={number}><span>{number}</span><div><h3>{title}</h3><p>{copy}</p></div></article>)}</div>
        </section>

        <section className="agency-human">
          <div className="agency-container agency-human-grid">
            <div><div className="agency-section-kicker">CRIATIVIDADE HUMANA + MOTOR MODO</div><h2>Sua ideia entra. A MODO amplia.</h2><p>Você pode chegar com uma campanha pronta na cabeça, uma frase, uma referência ou um insight de reunião. A MODO cruza isso com o contexto real do cliente e devolve caminhos, formatos, adaptações e peças para você selecionar e editar.</p></div>
            <div className="agency-prompt-flow"><div><small>SUA IDEIA</small><strong>“Quero aproveitar a final do campeonato para fazer uma ação local.”</strong></div><span>+</span><div><small>CONTEXTO DO CLIENTE</small><strong>Oferta · Público · Tom · Histórico · Canal · Restrições</strong></div><span>↓</span><div className="result"><small>MODO</small><strong>Campanha, variações, roteiro, copy e distribuição por canal.</strong></div></div>
          </div>
        </section>

        <section className="agency-client-experience agency-container">
          <div className="agency-section-heading"><div className="agency-section-kicker">SEU CLIENTE NÃO PRECISA VER A COMPLEXIDADE</div><h2>Ele entra para <strong>acompanhar, solicitar ajustes e aprovar.</strong></h2></div>
          <div className="agency-approval-card"><div className="agency-approval-top"><div><small>CLÍNICA AURORA</small><strong>3 conteúdos aguardando aprovação</strong></div><span>Portal do cliente</span></div><div className="agency-approval-item"><div><b>Carrossel</b><strong>5 sinais de que sua pele precisa de avaliação</strong></div><div><button type="button">Solicitar ajuste</button><button type="button" className="approve">Aprovar</button></div></div><div className="agency-approval-item"><div><b>Reel</b><strong>Bastidor: como funciona a primeira consulta</strong></div><div><button type="button">Solicitar ajuste</button><button type="button" className="approve">Aprovar</button></div></div></div>
        </section>

        <section className="agency-pricing" id="planos">
          <div className="agency-container">
            <div className="agency-section-heading centered"><div className="agency-section-kicker">MENSALIDADE QUE ACOMPANHA SUA CARTEIRA</div><h2>Você cobra seus clientes. <strong>A MODO dá escala para a operação.</strong></h2><p>Planos pensados para o tamanho da carteira — não para punir quem publica mais.</p></div>
            <div className="agency-pricing-grid">{agencyPlans.map((plan) => <article className={plan.featured ? "agency-plan featured" : "agency-plan"} key={plan.slug}>{plan.featured && <div className="agency-plan-badge">RECOMENDADO</div>}<div className="agency-plan-head"><h3>MODO {plan.name}</h3><p>{plan.audience}</p></div><strong className="agency-plan-clients">{plan.clients}</strong><div className="agency-plan-price">{plan.price === "Sob consulta" ? <strong>Sob consulta</strong> : <><span>R$</span><strong>{plan.price}</strong><b>/mês</b></>}</div><ul>{plan.features.map((feature) => <li key={feature}>{feature}</li>)}</ul><button className={plan.featured ? "agency-button agency-button-full" : "agency-button agency-button-outline agency-button-full"} type="button" onClick={() => startAgency(plan.slug)}>{plan.price === "Sob consulta" ? "Falar sobre Agency Pro" : `Começar no ${plan.name}`} <span>↗</span></button></article>)}</div>
            <p className="agency-pricing-note">Valores iniciais de lançamento. Agency Pro tem contratação assistida e escopo definido comercialmente; recursos adicionais só são prometidos quando estiverem disponíveis e contratados.</p>
          </div>
        </section>

        <section className="agency-roi agency-container">
          <div className="agency-roi-copy"><div className="agency-section-kicker">A CONTA PRECISA FECHAR PARA A AGÊNCIA</div><h2>Se a MODO economizar horas por cliente, ela já se paga.</h2><p>O ganho maior aparece quando a mesma equipe consegue atender mais contas com consistência sem perder repertório, histórico e qualidade.</p></div>
          <div className="agency-roi-card"><small>EXEMPLO OPERACIONAL</small><div><span>20 clientes × R$ 1.500</span><strong>R$ 30.000/mês</strong></div><div><span>MODO Agency</span><strong>R$ 999/mês</strong></div><div className="agency-roi-highlight"><span>Custo de software por cliente</span><strong>R$ 49,95</strong></div></div>
        </section>

        <section className="agency-final">
          <div className="agency-container agency-final-grid"><div><div className="agency-section-kicker light">SUA CRIATIVIDADE, MULTIPLICADA</div><h2>Transforme a MODO no coração operacional da sua agência.</h2><p>Um cliente por vez. Um cérebro por marca. Uma operação cada vez melhor.</p></div><button className="agency-button agency-button-light" type="button" onClick={() => startAgency("studio")}>Começar com MODO Agency <span>↗</span></button></div>
        </section>
      </main>

      <footer className="agency-footer agency-container">
        <a className="agency-brand" href="/agency"><Logo /><span>AGENCY</span></a>
        <p>Infraestrutura criativa e operacional para agências, social medias e publicitários independentes.</p>
        <div><a href="#como-funciona">Como funciona</a><a href="#recursos">Recursos</a><a href="#planos">Planos</a><a href="/">MODO para empresas</a></div>
        <small>© {new Date().getFullYear()} MODO · Alternative Ventures</small>
      </footer>
    </div>
  );
}
