/**
 * Algumas páginas públicas chegam do build com o HTML pré-renderizado dentro
 * de #root (ver scripts/prerender.mjs): a landing ("/"), a Política de
 * Privacidade e as Instruções de Exclusão de Dados. Isso deixa o texto
 * legível para o MODO Scan, buscadores, prévias de link e o robô da Meta.
 *
 * O atributo `data-prerendered` guarda o caminho da página gerada. Antes de o
 * React montar, guardamos esse HTML para usá-lo como "fallback" do Suspense
 * enquanto o chunk da página carrega. Assim a página não pisca entre o
 * conteúdo pronto, o spinner e o conteúdo de novo.
 */
let snapshot: string | null = null;

function normalize(path: string) {
  return path.length > 1 ? path.replace(/\/+$/, "") : path;
}

export function capturePrerendered(root: HTMLElement) {
  const path = root.dataset.prerendered;
  if (path && normalize(window.location.pathname) === path) {
    snapshot = root.innerHTML;
  }
}

export function prerenderedSnapshot(): string | null {
  return snapshot;
}
