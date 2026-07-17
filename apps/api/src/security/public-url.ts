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

export function assertPublicHttpUrl(rawUrl: string): URL {
  const url = new URL(rawUrl);
  if (!["http:", "https:"].includes(url.protocol)) throw new Error("A URL deve usar HTTP ou HTTPS.");
  if (url.username || url.password) throw new Error("URLs com credenciais não são permitidas.");

  const hostname = url.hostname.toLowerCase().replace(/\.$/, "");
  if (forbiddenHostnames.has(hostname) || hostname.endsWith(".local") || hostname.endsWith(".internal")) {
    throw new Error("Endereços locais ou internos não são permitidos.");
  }

  const ipVersion = isIP(hostname);
  if (ipVersion === 4 && isPrivateIpv4(hostname)) throw new Error("Endereços IP privados não são permitidos.");
  if (ipVersion === 6 && (hostname.startsWith("fc") || hostname.startsWith("fd") || hostname.startsWith("fe80"))) {
    throw new Error("Endereços IPv6 privados não são permitidos.");
  }
  return url;
}
