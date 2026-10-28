import { useEffect } from "react";
import "./UsLanding.css";

const features = [
  ["Welcome visitors", "A practical first response to new business inquiries."],
  ["Capture leads", "Keep contact details and service interests organized."],
  ["Simple CRM", "Track each conversation and its follow-up stage."],
  ["Draft follow-ups", "Prepare messages for review before anything is sent."],
] as const;

export default function SmartBotsUSLanding() {
  useEffect(() => {
    const previous = document.documentElement.lang;
    document.documentElement.lang = "en-US";
    return () => { document.documentElement.lang = previous; };
  }, []);
  return <div className="av-us-landing">
    <header className="av-us-header">
      <a className="av-us-brand" href="/" aria-label="SmartBots USA home">
        <span style={{fontWeight:800,fontSize:24,letterSpacing:"-0.04em"}}>SmartBots</span>
        <span>USA Preview</span>
      </a>
      <nav aria-label="SmartBots USA navigation">
        <a href="/" aria-current="page">SmartBots</a>
        <a href="#features">Features</a>
        <a href="#availability">Availability</a>
      </nav>
    </header>
    <main>
      <section className="av-us-hero">
        <div className="av-us-hero-copy">
          <p className="av-us-eyebrow">Alternative Ventures · United States</p>
          <h1>Capture new leads. <strong>Keep every conversation moving.</strong></h1>
          <p className="av-us-intro">SmartBots brings assisted responses, lead capture, a simple CRM and follow-up drafts together. Your team stays in control of each message.</p>
          <div className="av-us-actions">
            <a className="av-us-primary" href="/demo">Try the SmartBots demo</a>
          </div>
          <p className="av-us-preview-note">US preview · Synthetic data only. No account activation, automated sending or checkout.</p>
        </div>
        <aside className="av-us-showcase" aria-label="SmartBots illustrative workflow">
          <div><small>01 · ATTRACT</small><strong>Business inquiries</strong><span>Make the first conversation easier</span></div>
          <div><small>02 · ORGANIZE</small><strong>Lead inbox + CRM</strong><span>Know who needs your attention</span></div>
          <div><small>03 · FOLLOW UP</small><strong>Review reply drafts</strong><span>Human-controlled sending</span></div>
        </aside>
      </section>
      <section className="av-us-section" id="features">
        <p className="av-us-eyebrow">Capabilities</p><h2>Simple tools for the leads you earn.</h2>
        <div className="av-us-feature-grid">{features.map(([title,copy],index)=><article key={title}><span className="av-us-number">0{index+1}</span><h3>{title}</h3><p>{copy}</p></article>)}</div>
      </section>
      <section className="av-us-section av-us-availability" id="availability"><div>
        <p className="av-us-eyebrow">Launch status</p><h2>SmartBots USA is in preview.</h2>
        <p>No US account activation, messaging provider, contracts, payments or production integrations are offered by this demonstration.</p>
      </div></section>
    </main>
    <footer className="av-us-footer"><span>© {new Date().getFullYear()} SmartBots · Alternative Ventures</span><span>USA preview · No Brazilian login or backend access</span></footer>
  </div>;
}
