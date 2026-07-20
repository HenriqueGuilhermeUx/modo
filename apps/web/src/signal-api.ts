import {
  PerformanceSignalCreateSchema,
  PerformanceSignalSchema,
  PerformanceSummarySchema,
  type PerformanceSignalCreate,
} from "@modo/contracts/signal";
import { getSessionToken } from "./api";

const API_URL = (import.meta.env.VITE_API_URL || "http://localhost:4000").replace(/\/$/, "");

async function request(path: string, init?: RequestInit) {
  const response = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${getSessionToken()}`,
      ...init?.headers,
    },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.message || "Não foi possível concluir a solicitação.");
  return payload;
}

export async function getPerformanceSummary(brandId: string) {
  return PerformanceSummarySchema.parse(
    await request(`/api/v1/signal/summary/${brandId}`),
  );
}

export async function recordPerformanceSignal(input: PerformanceSignalCreate) {
  return PerformanceSignalSchema.parse(
    await request("/api/v1/signal", {
      method: "POST",
      body: JSON.stringify(PerformanceSignalCreateSchema.parse(input)),
    }),
  );
}
