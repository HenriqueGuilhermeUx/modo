import AdminWorkspace from "./AdminWorkspace";
import App from "./App";
import BillingWorkspace from "./BillingWorkspace";
import ContentWorkspace from "./ContentWorkspace";
import DirectorWorkspace from "./DirectorWorkspace";
import InvitationWorkspace from "./InvitationWorkspace";
import LinkedInWorkspace from "./LinkedInWorkspace";
import OnboardingWorkspace from "./OnboardingWorkspace";
import Portal from "./Portal";
import SignalWorkspace from "./SignalWorkspace";

export default function Root() {
  const path = window.location.pathname;
  if (path.startsWith("/admin")) return <AdminWorkspace />;
  if (path.startsWith("/convite/")) return <InvitationWorkspace />;
  if (path.startsWith("/app/onboarding")) return <OnboardingWorkspace />;
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
          <a className="portal-plan-entry" href="/app/onboarding">Primeiros passos</a>
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
