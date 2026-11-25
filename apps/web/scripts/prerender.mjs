/**
 * Pré-renderiza a landing ("/") depois do `vite build`.
 *
 * Por quê: a landing é um SPA e o HTML inicial vinha vazio. O MODO Scan, os
 * buscadores e as prévias de link (WhatsApp, LinkedIn) não liam nada.
 *
 * O que faz:
 * 1. Copia o shell do SPA para dist/app-shell.html. O netlify.toml usa esse
 *    arquivo para todas as rotas que não são arquivos (ex.: /app).
 * 2. Gera um build SSR de src/entry-prerender.tsx e renderiza a landing.
 * 3. Injeta o HTML em dist/index.html, servido só em "/".
 *
 * Falha o build se algo der errado: uma landing vazia não deve ir ao ar
 * sem ninguém perceber.
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
const MIN_TEXT_CHARS = 400;

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

  const { render } = await import(pathToFileURL(resolve(ssrOutDir, "entry-prerender.mjs")).href);
  const html = render();
  const textChars = html
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim().length;
  if (textChars < MIN_TEXT_CHARS) {
    throw new Error(`A landing pré-renderizada tem só ${textChars} caracteres de texto.`);
  }

  await writeFile(
    indexPath,
    shell.replace(ROOT_TAG, `<div id="root" data-prerendered="landing">${html}</div>`),
  );
  console.log(
    `[prerender] landing gerada: ${html.length} bytes, ${textChars} caracteres de texto.`,
  );
}

try {
  await main();
} catch (error) {
  console.error("[prerender] falhou:", error);
  process.exitCode = 1;
} finally {
  await rm(ssrOutDir, { recursive: true, force: true });
}
