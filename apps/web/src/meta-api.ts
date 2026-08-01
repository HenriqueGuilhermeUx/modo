import {
  MetaConnectResponseSchema,
  MetaConnectionStatusSchema,
  MetaOverviewSchema,
} from "@modo/contracts/meta";
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
  if (!response.ok) {
    throw new Error(payload.message || "Não foi possível concluir a solicitação com o Instagram.");
  }
  return payload;
}

export async function getMetaStatus() {
  return MetaConnectionStatusSchema.parse(await request("/api/v1/meta/status"));
}

export async function connectMeta() {
  return MetaConnectResponseSchema.parse(
    await request("/api/v1/meta/connect", { method: "POST" }),
  );
}

export async function disconnectMeta() {
  return request("/api/v1/meta/disconnect", { method: "POST" });
}

export async function getMetaOverview() {
  return MetaOverviewSchema.parse(await request("/api/v1/meta/overview"));
}
