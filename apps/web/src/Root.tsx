import { lazy, Suspense, type ReactNode } from "react";
import { prerenderedSnapshot } from "./prerender-snapshot";
import { normalizePath, PORTAL_SHORTCUTS, resolveRoute, type RouteKey } from "./routes";
const MobilePWA = lazy(() => import("./MobilePWA"));
const CreativeEngineWorkspace = lazy(() => import("./CreativeEngineWorkspace"));
const ConnectionCenter = lazy(() => import("./ConnectionCenter"));
const DemandPublicLanding = lazy(() => import("./DemandPublicLanding"));
const DemandWorkspace = lazy(() => import("./DemandWorkspace"));
const AdminWorkspace = lazy(() => import("./AdminWorkspace"));
const AgencyApprovalPortal = lazy(() => import("./AgencyApprovalPortal"));
const AgencyLanding = lazy(() => import("./AgencyLanding"));
const AgencyWorkspace = lazy(() => import("./AgencyWorkspace"));
const BillingWorkspace = lazy(() => import("./BillingWorkspace"));
const CampaignWorkspace = lazy(() => import("./CampaignWorkspace"));
const ContentWorkspace = lazy(() => import("./ContentWorkspace"));
const DirectorWorkspace = lazy(() => import("./DirectorWorkspace"));
const ForgotPasswordPage = lazy(() =>
  import("./PasswordRecoveryPages").then((m) => ({ default: m.ForgotPasswordPage })),
);
const HumanOperationsAdminWorkspace = lazy(() => import("./HumanOperationsAdminWorkspace"));
const ImpactLanding = lazy(() => import("./ImpactLanding"));
const IntelligenceWorkspace = lazy(() => import("./IntelligenceWorkspace"));
const IntegrationsWorkspace = lazy(() => import("./IntegrationsWorkspace"));
const InvitationWorkspace = lazy(() => import("./InvitationWorkspace"));
const PrivacyPolicyPage = lazy(() =>
  import("./LegalPages").then((m) => ({ default: m.PrivacyPolicyPage })),
);
const DataDeletionPage = lazy(() =>
  import("./LegalPages").then((m) => ({ default: m.DataDeletionPage })),
);
const LinkedInWorkspace = lazy(() => import("./LinkedInWorkspace"));
const OnboardingWorkspace = lazy(() => import("./OnboardingWorkspace"));
const PartnerAdminWorkspace = lazy(() => import("./PartnerAdminWorkspace"));
const PartnerAgencyEntryAddon = lazy(() => import("./PartnerAgencyEntryAddon"));
const PartnerLanding = lazy(() => import("./PartnerLanding"));
const PasswordRecoveryEntry = lazy(() => import("./PasswordRecoveryEntry"));
const Portal = lazy(() => import("./Portal"));
const PortalWelcomeGuide = lazy(() => import("./PortalWelcomeGuide"));
const ProductPathGuideAddon = lazy(() => import("./ProductPathGuideAddon"));
const PublisherWorkspace = lazy(() => import("./PublisherWorkspace"));
const ProspectorWorkspace = lazy(() => import("./ProspectorWorkspace"));
const ResetPasswordPage = lazy(() =>
  import("./PasswordRecoveryPages").then((m) => ({ default: m.ResetPasswordPage })),
);
const SignalWorkspace = lazy(() => import("./SignalWorkspace"));
const SmartBotsAdminWorkspace = lazy(() => import("./SmartBotsAdminWorkspace"));
const SmartBotsOnboarding = lazy(() => import("./SmartBotsOnboarding"));
const SmartBotsPage = lazy(() => import("./SmartBotsPage"));
const SpecialistApplicationPage = lazy(() => import("./SpecialistApplicationPage"));
const SpecialistSupportWorkspace = lazy(() => import("./SpecialistSupportWorkspace"));
const StrategyWorkspace = lazy(() => import("./StrategyWorkspace"));
const StudioWorkspace = lazy(() => import("./StudioWorkspace"));
const VideoHub = lazy(() => import("./VideoHub"));
const VideoLabCommercial = lazy(() => import("./VideoLabCommercial"));
const VideoWorkspace = lazy(() => import("./VideoWorkspaceV18"));
const WeekWorkspace = lazy(() => import("./WeekWorkspace"));
function RouteLoading() {
  const snapshot = prerenderedSnapshot();
  if (snapshot) {
    // HTML pré-renderizado da página: evita piscar o spinner enquanto o chunk carrega.
    return <div style={{ display: "contents" }} dangerouslySetInnerHTML={{ __html: snapshot }} />;
  }
  return (
    <main className="portal-loading">
      <img src="/logo.svg" alt="MODO" />
      <div className="portal-spinner" />
      <p>Preparando sua experiência...</p>
    </main>
  );
}
function suspended(node: ReactNode) {
  return <Suspense fallback={<RouteLoading />}>{node}</Suspense>;
}
function PortalShortcuts() {
  return (
    <div className="portal-floating-actions">
      {PORTAL_SHORTCUTS.map((item) => (
        <a
          key={item.href}
          className={item.kind === "plan" ? "portal-plan-entry" : "portal-workspace-entry"}
          href={item.href}
        >
          {item.label}
        </a>
      ))}
    </div>
  );
}

const PAGES: Record<Exclude<RouteKey, "redirectHome">, () => ReactNode> = {
  demandPublic: () => <DemandPublicLanding />,
  privacy: () => <PrivacyPolicyPage />,
  dataDeletion: () => <DataDeletionPage />,
  forgotPassword: () => <ForgotPasswordPage />,
  resetPassword: () => <ResetPasswordPage />,
  agencyApproval: () => <AgencyApprovalPortal />,
  agencyLanding: () => (
    <>
      <AgencyLanding />
      <PartnerAgencyEntryAddon />
    </>
  ),
  partnerLanding: () => <PartnerLanding />,
  smartbotsPage: () => <SmartBotsPage />,
  smartbotsOnboarding: () => <SmartBotsOnboarding />,
  specialistApplication: () => <SpecialistApplicationPage />,
  adminSmartbots: () => <SmartBotsAdminWorkspace />,
  adminPartners: () => <PartnerAdminWorkspace />,
  adminHumanOps: () => <HumanOperationsAdminWorkspace />,
  admin: () => <AdminWorkspace />,
  invitation: () => <InvitationWorkspace />,
  agencyWorkspace: () => (
    <>
      <AgencyWorkspace />
      <PasswordRecoveryEntry mode="agency" />
    </>
  ),
  mobilePwa: () => <MobilePWA />,
  onboarding: () => <OnboardingWorkspace />,
  studio: () => <StudioWorkspace />,
  videoLab: () => <VideoLabCommercial />,
  videoHub: () => <VideoHub />,
  videoWorkspace: () => <VideoWorkspace />,
  strategy: () => <StrategyWorkspace />,
  specialistSupport: () => <SpecialistSupportWorkspace />,
  week: () => <WeekWorkspace />,
  billing: () => <BillingWorkspace />,
  director: () => <DirectorWorkspace />,
  campaigns: () => <CampaignWorkspace />,
  demand: () => <DemandWorkspace />,
  connections: () => <ConnectionCenter />,
  prospector: () => <ProspectorWorkspace />,
  publisher: () => <PublisherWorkspace />,
  linkedin: () => <LinkedInWorkspace />,
  integrations: () => <IntegrationsWorkspace />,
  intelligence: () => <IntelligenceWorkspace />,
  signal: () => <SignalWorkspace />,
  creativeEngine: () => <CreativeEngineWorkspace />,
  content: () => <ContentWorkspace />,
  portal: () => (
    <>
      <Portal />
      <PasswordRecoveryEntry mode="business" />
      <PortalWelcomeGuide />
      <ProductPathGuideAddon mode="portal" />
      <PortalShortcuts />
    </>
  ),
  landing: () => <ImpactLanding />,
};

export default function Root() {
  const path = normalizePath(window.location.pathname);
  const params = new URLSearchParams(window.location.search);
  const agencyMode =
    params.get("mode") === "agency" ||
    window.sessionStorage.getItem("modo.accountMode") === "agency";
  const route = resolveRoute({ path, agencyMode });
  if (route === "redirectHome") {
    window.location.replace("/");
    return null;
  }
  return suspended(PAGES[route]());
}
