import { lazy, Suspense, type ReactNode } from "react";

const AdminWorkspace=lazy(()=>import("./AdminWorkspace"));
const AgencyLanding=lazy(()=>import("./AgencyLanding"));
const BillingWorkspace=lazy(()=>import("./BillingWorkspace"));
const CampaignWorkspace=lazy(()=>import("./CampaignWorkspace"));
const ContentWorkspace=lazy(()=>import("./ContentWorkspace"));
const DirectorWorkspace=lazy(()=>import("./DirectorWorkspace"));
const HumanOperationsAdminWorkspace=lazy(()=>import("./HumanOperationsAdminWorkspace"));
const ImpactLanding=lazy(()=>import("./ImpactLanding"));
const IntelligenceWorkspace=lazy(()=>import("./IntelligenceWorkspace"));
const IntegrationsWorkspace=lazy(()=>import("./IntegrationsWorkspace"));
const InvitationWorkspace=lazy(()=>import("./InvitationWorkspace"));
const PrivacyPolicyPage=lazy(()=>import("./LegalPages").then(m=>({default:m.PrivacyPolicyPage})));
const DataDeletionPage=lazy(()=>import("./LegalPages").then(m=>({default:m.DataDeletionPage})));
const LinkedInWorkspace=lazy(()=>import("./LinkedInWorkspace"));
const OnboardingWorkspace=lazy(()=>import("./OnboardingWorkspace"));
const Portal=lazy(()=>import("./Portal"));
const PortalWelcomeGuide=lazy(()=>import("./PortalWelcomeGuide"));
const ProductPathGuideAddon=lazy(()=>import("./ProductPathGuideAddon"));
const PublisherWorkspace=lazy(()=>import("./PublisherWorkspace"));
const SignalWorkspace=lazy(()=>import("./SignalWorkspace"));
const SmartBotsAdminWorkspace=lazy(()=>import("./SmartBotsAdminWorkspace"));
const SmartBotsOnboarding=lazy(()=>import("./SmartBotsOnboarding"));
const SmartBotsPage=lazy(()=>import("./SmartBotsPage"));
const SpecialistApplicationPage=lazy(()=>import("./SpecialistApplicationPage"));
const SpecialistSupportWorkspace=lazy(()=>import("./SpecialistSupportWorkspace"));
const StrategyWorkspace=lazy(()=>import("./StrategyWorkspace"));
const StudioWorkspace=lazy(()=>import("./StudioWorkspace"));
const WeekWorkspace=lazy(()=>import("./WeekWorkspace"));

function RouteLoading(){return <main className="portal-loading" aria-live="polite" aria-busy="true"><img src="/logo.svg" alt="MODO"/><div className="portal-spinner"/><p>Preparando sua experiência...</p></main>}
function suspended(node:ReactNode){return <Suspense fallback={<RouteLoading/>}>{node}</Suspense>}

export default function Root(){
 const path=window.location.pathname.replace(/\/$/,"")||"/";
 if(["/politica-de-privacidade","/privacy","/privacy-policy"].includes(path))return suspended(<PrivacyPolicyPage/>);
 if(["/exclusao-de-dados","/data-deletion"].includes(path))return suspended(<DataDeletionPage/>);
 if(path==="/agency"||path==="/modo-agency")return suspended(<AgencyLanding/>);
 if(path==="/smartbots.html"||path==="/smartbots")return suspended(<SmartBotsPage/>);
 if(path==="/onboarding-smartbots.html"||path==="/app/smartbots")return suspended(<SmartBotsOnboarding/>);
 if(path==="/rede-modo/convite")return suspended(<SpecialistApplicationPage/>);
 if(path==="/especialistas"||path==="/rede-modo"){window.location.replace("/");return null}
 if(path==="/admin/smartbots")return suspended(<SmartBotsAdminWorkspace/>);
 if(path==="/admin/rede")return suspended(<HumanOperationsAdminWorkspace/>);
 if(path.startsWith("/admin"))return suspended(<><AdminWorkspace/><div style={{position:"fixed",right:22,bottom:22,zIndex:1000,display:"flex",gap:8}}><a href="/admin/rede" style={{background:"#1F5EFF",color:"#fff",borderRadius:999,padding:"12px 17px",fontSize:11,fontWeight:900,boxShadow:"0 15px 40px rgba(13,27,62,.2)",textDecoration:"none"}}>Time Modo</a><a href="/admin/smartbots" style={{background:"#2ED19A",color:"#0D1B3E",borderRadius:999,padding:"12px 17px",fontSize:11,fontWeight:900,boxShadow:"0 15px 40px rgba(13,27,62,.2)",textDecoration:"none"}}>SmartBots</a></div></>);
 if(path.startsWith("/convite/"))return suspended(<InvitationWorkspace/>);
 if(path.startsWith("/app/onboarding"))return suspended(<OnboardingWorkspace/>);
 if(path.startsWith("/app/studio/"))return suspended(<StudioWorkspace/>);
 if(path.startsWith("/app/base"))return suspended(<StrategyWorkspace/>);
 if(path.startsWith("/app/especialista"))return suspended(<SpecialistSupportWorkspace/>);
 if(path.startsWith("/app/week"))return suspended(<WeekWorkspace/>);
 if(path.startsWith("/app/planos"))return suspended(<BillingWorkspace/>);
 if(path.startsWith("/app/director"))return suspended(<DirectorWorkspace/>);
 if(path.startsWith("/app/campanhas"))return suspended(<CampaignWorkspace/>);
 if(path.startsWith("/app/publisher"))return suspended(<PublisherWorkspace/>);
 if(path.startsWith("/app/linkedin"))return suspended(<LinkedInWorkspace/>);
 if(path.startsWith("/app/settings/integrations")||path.startsWith("/app/meta"))return suspended(<IntegrationsWorkspace/>);
 if(path.startsWith("/app/inteligencia"))return suspended(<IntelligenceWorkspace/>);
 if(path.startsWith("/app/signal"))return suspended(<SignalWorkspace/>);
 if(path.startsWith("/app/content"))return suspended(<ContentWorkspace/>);
 if(path.startsWith("/app"))return suspended(<><Portal/><PortalWelcomeGuide/><ProductPathGuideAddon mode="portal"/><div className="portal-floating-actions"><a className="portal-plan-entry" href="/app/onboarding">Primeiros passos</a><a className="portal-plan-entry" href="/app/base">Base estratégica</a><a className="portal-plan-entry" href="/app/week">Minha semana</a><a className="portal-plan-entry" href="/app/director">Meu próximo movimento</a><a className="portal-plan-entry" href="/app/campanhas">Campanhas</a><a className="portal-plan-entry" href="/app/publisher">Publisher</a><a className="portal-plan-entry" href="/app/linkedin">LinkedIn</a><a className="portal-plan-entry" href="/app/settings/integrations">Integrações</a><a className="portal-plan-entry" href="/app/inteligencia">Inteligência</a><a className="portal-plan-entry" href="/onboarding-smartbots.html">SmartBots</a><a className="portal-plan-entry" href="/app/signal">Signal</a><a className="portal-workspace-entry" href="/app/content">Quick Start e criar ↗</a></div></>);
 return suspended(<ImpactLanding/>);
}
