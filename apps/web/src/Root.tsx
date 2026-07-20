import App from "./App";
import BillingWorkspace from "./BillingWorkspace";
import ContentWorkspace from "./ContentWorkspace";
import DirectorWorkspace from "./DirectorWorkspace";
import LinkedInWorkspace from "./LinkedInWorkspace";
import Portal from "./Portal";
import SignalWorkspace from "./SignalWorkspace";

export default function Root() {
  const path = window.location.pathname;
  if (path.startsWith("/app/planos")) return <BillingWorkspace />;
  if (path.startsWith("/app/director")) return <DirectorWorkspace />;
  if (path.startsWith("/app/linkedin")) return <LinkedInWorkspace />;
  if (path.startsWith("/app/signal")) return <SignalWorkspace />;
  if (path.startsWith("/app/content")) return <ContentWorkspace />;
  if (path.startsWith("/app")) {
    return (
      <>
        <Portal />
        <div className="portal-floating-actions">
          <a className="portal-plan-entry" href="/app/planos">Planos</a>
          <a className="portal-plan-entry" href="/app/director">Diretor</a>
          <a className="portal-plan-entry" href="/app/linkedin">LinkedIn</a>
          <a className="portal-plan-entry" href="/app/signal">Signal</a>
          <a className="portal-workspace-entry" href="/app/content">Criar conteúdo ↗</a>
        </div>
      </>
    );
  }

  return <App />;
}
