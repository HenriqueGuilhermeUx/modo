import { InstagramConnectResponseSchema, InstagramConnectionStatusSchema, InstagramPublicationSchema, type InstagramConnectRequest, type InstagramPublication } from "@modo/contracts/instagram";
import { getSessionToken } from "./api";

const API_URL = (import.meta.env.VITE_API_URL || "http://localhost:4000").replace(/\/$/, "");
async function request(path: string, init?: RequestInit) {
  const headers = new Headers(init?.headers);
  headers.set("authorization", `Bearer ${getSessionToken()}`);
  if (init?.body) headers.set("content-type", "application/json");
  const response = await fetch(`${API_URL}${path}`, { ...init, headers });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.message || "Não foi possível concluir a operação no Instagram.");
  return payload;
}
export async function getInstagramStatus() { return InstagramConnectionStatusSchema.parse(await request("/api/v1/instagram/status")) }
export async function connectInstagram(input: InstagramConnectRequest = {}) {
  return InstagramConnectResponseSchema.parse(await request("/api/v1/instagram/connect", { method: "POST", body: JSON.stringify(input) }));
}
export async function disconnectInstagram() { return request("/api/v1/instagram/disconnect", { method: "POST", body: JSON.stringify({}) }) }
export async function publishToInstagram(contentRequestId: string): Promise<InstagramPublication> {
  const payload = await request(`/api/v1/content-requests/${encodeURIComponent(contentRequestId)}/publish-instagram`, { method: "POST", body: JSON.stringify({}) }) as { publication?: unknown };
  return InstagramPublicationSchema.parse(payload.publication);
}
