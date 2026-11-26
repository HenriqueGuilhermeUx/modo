/**
 * Pré-renderiza as páginas públicas depois do `vite build`.
 *
 * Por quê: o site é um SPA e o HTML inicial vinha vazio. O MODO Scan, os
 * buscadores, as prévias de link (WhatsApp, LinkedIn) e o robô da Meta (que
 * confere a Política de Privacidade e a Exclusão de Dados no App Review) não
 * liam nada.
 *
 * O que faz:
 * 1. Copia o shell do SPA para dist/app-shell.html. O netlify.toml usa esse
 *    arquivo para todas as rotas que não são arquivos (ex.: /app).
 * 2. Gera um build SSR de src/entry-prerender.tsx, que lista as páginas.
 * 3. Para cada página, injeta o HTML no shell e grava o arquivo em dist/
 *    (index.html para "/", <slug>.html para as demais).
 *
 * Falha o build se algo der errado: uma página pública vazia não deve ir ao
 * ar sem ninguém perceber.
 */
import { copyFile, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "vite";

const webRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const distDir = resolve(webRoot, "dist");
const ssrOutDir = resolve(webRoot, "dist-prerender");
const indexPath = resolve(distDir, "index.html");
const ROOT_TAG = '<div id="root"></div>';

function textLength(html) {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim().length;
}

async function main() {
  const shell = await readFile(indexPath, "utf8");
  if (!shell.includes(ROOT_TAG)) {
    throw new Error(`dist/index.html não contém ${ROOT_TAG}.`);
  }
  await copyFile(indexPath, resolve(distDir, "app-shell.html"));

  await build({
    root: webRoot,
    configFile: resolve(webRoot, "vite.config.ts"),
    logLevel: "warn",
    build: {
      ssr: "src/entry-prerender.tsx",
      outDir: ssrOutDir,
      emptyOutDir: true,
      copyPublicDir: false,
      rollupOptions: { output: { entryFileNames: "entry-prerender.mjs" } },
    },
  });

  const { pages } = await import(pathToFileURL(resolve(ssrOutDir, "entry-prerender.mjs")).href);
  for (const page of pages) {
    const html = page.render();
    const chars = textLength(html);
    if (chars < page.minTextChars) {
      throw new Error(`${page.path} pré-renderizada tem só ${chars} caracteres de texto.`);
    }
    await writeFile(
      resolve(distDir, page.file),
      shell.replace(ROOT_TAG, `<div id="root" data-prerendered="${page.path}">${html}</div>`),
    );
    console.log(`[prerender] ${page.path} → ${page.file}: ${chars} caracteres de texto.`);
  }
}

try {
  await main();
} catch (error) {
  console.error("[prerender] falhou:", error);
  process.exitCode = 1;
} finally {
  await rm(ssrOutDir, { recursive: true, force: true });
}
