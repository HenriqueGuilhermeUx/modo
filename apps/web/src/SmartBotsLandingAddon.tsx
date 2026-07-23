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
      <style>{`.smartbots-landing-bridge{padding:100px 0;background:#0d1b3e;color:#fff}.smartbots-landing-bridge>.container{display:grid;grid-template-columns:1.1fr .9fr;gap:60px;align-items:center}.smartbots-landing-bridge span{font-size:10px;letter-spacing:.13em;font-weight:900;color:#2ed19a}.smartbots-landing-bridge h2{font:800 clamp(42px,5vw,68px)/1.04 Sora,sans-serif;letter-spacing:-.055em;margin:14px 0 20px}.smartbots-landing-bridge h2 strong{color:#2ed19a}.smartbots-landing-bridge p{color:#b7c3dc;line-height:1.7}.smartbots-bridge-tags{display:flex;flex-wrap:wrap;gap:8px;margin-top:25px}.smartbots-bridge-tags small{border:1px solid rgba(255,255,255,.16);border-radius:999px;padding:9px 13px;color:#dce5f7}.smartbots-landing-bridge aside{background:#fff;color:#0d1b3e;border-radius:25px;padding:28px}.smartbots-landing-bridge aside>strong{font:800 28px/1.2 Sora,sans-serif}.smartbots-landing-bridge aside p{color:#5b657a;font-size:13px}.smartbots-plan-addon{margin-top:14px;border:1px solid #bfead9;border-radius:16px;padding:16px;background:#effbf6;display:grid;gap:5px;text-align:left}.smartbots-plan-addon>span{font-size:8px;letter-spacing:.12em;font-weight:900;color:#087655}.smartbots-plan-addon>strong{font:800 17px Sora,sans-serif;color:#0d1b3e}.smartbots-plan-addon>p{font-size:11px;color:#5b657a;margin:0 0 6px}.smartbots-plan-addon>button{border:0;border-radius:11px;padding:11px 13px;background:#0d1b3e;color:#fff;font-weight:800;cursor:pointer}.smartbots-faq-addon{display:contents}@media(max-width:900px){.smartbots-landing-bridge>.container{grid-template-columns:1fr}}@media(max-width:640px){.smartbots-landing-bridge{padding:70px 0}.smartbots-landing-bridge h2{font-size:42px}}`}</style>
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
