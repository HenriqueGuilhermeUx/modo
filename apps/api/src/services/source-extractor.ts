import type { SourceExtractResponse } from "@modo/contracts/source";
import { assertResolvedPublicHttpUrl } from "../security/public-url.js";

const MAX_BYTES = 700_000;
const MAX_TEXT = 20_000;
const MAX_SITE_TEXT = 70_000;
const MAX_REDIRECTS = 3;
const MAX_SITE_PAGES = 5;

type ExtractedPage = SourceExtractResponse & { links: string[] };

export interface PublicSiteExtractResponse extends SourceExtractResponse {
  pages: Array<{
    sourceUrl: string;
    title: string;
    wordCount: number;
  }>;
}

function decodeEntities(value: string) {
  const named: Record<string, string> = {
    amp: "&",
    lt: "<",
    gt: ">",
    quot: '"',
    apos: "'",
    nbsp: " ",
  };
  return value.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (_match, entity: string) => {
    const normalized = entity.toLowerCase();
    if (normalized.startsWith("#x")) return String.fromCodePoint(Number.parseInt(normalized.slice(2), 16));
    if (normalized.startsWith("#")) return String.fromCodePoint(Number.parseInt(normalized.slice(1), 10));
    return named[normalized] ?? " ";
  });
}

function cleanHtml(html: string) {
  const title = decodeEntities(
    html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.replace(/<[^>]+>/g, " ") ?? "Conteúdo da fonte",
  ).replace(/\s+/g, " ").trim().slice(0, 300);

  const text = decodeEntities(
    html
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(/<(script|style|noscript|svg|canvas|iframe)[^>]*>[\s\S]*?<\/\1>/gi, " ")
      .replace(/<(nav|footer|aside|form)[^>]*>[\s\S]*?<\/\1>/gi, " ")
      // O hero costuma estar dentro de <header>; removemos apenas as tags, preservando o conteúdo.
      .replace(/<\/?header[^>]*>/gi, " ")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(p|article|section|main|h1|h2|h3|h4|li|blockquote|div)>/gi, "\n")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/[\t ]+/g, " ")
    .replace(/\n\s*\n+/g, "\n")
    .trim()
    .slice(0, MAX_TEXT);

  return { title: title || "Conteúdo da fonte", text };
}

function extractLinks(html: string, baseUrl: URL) {
  const links = new Set<string>();
  const matcher = /<a\b[^>]*\bhref\s*=\s*["']([^"']+)["'][^>]*>/gi;
  for (const match of html.matchAll(matcher)) {
    const raw = match[1]?.trim();
    if (!raw || raw.startsWith("#") || raw.startsWith("mailto:") || raw.startsWith("tel:") || raw.startsWith("javascript:")) continue;
    try {
      const url = new URL(raw, baseUrl);
      if (!["http:", "https:"].includes(url.protocol)) continue;
      if (url.hostname !== baseUrl.hostname) continue;
      url.hash = "";
      url.search = "";
      const normalized = url.toString().replace(/\/$/, "") || url.origin;
      links.add(normalized);
    } catch {
      // Link inválido ou não navegável.
    }
  }
  return [...links];
}

async function readLimitedText(response: Response) {
  const declared = Number(response.headers.get("content-length") || 0);
  if (declared > MAX_BYTES) throw new Error("A página é grande demais para análise.");
  if (!response.body) return "";

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let size = 0;
  let value = "";
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > MAX_BYTES) throw new Error("A página é grande demais para análise.");
      value += decoder.decode(chunk.value, { stream: true });
    }
    value += decoder.decode();
    return value;
  } finally {
    reader.releaseLock();
  }
}

async function fetchSource(rawUrl: string, redirects = 0): Promise<{ response: Response; url: URL }> {
  if (redirects > MAX_REDIRECTS) throw new Error("O endereço fez redirecionamentos demais.");
  const url = await assertResolvedPublicHttpUrl(rawUrl);
  const response = await fetch(url, {
    redirect: "manual",
    headers: {
      "user-agent": "MODO-Scan/1.1 (+public-site-analysis; max-5-pages)",
      accept: "text/html,text/plain,application/xhtml+xml;q=0.9,*/*;q=0.1",
    },
    signal: AbortSignal.timeout(12_000),
  });

  if ([301, 302, 303, 307, 308].includes(response.status)) {
    const location = response.headers.get("location");
    if (!location) throw new Error("O endereço redirecionou sem informar o destino.");
    return fetchSource(new URL(location, url).toString(), redirects + 1);
  }
  return { response, url };
}

async function extractPage(rawUrl: string): Promise<ExtractedPage> {
  const { response, url } = await fetchSource(rawUrl);
  if (!response.ok) throw new Error(`A fonte respondeu com o código ${response.status}.`);

  const contentType = (response.headers.get("content-type") || "").toLowerCase();
  if (!contentType.includes("text/html") && !contentType.includes("text/plain") && !contentType.includes("application/xhtml+xml")) {
    throw new Error("Neste momento, a MODO analisa páginas públicas de texto.");
  }

  const raw = await readLimitedText(response);
  const cleaned = contentType.includes("text/plain")
    ? { title: url.hostname, text: raw.replace(/\s+/g, " ").trim().slice(0, MAX_TEXT) }
    : cleanHtml(raw);
  if (cleaned.text.length < 80) throw new Error("Não encontramos texto suficiente nessa página.");

  return {
    sourceUrl: url.toString(),
    title: cleaned.title,
    text: cleaned.text,
    wordCount: cleaned.text.split(/\s+/).filter(Boolean).length,
    links: contentType.includes("text/html") || contentType.includes("application/xhtml+xml")
      ? extractLinks(raw, url)
      : [],
  };
}

const positivePathTokens = [
  "produto", "product", "solucao", "solucoes", "solution", "features", "funcionalidades",
  "como-funciona", "como_funciona", "how-it-works", "precos", "preco", "pricing", "planos",
  "cases", "casos", "clientes", "depoimentos", "seguranca", "security", "faq", "sobre", "about",
  "metodologia", "tecnologia", "beneficios", "benefits", "compliance", "transparencia",
];
const negativePathTokens = [
  "login", "signin", "signup", "cadastro", "app", "admin", "dashboard", "painel", "checkout",
  "cart", "carrinho", "privacidade", "privacy", "termos", "terms", "cookies", "contato", "contact",
  "wp-json", "feed", "tag", "author", "categoria", "category",
];

function scoreSiteLink(rawUrl: string) {
  const url = new URL(rawUrl);
  const path = decodeURIComponent(url.pathname).toLowerCase();
  if (path === "/" || path === "") return -100;
  if (negativePathTokens.some((token) => path.includes(token))) return -100;
  let score = 0;
  for (const token of positivePathTokens) if (path.includes(token)) score += 5;
  const depth = path.split("/").filter(Boolean).length;
  if (depth === 1) score += 2;
  if (depth > 3) score -= 3;
  if (/\.(pdf|jpg|jpeg|png|webp|gif|svg|zip|mp4|mp3)$/i.test(path)) return -100;
  return score;
}

export async function extractPublicSource(rawUrl: string): Promise<SourceExtractResponse> {
  const page = await extractPage(rawUrl);
  return {
    sourceUrl: page.sourceUrl,
    title: page.title,
    text: page.text,
    wordCount: page.wordCount,
  };
}

export async function extractPublicSite(rawUrl: string): Promise<PublicSiteExtractResponse> {
  const home = await extractPage(rawUrl);
  const homeUrl = new URL(home.sourceUrl);
  const candidates = home.links
    .filter((link) => new URL(link).hostname === homeUrl.hostname)
    .map((link) => ({ link, score: scoreSiteLink(link) }))
    .filter((item) => item.score > -100)
    .sort((a, b) => b.score - a.score || a.link.length - b.link.length)
    .slice(0, MAX_SITE_PAGES - 1);

  const additional = await Promise.allSettled(candidates.map((item) => extractPage(item.link)));
  const pages = [
    home,
    ...additional
      .filter((result): result is PromiseFulfilledResult<ExtractedPage> => result.status === "fulfilled")
      .map((result) => result.value),
  ];

  const uniqueTexts = new Set<string>();
  const combinedParts: string[] = [];
  for (const page of pages) {
    const fingerprint = page.text.toLowerCase().replace(/\s+/g, " ").slice(0, 500);
    if (uniqueTexts.has(fingerprint)) continue;
    uniqueTexts.add(fingerprint);
    combinedParts.push(`PÁGINA: ${page.title}\nURL: ${page.sourceUrl}\n${page.text}`);
  }
  const text = combinedParts.join("\n\n").slice(0, MAX_SITE_TEXT);

  return {
    sourceUrl: home.sourceUrl,
    title: home.title,
    text,
    wordCount: text.split(/\s+/).filter(Boolean).length,
    pages: pages.map((page) => ({
      sourceUrl: page.sourceUrl,
      title: page.title,
      wordCount: page.wordCount,
    })),
  };
}
