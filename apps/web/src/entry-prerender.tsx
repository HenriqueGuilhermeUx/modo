/**
 * Entrada usada só no build (scripts/prerender.mjs) para gerar o HTML
 * estático da landing. Não é carregada no navegador.
 */
import { renderToString } from "react-dom/server";
import ImpactLanding from "./ImpactLanding";

export function render(): string {
  return renderToString(<ImpactLanding />);
}
