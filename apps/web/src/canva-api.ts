import { getSessionToken } from "./api";
const API_URL = (import.meta.env.VITE_API_URL || "http://localhost:4000").replace(/\/$/, "");
export interface CanvaStatus { provider: "canva"; integrationConfigured: boolean; connected: boolean; expiresAt: string | null; scopes: string[]; message: string }
export interface CanvaDesign { provider: "canva"; contentRequestId: string; designId: string; assetId: string; editUrl: string; viewUrl: string; createdAt: string; updatedAt: string }
async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  headers.set("authorization", `Bearer ${getSessionToken()}`);
  if (init?.body) headers.set("content-type", "application/json");
  const response = await fetch(`${API_URL}${path}`, { ...init, headers });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.message || "Não foi possível concluir a operação no Canva.");
  return payload as T;
}
export function getCanvaStatus() { return request<CanvaStatus>("/api/v1/canva/status") }
export function getCanvaDesign(contentRequestId: string) { return request<{ design: CanvaDesign | null }>(`/api/v1/content-requests/${encodeURIComponent(contentRequestId)}/canva-design`) }
export function connectCanva(contentRequestId?: string) { return request<{ authorizationUrl: string }>("/api/v1/canva/connect", { method: "POST", body: JSON.stringify(contentRequestId ? { contentRequestId } : {}) }) }
export function disconnectCanva() { return request<{ disconnected: boolean }>("/api/v1/canva/disconnect", { method: "POST", body: JSON.stringify({}) }) }
export function createCanvaDesign(contentRequestId: string) { return request<{ design: CanvaDesign }>(`/api/v1/content-requests/${encodeURIComponent(contentRequestId)}/canva-design`, { method: "POST", body: JSON.stringify({}) }) }
