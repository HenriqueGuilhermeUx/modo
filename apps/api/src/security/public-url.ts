import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

const forbiddenHostnames = new Set(["localhost", "localhost.localdomain", "0.0.0.0", "::1"]);

function isPrivateIpv4(hostname: string): boolean {
  const parts = hostname.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => Number.isNaN(part))) return false;
  const [a, b] = parts;
  return a === 10 || a === 127 || (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127);
}

function isPrivateIpv6(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  return normalized === "::1" || normalized.startsWith("fc") || normalized.startsWith("fd") ||
    normalized.startsWith("fe80") || normalized.startsWith("::ffff:127.") ||
    normalized.startsWith("::ffff:10.") || normalized.startsWith("::ffff:192.168.");
}

function assertPublicAddress(address: string) {
  const version = isIP(address);
  if ((version === 4 && isPrivateIpv4(address)) || (version === 6 && isPrivateIpv6(address))) {
    throw new Error("Endereços locais ou privados não são permitidos.");
  }
}

export function assertPublicHttpUrl(rawUrl: string): URL {
  const url = new URL(rawUrl);
  if (!["http:", "https:"].includes(url.protocol)) throw new Error("A URL deve usar HTTP ou HTTPS.");
  if (url.username || url.password) throw new Error("URLs com credenciais não são permitidas.");

  const hostname = url.hostname.toLowerCase().replace(/\.$/, "");
  if (forbiddenHostnames.has(hostname) || hostname.endsWith(".local") || hostname.endsWith(".internal")) {
    throw new Error("Endereços locais ou internos não são permitidos.");
  }

  if (isIP(hostname)) assertPublicAddress(hostname);
  return url;
}

export async function assertResolvedPublicHttpUrl(rawUrl: string): Promise<URL> {
  const url = assertPublicHttpUrl(rawUrl);
  if (!isIP(url.hostname)) {
    const addresses = await lookup(url.hostname, { all: true, verbatim: true });
    if (!addresses.length) throw new Error("Não foi possível localizar esse endereço.");
    for (const item of addresses) assertPublicAddress(item.address);
  }
  return url;
}
