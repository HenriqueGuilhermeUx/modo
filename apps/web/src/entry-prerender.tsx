/**
 * Entrada usada só no build (scripts/prerender.mjs) para gerar o HTML
 * estático das páginas públicas. Não é carregada no navegador.
 */
import { renderToString } from "react-dom/server";
import ImpactLanding from "./ImpactLanding";
import { DataDeletionPage, PrivacyPolicyPage } from "./LegalPages";

export interface PrerenderPage {
  /** Caminho público da página. */
  path: string;
  /** Arquivo gerado em dist/ (o Netlify serve /x a partir de x.html). */
  file: string;
  /** Mínimo de caracteres de texto; abaixo disso o build falha. */
  minTextChars: number;
  render: () => string;
}

export const pages: PrerenderPage[] = [
  {
    path: "/",
    file: "index.html",
    minTextChars: 400,
    render: () => renderToString(<ImpactLanding />),
  },
  {
    // Exigida pela Meta no App Review: precisa abrir com texto, sem login.
    path: "/politica-de-privacidade",
    file: "politica-de-privacidade.html",
    minTextChars: 400,
    render: () => renderToString(<PrivacyPolicyPage />),
  },
  {
    path: "/exclusao-de-dados",
    file: "exclusao-de-dados.html",
    minTextChars: 300,
    render: () => renderToString(<DataDeletionPage />),
  },
];
