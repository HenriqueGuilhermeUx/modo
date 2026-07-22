import type { SourceExtractResponse } from "@modo/contracts/source";
import { assertResolvedPublicHttpUrl } from "../security/public-url.js";

const MAX_BYTES = 700_000;
const MAX_TEXT = 20_000;
const MAX_REDIRECTS = 3;

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
      .replace(/<(nav|footer|header|aside|form)[^>]*>[\s\S]*?<\/\1>/gi, " ")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(p|article|section|h1|h2|h3|li|blockquote)>/gi, "\n")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/[\t ]+/g, " ")
    .replace(/\n\s*\n+/g, "\n")
    .trim()
    .slice(0, MAX_TEXT);

  return { title: title || "Conteúdo da fonte", text };
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
      "user-agent": "MODO-Scan/1.0",
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

export async function extractPublicSource(rawUrl: string): Promise<SourceExtractResponse> {
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
  };
}
