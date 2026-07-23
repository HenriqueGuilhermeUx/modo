import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

function activatePresence() {
  window.sessionStorage.setItem("modo.selectedPlan", "presenca");
  window.sessionStorage.setItem("modo.smartbotsActivation", "true");
  window.location.href = "/app";
}

export default function SmartBotsLandingAddon() {
  const [sectionTarget, setSectionTarget] = useState<HTMLElement | null>(null);
  const [planTarget, setPlanTarget] = useState<HTMLElement | null>(null);
  const [faqTarget, setFaqTarget] = useState<HTMLElement | null>(null);

  useEffect(() => {
    const sectionRoot = document.createElement("div");
    sectionRoot.id = "modo-smartbots-landing-root";
    const trial = document.getElementById("teste");
    trial?.parentElement?.insertBefore(sectionRoot, trial);

    const featuredPlan = document.querySelector<HTMLElement>(".pricing-card.featured");
    const planRoot = document.createElement("div");
    planRoot.id = "modo-smartbots-plan-root";
    featuredPlan?.appendChild(planRoot);

    const faqGrid = document.querySelector<HTMLElement>(".fishing-faq-grid");
    const faqRoot = document.createElement("div");
    faqRoot.id = "modo-smartbots-faq-root";
    faqRoot.className = "smartbots-faq-addon";
    faqGrid?.appendChild(faqRoot);

    setSectionTarget(sectionRoot.isConnected ? sectionRoot : null);
    setPlanTarget(planRoot.isConnected ? planRoot : null);
    setFaqTarget(faqRoot.isConnected ? faqRoot : null);

    return () => {
      sectionRoot.remove();
      planRoot.remove();
      faqRoot.remove();
    };
  }, []);

  return (
    <>
      {sectionTarget && createPortal(
        <section className="smartbots-landing-bridge">
          <div className="container">
            <div>
              <span>INCLUÍDO NO MODO PRESENÇA</span>
              <h2>Crie demanda com a MODO. <strong>Organize os leads com o SmartBots Assistido.</strong></h2>
              <p>Mini site com bot, captação de contatos, CRM simples, sugestões de ações e mensagens prontas para WhatsApp. O cliente revisa e envia manualmente.</p>
              <div className="smartbots-bridge-tags"><small>Mini site + bot</small><small>Captação de leads</small><small>CRM simples</small><small>WhatsApp Assistido</small></div>
            </div>
            <aside>
              <strong>Marketing + captação + organização comercial</strong>
              <p>Uma ponte prática para pequenos negócios não perderem as oportunidades geradas pelos conteúdos.</p>
              <a className="button button-green" href="/smartbots.html">Conhecer SmartBots Assistido</a>
            </aside>
          </div>
        </section>,
        sectionTarget,
      )}

      {planTarget && createPortal(
        <div className="smartbots-plan-addon">
          <span>INCLUÍDO</span>
          <strong>SmartBots Assistido</strong>
          <p>Mini site com bot + leads + CRM simples + mensagens prontas.</p>
          <button type="button" onClick={activatePresence}>Ativar SmartBots Assistido</button>
        </div>,
        planTarget,
      )}

      {faqTarget && createPortal(
        <>
          <details><summary>O que é o SmartBots Assistido?</summary><p>É o benefício do MODO Presença que acrescenta mini site com bot, captação de leads, CRM simples, sugestões de ações e mensagens prontas.</p></details>
          <details><summary>O SmartBots envia WhatsApp automaticamente?</summary><p>Não. Ele prepara mensagens e próximos passos, mas o cliente revisa e faz o envio manual pelo próprio WhatsApp.</p></details>
        </>,
        faqTarget,
      )}
    </>
  );
}
