/**
 * Tabela de rotas do frontend MODO.
 *
 * A ordem importa: a primeira regra que casar vence (mesmo comportamento da
 * antiga cadeia de `if` em Root.tsx). Regras mais específicas precisam vir
 * antes das mais genéricas (ex.: "/admin/smartbots" antes de "/admin").
 *
 * Este módulo é puro (sem React) para poder ser testado isoladamente.
 */

export type RouteKey =
  | "demandPublic"
  | "privacy"
  | "dataDeletion"
  | "forgotPassword"
  | "resetPassword"
  | "agencyApproval"
  | "agencyLanding"
  | "partnerLanding"
  | "smartbotsPage"
  | "smartbotsOnboarding"
  | "specialistApplication"
  | "redirectHome"
  | "adminSmartbots"
  | "adminPartners"
  | "adminHumanOps"
  | "admin"
  | "invitation"
  | "agencyWorkspace"
  | "mobilePwa"
  | "onboarding"
  | "studio"
  | "videoLab"
  | "videoHub"
  | "videoWorkspace"
  | "strategy"
  | "specialistSupport"
  | "week"
  | "billing"
  | "director"
  | "campaigns"
  | "demand"
  | "connections"
  | "prospector"
  | "publisher"
  | "linkedin"
  | "integrations"
  | "intelligence"
  | "signal"
  | "creativeEngine"
  | "content"
  | "portal"
  | "landing";

export interface RouteContext {
  /** Caminho sem barra final ("/" para a raiz). */
  path: string;
  /** Conta em modo agência (?mode=agency ou sessão marcada). */
  agencyMode: boolean;
}

type Matcher = (ctx: RouteContext) => boolean;

const exact =
  (...paths: string[]): Matcher =>
  ({ path }) =>
    paths.includes(path);

const prefix =
  (...prefixes: string[]): Matcher =>
  ({ path }) =>
    prefixes.some((p) => path.startsWith(p));

export const ROUTES: ReadonlyArray<readonly [Matcher, RouteKey]> = [
  // Páginas públicas
  [prefix("/go/"), "demandPublic"],
  [exact("/politica-de-privacidade", "/privacy", "/privacy-policy"), "privacy"],
  [exact("/exclusao-de-dados", "/data-deletion"), "dataDeletion"],
  [exact("/esqueci-minha-senha", "/forgot-password"), "forgotPassword"],
  [exact("/redefinir-senha", "/reset-password"), "resetPassword"],
  [prefix("/approve/"), "agencyApproval"],
  [exact("/agency", "/modo-agency"), "agencyLanding"],
  [exact("/partners", "/partner", "/modo-partner"), "partnerLanding"],
  [exact("/smartbots.html", "/smartbots"), "smartbotsPage"],
  [exact("/onboarding-smartbots.html", "/app/smartbots"), "smartbotsOnboarding"],
  [exact("/rede-modo/convite"), "specialistApplication"],
  [exact("/especialistas", "/rede-modo"), "redirectHome"],

  // Administração interna
  [exact("/admin/smartbots"), "adminSmartbots"],
  [exact("/admin/partners"), "adminPartners"],
  [exact("/admin/rede"), "adminHumanOps"],
  [prefix("/admin"), "admin"],
  [prefix("/convite/"), "invitation"],

  // Área logada
  [
    ({ path, agencyMode }) => path === "/app/agency" || (path === "/app" && agencyMode),
    "agencyWorkspace",
  ],
  [prefix("/app/mobile"), "mobilePwa"],
  [prefix("/app/onboarding"), "onboarding"],
  [prefix("/app/studio/"), "studio"],
  [exact("/app/video-lab"), "videoLab"],
  [exact("/app/video"), "videoHub"],
  [prefix("/app/video/"), "videoWorkspace"],
  [prefix("/app/base"), "strategy"],
  [prefix("/app/especialista"), "specialistSupport"],
  [prefix("/app/week"), "week"],
  [prefix("/app/planos"), "billing"],
  [prefix("/app/director"), "director"],
  [prefix("/app/campanhas"), "campaigns"],
  [prefix("/app/demand", "/app/ads", "/app/growth"), "demand"],
  [prefix("/app/conexoes", "/app/media"), "connections"],
  [prefix("/app/prospector", "/app/sales"), "prospector"],
  [prefix("/app/publisher"), "publisher"],
  [prefix("/app/linkedin"), "linkedin"],
  [prefix("/app/settings/integrations", "/app/meta"), "integrations"],
  [prefix("/app/inteligencia"), "intelligence"],
  [prefix("/app/signal"), "signal"],
  [prefix("/app/create", "/app/criar"), "creativeEngine"],
  [prefix("/app/content"), "content"],
  [prefix("/app"), "portal"],
];

export function normalizePath(pathname: string): string {
  return pathname.replace(/\/$/, "") || "/";
}

export function resolveRoute(ctx: RouteContext): RouteKey {
  for (const [matches, key] of ROUTES) {
    if (matches(ctx)) return key;
  }
  return "landing";
}

/**
 * Atalhos exibidos no Portal (área /app), na ordem do ciclo semanal:
 * memória da marca → plano da semana → criar → aprovar/publicar → aprender.
 *
 * Fase 1 do roadmap (Foco): o menu mostra só o ciclo. As áreas abaixo saíram
 * do menu mas as rotas continuam funcionando por URL (congeladas, não
 * removidas): Campanhas, Anunciar & converter (/app/demand), Prospector
 * (volta na fase 3 como acessório pago "Busca de clientes"), LinkedIn
 * (coberto pelo Publisher), Integrações (Postiz/Metricool/Canva),
 * Inteligência, SmartBots, Signal e Quick Start (unifica em "Criar").
 */
export const PORTAL_SHORTCUTS: ReadonlyArray<{
  href: string;
  label: string;
  kind: "plan" | "workspace";
}> = [
  { href: "/app/onboarding", label: "Primeiros passos", kind: "plan" },
  { href: "/app/week", label: "Minha semana", kind: "plan" },
  { href: "/app/director", label: "Meu próximo movimento", kind: "plan" },
  { href: "/app/base", label: "Memória da marca", kind: "plan" },
  { href: "/app/criar", label: "Criar ↗", kind: "workspace" },
  { href: "/app/video", label: "MODO Video", kind: "plan" },
  { href: "/app/publisher", label: "Aprovar e publicar", kind: "plan" },
  { href: "/app/conexoes", label: "Conectar contas", kind: "plan" },
];

/** Rotas que saíram do menu na fase 1, mas seguem acessíveis por URL. */
export const FROZEN_FROM_MENU: ReadonlyArray<string> = [
  "/app/campanhas",
  "/app/demand",
  "/app/prospector",
  "/app/linkedin",
  "/app/settings/integrations",
  "/app/inteligencia",
  "/onboarding-smartbots.html",
  "/app/signal",
  "/app/content",
];
