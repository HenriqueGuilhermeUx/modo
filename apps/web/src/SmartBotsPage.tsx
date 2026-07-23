import { getSessionToken } from "./api";

const benefits = [
  ["01", "Mini site com bot", "Uma página simples para apresentar o negócio, responder dúvidas iniciais e orientar o visitante."],
  ["02", "Captação de leads", "Nome, contato e interesse ficam organizados para a empresa não depender de anotações soltas."],
  ["03", "CRM simples", "Os contatos entram em uma visão prática para acompanhar quem chegou, o que procura e qual é o próximo passo."],
  ["04", "Sugestão de ações", "O SmartBots Assistido ajuda a lembrar retornos, organizar prioridades e indicar como continuar a conversa."],
  ["05", "Mensagens prontas", "A plataforma prepara respostas e abordagens para o WhatsApp. O envio continua manual e sob controle do cliente."],
];

function startActivation() {
  if (getSessionToken()) {
    window.location.href = "/onboarding-smartbots.html";
    return;
  }
  window.sessionStorage.setItem("modo.selectedPlan", "presenca");
  window.sessionStorage.setItem("modo.smartbotsActivation", "true");
  window.location.href = "/app";
}

export default function SmartBotsPage() {
  return (
    <div className="smartbots-public">
      <header className="smartbots-public-header">
        <a href="/"><img src="/logo.svg" alt="MODO" /></a>
        <nav><a href="#como-funciona">Como funciona</a><a href="#recursos">O que inclui</a><a href="#faq">FAQ</a><a href="/app">Entrar</a></nav>
        <button className="button button-primary" onClick={startActivation}>Ativar SmartBots Assistido</button>
      </header>

      <main>
        <section className="smartbots-hero">
          <div>
            <span className="smartbots-kicker">INCLUÍDO NO MODO PRESENÇA</span>
            <h1>Marketing para atrair. <strong>Organização para não perder os leads.</strong></h1>
            <p>A MODO cria presença, campanhas e conteúdo. O SmartBots Assistido acrescenta um mini site com bot, captação de contatos, CRM simples, sugestões de ações e mensagens prontas para continuar a conversa.</p>
            <div className="smartbots-hero-actions">
              <button className="button button-primary" onClick={startActivation}>Ativar SmartBots Assistido ↗</button>
              <a href="#como-funciona">Entender em 2 minutos ↓</a>
            </div>
            <div className="smartbots-trust"><span>Incluído a partir do Presença</span><span>Implantação assistida</span><span>WhatsApp sob seu controle</span></div>
          </div>
          <aside>
            <div className="smartbots-flow-card"><small>A MODO ATRAI</small><strong>Post, campanha, carrossel, vídeo e CTA</strong></div>
            <div className="smartbots-flow-arrow">↓</div>
            <div className="smartbots-flow-card accent"><small>SMARTBOTS RECEBE</small><strong>Mini site + bot + formulário de interesse</strong></div>
            <div className="smartbots-flow-arrow">↓</div>
            <div className="smartbots-flow-card"><small>VOCÊ CONTINUA</small><strong>Contato organizado + mensagem pronta para enviar</strong></div>
          </aside>
        </section>

        <section className="smartbots-positioning">
          <div><small>O PROBLEMA</small><h2>Conseguir atenção não basta quando os contatos se perdem.</h2></div>
          <p>Pequenos negócios costumam receber mensagens pelo Instagram, WhatsApp e indicações, mas não têm processo para registrar, responder e acompanhar cada oportunidade. O SmartBots Assistido cria uma ponte simples entre divulgação e organização comercial.</p>
        </section>

        <section className="smartbots-benefits" id="recursos">
          <div className="smartbots-heading"><small>O QUE O CLIENTE RECEBE</small><h2>Uma estrutura comercial simples, sem transformar o negócio em uma operação complicada.</h2></div>
          <div className="smartbots-benefit-grid">
            {benefits.map(([number, title, copy]) => <article key={number}><span>{number}</span><div><h3>{title}</h3><p>{copy}</p></div></article>)}
          </div>
        </section>

        <section className="smartbots-how" id="como-funciona">
          <div className="smartbots-heading"><small>IMPLANTAÇÃO ASSISTIDA</small><h2>Você explica o negócio. A equipe configura a estrutura.</h2></div>
          <div className="smartbots-steps">
            <article><span>01</span><h3>Ative no MODO Presença</h3><p>Clientes do plano Presença acessam o formulário de implantação dentro da MODO.</p></article>
            <article><span>02</span><h3>Conte como o negócio funciona</h3><p>Serviços, horários, preços, perguntas frequentes, mensagem inicial e avaliações.</p></article>
            <article><span>03</span><h3>A SmartBots é configurada</h3><p>A equipe transforma o briefing em mini site, bot e organização inicial de contatos.</p></article>
            <article><span>04</span><h3>Comece a captar e acompanhar</h3><p>Os leads ficam organizados e você recebe sugestões e mensagens prontas para continuar.</p></article>
          </div>
        </section>

        <section className="smartbots-whatsapp-warning">
          <div><small>WHATSAPP ASSISTIDO</small><h2>A plataforma prepara. Você revisa e envia.</h2></div>
          <p>O SmartBots Assistido não dispara mensagens automaticamente nem opera o WhatsApp sem autorização. Ele sugere textos e próximos passos; o cliente mantém o controle do envio e do relacionamento.</p>
        </section>

        <section className="smartbots-audience">
          <div className="smartbots-heading"><small>PARA QUEM FAZ SENTIDO</small><h2>Negócios que precisam divulgar e também organizar as oportunidades geradas.</h2></div>
          <div><span>Pequenos negócios</span><span>Profissionais liberais</span><span>Criadores de conteúdo</span><span>Empresas locais</span><span>Consultores</span><span>Prestadores de serviço</span></div>
        </section>

        <section className="smartbots-faq" id="faq">
          <div className="smartbots-heading"><small>PERGUNTAS FREQUENTES</small><h2>O SmartBots Assistido em linguagem simples.</h2></div>
          <div>
            <details><summary>Está incluído em qual plano?</summary><p>O benefício começa no MODO Presença. Os planos Crescer e Business também mantêm acesso.</p></details>
            <details><summary>O SmartBots envia mensagens sozinho?</summary><p>Não. Ele prepara mensagens e sugere ações, mas o envio pelo WhatsApp continua manual pelo cliente.</p></details>
            <details><summary>Preciso construir o mini site?</summary><p>Não. Você fornece os dados no onboarding e a implantação é feita de forma assistida.</p></details>
            <details><summary>É um CRM complexo?</summary><p>Não. A proposta é uma organização comercial simples para pequenos negócios não perderem contatos e próximos passos.</p></details>
            <details><summary>Posso alterar informações depois?</summary><p>Sim. O briefing pode ser atualizado e a equipe acompanha os ajustes necessários na implantação.</p></details>
            <details><summary>Preciso integrar APIs agora?</summary><p>Não. A primeira versão funciona por implantação assistida. A integração direta entre MODO e SmartBots poderá ser ativada depois.</p></details>
          </div>
        </section>

        <section className="smartbots-final">
          <div><small>MODO PRESENÇA + SMARTBOTS ASSISTIDO</small><h2>Atraia melhor. Organize os contatos. Continue cada conversa.</h2><p>Ative o benefício e envie os dados do seu negócio para implantação.</p></div>
          <button className="button button-green" onClick={startActivation}>Ativar SmartBots Assistido</button>
        </section>
      </main>

      <footer className="smartbots-footer"><img src="/logo.svg" alt="MODO" /><p>Marketing + captação + organização comercial.</p><span>Uma solução da Alternative Ventures · CNPJ 61.920.356/0001-38</span></footer>
    </div>
  );
}
