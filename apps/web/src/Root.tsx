import AdminWorkspace from "./AdminWorkspace";
import BillingWorkspace from "./BillingWorkspace";
import ContentWorkspace from "./ContentWorkspace";
import DirectorWorkspace from "./DirectorWorkspace";
import ImpactLanding from "./ImpactLanding";
import InvitationWorkspace from "./InvitationWorkspace";
import LinkedInWorkspace from "./LinkedInWorkspace";
import OnboardingWorkspace from "./OnboardingWorkspace";
import Portal from "./Portal";
import PortalWelcomeGuide from "./PortalWelcomeGuide";
import SignalWorkspace from "./SignalWorkspace";
import SmartBotsOnboarding from "./SmartBotsOnboarding";
import SmartBotsPage from "./SmartBotsPage";
import StudioWorkspace from "./StudioWorkspace";
import WeekWorkspace from "./WeekWorkspace";

export default function Root() {
  const path = window.location.pathname;
  if (path === "/smartbots.html" || path === "/smartbots") return <SmartBotsPage />;
  if (path === "/onboarding-smartbots.html" || path === "/app/smartbots") return <SmartBotsOnboarding />;
  if (path.startsWith("/admin")) return <AdminWorkspace />;
  if (path.startsWith("/convite/")) return <InvitationWorkspace />;
  if (path.startsWith("/app/onboarding")) return <OnboardingWorkspace />;
  if (path.startsWith("/app/studio/")) return <StudioWorkspace />;
  if (path.startsWith("/app/week")) return <WeekWorkspace />;
  if (path.startsWith("/app/planos")) return <BillingWorkspace />;
  if (path.startsWith("/app/director")) return <DirectorWorkspace />;
  if (path.startsWith("/app/linkedin")) return <LinkedInWorkspace />;
  if (path.startsWith("/app/signal")) return <SignalWorkspace />;
  if (path.startsWith("/app/content")) return <ContentWorkspace />;
  if (path.startsWith("/app")) {
    return (
      <>
        <Portal />
        <PortalWelcomeGuide />
        <div className="portal-floating-actions">
          <a className="portal-plan-entry" href="/app/onboarding">Primeiros passos</a>
          <a className="portal-plan-entry" href="/app/week">Minha semana</a>
          <a className="portal-plan-entry" href="/app/director">Diretor</a>
          <a className="portal-plan-entry" href="/app/linkedin">LinkedIn</a>
          <a className="portal-plan-entry" href="/onboarding-smartbots.html">SmartBots</a>
          <a className="portal-plan-entry" href="/app/signal">Signal</a>
          <a className="portal-workspace-entry" href="/app/content">Quick Start e criar ↗</a>
        </div>
      </>
    );
  }

  return <ImpactLanding />;
}
