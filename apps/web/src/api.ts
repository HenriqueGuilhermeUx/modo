import { DiagnosticJobSchema, LeadCreateRequestSchema, type DiagnosticCreateRequest, type DiagnosticJob, type LeadCreateRequest } from "@modo/contracts";

const API_URL = (import.meta.env.VITE_API_URL || "http://localhost:4000").replace(/\/$/, "");

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, {...init, headers: {"content-type": "application/json", ...init?.headers}});
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.message || "Não foi possível concluir a solicitação.");
  return payload as T;
}

export const createDiagnostic = (input: DiagnosticCreateRequest) => request<{id: string}>("/api/v1/diagnostics", {method: "POST", body: JSON.stringify(input)});
export async function getDiagnostic(id: string): Promise<DiagnosticJob> { return DiagnosticJobSchema.parse(await request<unknown>(`/api/v1/diagnostics/${id}`)); }
export const captureLead = (input: LeadCreateRequest) => request<{id: string; status: string}>("/api/v1/leads", {method: "POST", body: JSON.stringify(LeadCreateRequestSchema.parse(input))});
