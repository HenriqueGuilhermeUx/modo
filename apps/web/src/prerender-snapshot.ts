/**
 * A landing ("/") chega do build já com o HTML pré-renderizado dentro de
 * #root (ver scripts/prerender.mjs). Isso deixa o texto legível para o MODO
 * Scan, buscadores e prévias de link.
 *
 * Antes de o React montar, guardamos esse HTML para usá-lo como "fallback"
 * do Suspense enquanto o chunk da landing carrega. Assim a página não pisca
 * entre o conteúdo pronto, o spinner e o conteúdo de novo.
 */
let landingSnapshot: string | null = null;

export function capturePrerenderedLanding(root: HTMLElement) {
  if (root.dataset.prerendered === "landing" && window.location.pathname === "/") {
    landingSnapshot = root.innerHTML;
  }
}

export function prerenderedLanding(): string | null {
  return landingSnapshot;
}
