import { useEffect } from "react";
import "./UsLanding.css";

type UsProduct = "modo" | "smartbots";

const modoCapabilities = [
  {
    title: "Brand understanding",
    copy: "Organize your business positioning, target audience, offers and marketing priorities before creating content.",
  },
  {
    title: "Creative workflows",
    copy: "Draft content, campaign concepts and visual assets with human review before anything is published.",
  },
  {
    title: "Campaign organization",
    copy: "Keep ideas, approvals, content and next steps connected instead of managing everything in disconnected tools.",
  },
  {
    title: "Lead follow-up",
    copy: "Turn marketing interest into organized contacts and suggested follow-up actions with SmartBots.",
  },
];

const smartBotsCapabilities = [
  {
    title: "Mini-site with an assistant",
    copy: "Introduce your business, collect questions and give visitors a useful first response.",
  },
  {
    title: "Lead capture",
    copy: "Collect incoming contact information and interests in one organized workflow.",
  },
  {
    title: "Simple CRM",
    copy: "See who reached out, what they asked and which follow-up needs attention.",
  },
  {
    title: "Follow-up drafts",
    copy: "Prepare suggested messages for review. The existing assisted version does not automatically send WhatsApp messages.",
  },
];

function useEnglishPage(product: UsProduct) {
  useEffect(() => {
    const previousLang = document.documentElement.lang;
    const previousTitle = document.title;
    const description = document.querySelector<HTMLMetaElement>('meta[name="description"]');
    const previousDescription = description?.content;

    document.documentElement.lang = "en-US";
    document.title = product === "modo"
      ? "MODO USA | AI-powered marketing workflows"
      : "SmartBots USA | Lead capture and follow-up";
    if (description) description.content = product === "modo"
      ? "Explore AI-assisted marketing workflows from MODO: plan, create, review and grow."
      : "Explore SmartBots assisted lead capture, simple CRM and message drafting.";

    return () => {
      document.documentElement.lang = previousLang;
      document.title = previousTitle;
      if (description && previousDescription !== undefined) description.content = previousDescription;
    };
  }, [product]);
}

export default function UsLanding({ product }: { product: UsProduct }) {
  useEnglishPage(product);
  const isSmartBots = product === "smartbots";
  const capabilities = isSmartBots ? smartBotsCapabilities : modoCapabilities;

  return (
    <div className="av-us-landing">
      <header className="av-us-header">
        <a className="av-us-brand" href="/us" aria-label="MODO USA home">
          <img src="/logo.svg" alt="MODO" />
          <span>USA Preview</span>
        </a>
        <nav aria-label="United States product navigation">
          <a href="/us" aria-current={!isSmartBots ? "page" : undefined}>MODO</a>
          <a href="/us/smartbots" aria-current={isSmartBots ? "page" : undefined}>SmartBots</a>
          <a href="#features">Features</a>
          <a href="#availability">Availability</a>
        </nav>
      </header>

      <main>
        <section className="av-us-hero">
          <div className="av-us-hero-copy">
            <p className="av-us-eyebrow">Alternative Ventures · United States</p>
            <h1>{isSmartBots
              ? <>Capture new leads. <strong>Keep every conversation moving.</strong></>
              : <>Your business comes first. <strong>Make marketing easier to run.</strong></>}</h1>
            <p className="av-us-intro">{isSmartBots
              ? "SmartBots connects a simple business mini-site, assisted answers, lead capture, a lightweight CRM and suggested follow-ups. You stay in control of each message."
              : "MODO brings brand strategy, content creation, campaign planning and review workflows together so small teams can move from ideas to action."}</p>
            <div className="av-us-actions">
              <a className="av-us-primary" href="#features">Explore capabilities ↗</a>
              <a className="av-us-secondary" href={isSmartBots ? "/us" : "/us/smartbots"}>
                {isSmartBots ? "Explore MODO" : "See SmartBots"}
              </a>
            </div>
            <p className="av-us-preview-note">US preview · No US account activation or checkout is available on this page.</p>
          </div>
          <aside className="av-us-showcase" aria-label="Illustrative workflow">
            {isSmartBots ? (
              <>
                <div><small>01 · ATTRACT</small><strong>Business website + lead form</strong><span>A clear place to start the conversation</span></div>
                <div><small>02 · ORGANIZE</small><strong>Captured leads + simple CRM</strong><span>Know who needs a reply</span></div>
                <div><small>03 · FOLLOW UP</small><strong>Message drafts for your review</strong><span>Human-controlled sending</span></div>
              </>
            ) : (
              <>
                <div><small>01 · UNDERSTAND</small><strong>Your audience and offer</strong><span>Start with your business context</span></div>
                <div><small>02 · CREATE</small><strong>Content and campaign drafts</strong><span>Review before publishing</span></div>
                <div><small>03 · IMPROVE</small><strong>Organize the next marketing cycle</strong><span>Turn work into a repeatable process</span></div>
              </>
            )}
          </aside>
        </section>

        <section className="av-us-section" id="features">
          <p className="av-us-eyebrow">What it does</p>
          <h2>{isSmartBots ? "Simple tools for the leads you earn." : "One practical marketing workflow."}</h2>
          <div className="av-us-feature-grid">
            {capabilities.map(({ title, copy }, index) => (
              <article key={title}>
                <span className="av-us-number">0{index + 1}</span>
                <h3>{title}</h3>
                <p>{copy}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="av-us-section av-us-availability" id="availability">
          <div>
            <p className="av-us-eyebrow">Launch status</p>
            <h2>Built on an existing product. Being localized for the United States.</h2>
            <p>This preview introduces current product capabilities, not a promise that local payments, integrations, support or contracts are live in the US. Availability will be confirmed after localization and release checks.</p>
          </div>
          <a href={isSmartBots ? "/us" : "/us/smartbots"}>
            {isSmartBots ? "Explore MODO →" : "Explore SmartBots →"}
          </a>
        </section>
      </main>

      <footer className="av-us-footer">
        <span>© {new Date().getFullYear()} Alternative Ventures · MODO</span>
        <span>US preview. Features and availability subject to validation.</span>
        <a href="https://alternativeventures.com.br/">About Alternative Ventures ↗</a>
      </footer>
    </div>
  );
}
