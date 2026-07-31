import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

const capabilities = [
  {
    number: "01",
    title: "Encontra oportunidades",
    copy: "Mapeia empresas, regiões, demandas e sinais comerciais compatíveis com o objetivo do negócio.",
  },
  {
    number: "02",
    title: "Acompanha o mercado",
    copy: "Observa concorrentes, reputação, ofertas e preços quando essas informações são públicas ou autorizadas.",
  },
  {
    number: "03",
    title: "Transforma dados em ação",
    copy: "Em vez de entregar planilhas soltas, prioriza alertas, campanhas, abordagens e próximos movimentos.",
  },
];

export default function IntelligenceLandingAddon() {
  const [sectionTarget, setSectionTarget] = useState<HTMLElement | null>(null);

  useEffect(() => {
    const sectionRoot = document.createElement("div");
    sectionRoot.id = "modo-intelligence-landing-root";
    const sources = document.querySelector<HTMLElement>(".fishing-sources");
    sources?.parentElement?.insertBefore(sectionRoot, sources);
    setSectionTarget(sectionRoot.isConnected ? sectionRoot : null);

    const navigation = document.querySelector<HTMLElement>(".fishing-header .nav");
    const testLink = navigation?.querySelector<HTMLAnchorElement>('a[href="#teste"]');
    const intelligenceLink = document.createElement("a");
    intelligenceLink.href = "#inteligencia";
    intelligenceLink.textContent = "Inteligência";
    if (navigation && !navigation.querySelector('a[href="#inteligencia"]')) {
      navigation.insertBefore(intelligenceLink, testLink || null);
    }

    return () => {
      sectionRoot.remove();
      intelligenceLink.remove();
    };
  }, []);

  return (
    <>
      <style>{`.modo-intelligence-landing{padding:105px 0;background:#eef3ff;color:#0d1b3e;overflow:hidden}.modo-intelligence-landing .container{position:relative}.modo-intelligence-orbit{position:absolute;width:480px;height:480px;border:1px solid rgba(31,94,255,.13);border-radius:50%;right:-210px;top:-210px}.modo-intelligence-orbit:before,.modo-intelligence-orbit:after{content:"";position:absolute;border:1px solid rgba(31,94,255,.1);border-radius:50%;inset:60px}.modo-intelligence-orbit:after{inset:130px}.modo-intelligence-heading{display:grid;grid-template-columns:1.05fr .95fr;gap:55px;align-items:end;position:relative}.modo-intelligence-kicker{font-size:10px;letter-spacing:.14em;font-weight:900;color:#1f5eff}.modo-intelligence-heading h2{font:800 clamp(42px,5.1vw,70px)/1.02 Sora,sans-serif;letter-spacing:-.06em;margin:14px 0 0;max-width:840px}.modo-intelligence-heading h2 strong{color:#1f5eff}.modo-intelligence-heading>div:last-child{background:#0d1b3e;color:#fff;border-radius:24px;padding:26px}.modo-intelligence-heading>div:last-child small{color:#2ed19a;font-size:9px;letter-spacing:.12em;font-weight:900}.modo-intelligence-heading>div:last-child p{color:#c7d1e6;line-height:1.65;margin:10px 0 18px}.modo-intelligence-flow{display:grid;grid-template-columns:repeat(4,1fr);gap:6px}.modo-intelligence-flow span{background:rgba(255,255,255,.08);border-radius:10px;padding:10px 8px;text-align:center;font-size:10px;font-weight:800}.modo-intelligence-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:14px;margin-top:42px;position:relative}.modo-intelligence-grid article{background:#fff;border:1px solid #dce5f7;border-radius:22px;padding:26px;min-height:220px;display:flex;flex-direction:column}.modo-intelligence-grid article>span{font:800 13px Sora,sans-serif;color:#1f5eff}.modo-intelligence-grid h3{font:800 25px/1.15 Sora,sans-serif;letter-spacing:-.035em;margin:36px 0 10px}.modo-intelligence-grid p{color:#5b657a;line-height:1.65;margin:0}.modo-intelligence-bottom{display:flex;justify-content:space-between;align-items:center;gap:30px;margin-top:28px;position:relative}.modo-intelligence-bottom p{max-width:760px;color:#5b657a;line-height:1.6;margin:0}.modo-intelligence-bottom small{display:block;margin-top:6px;color:#7a8498}.modo-intelligence-bottom .button{white-space:nowrap}.modo-intelligence-compare{margin-top:12px;padding:12px 14px;border-left:3px solid #1f5eff;background:rgba(255,255,255,.55);border-radius:0 10px 10px 0;color:#53637d;font-size:11px;line-height:1.55}.modo-intelligence-compare strong{color:#0d1b3e}@media(max-width:900px){.modo-intelligence-heading{grid-template-columns:1fr}.modo-intelligence-grid{grid-template-columns:1fr}.modo-intelligence-bottom{align-items:flex-start;flex-direction:column}.modo-intelligence-orbit{display:none}}@media(max-width:640px){.modo-intelligence-landing{padding:75px 0}.modo-intelligence-heading h2{font-size:42px}.modo-intelligence-flow{grid-template-columns:1fr 1fr}}`}</style>
      {sectionTarget && createPortal(
        <section className="modo-intelligence-landing" id="inteligencia">
          <div className="container">
            <div className="modo-intelligence-orbit" aria-hidden="true" />
            <div className="modo-intelligence-heading">
              <div>
                <div className="modo-intelligence-kicker">PUBLICIDADE 3.0, SEM COMPLICAÇÃO</div>
                <h2>A MODO não olha apenas para o seu perfil. <strong>Ela ajuda a enxergar o mercado.</strong></h2>
              </div>
              <div>
                <small>COMO FUNCIONA</small>
                <p>Os motores trabalham por trás. Na sua tela aparecem descobertas, prioridades e próximos passos claros.</p>
                <div className="modo-intelligence-flow"><span>Você explica</span><span>A MODO observa</span><span>A MODO prioriza</span><span>Você age</span></div>
              </div>
            </div>
            <div className="modo-intelligence-grid">
              {capabilities.map((item) => (
                <article key={item.number}>
                  <span>{item.number}</span>
                  <h3>{item.title}</h3>
                  <p>{item.copy}</p>
                </article>
              ))}
            </div>
            <div className="modo-intelligence-bottom">
              <div>
                <p>O conjunto muda conforme o negócio: uma empresa pode precisar encontrar compradores; outra, acompanhar concorrentes; outra, entender demanda ou preço.</p>
                <small>Os módulos são ativados conforme o objetivo, a disponibilidade das fontes e as regras aplicáveis a cada operação.</small>
                <div className="modo-intelligence-compare"><strong>Quando usar:</strong> escolha Inteligência quando sua decisão depende do que acontece fora da marca. Para diagnosticar sua própria comunicação, use MODO Scan. Para decidir a próxima ação interna, use Meu próximo movimento.</div>
              </div>
              <a className="button button-primary" href="/app/inteligencia">Criar missão de inteligência ↗</a>
            </div>
          </div>
        </section>,
        sectionTarget,
      )}
    </>
  );
}
