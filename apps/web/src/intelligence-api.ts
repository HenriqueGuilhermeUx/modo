import {
  IntelligenceMissionCreateSchema,
  IntelligenceMissionListSchema,
  IntelligenceMissionSchema,
  IntelligenceProviderSchema,
  intelligencePlaybookCatalog,
  type IntelligenceMissionCreate,
  type IntelligencePlaybook,
} from "@modo/contracts/intelligence";
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
  if (!response.ok) throw new Error(payload.message || "Não foi possível concluir a missão de inteligência.");
  return payload;
}

export async function getIntelligencePlaybooks() {
  const payload = await request("/api/v1/intelligence/playbooks");
  return {
    provider: IntelligenceProviderSchema.parse(payload.provider),
    configured: payload.configured as Record<IntelligencePlaybook, boolean>,
    playbooks: payload.playbooks || intelligencePlaybookCatalog,
  };
}

export async function listIntelligenceMissions() {
  return IntelligenceMissionListSchema.parse(
    await request("/api/v1/intelligence/missions"),
  ).missions;
}

export async function createIntelligenceMission(input: IntelligenceMissionCreate) {
  return IntelligenceMissionSchema.parse(
    await request("/api/v1/intelligence/missions", {
      method: "POST",
      body: JSON.stringify(IntelligenceMissionCreateSchema.parse(input)),
    }),
  );
}

export async function getIntelligenceMission(id: string) {
  return IntelligenceMissionSchema.parse(
    await request(`/api/v1/intelligence/missions/${id}`),
  );
}

export async function retryIntelligenceMission(id: string) {
  return IntelligenceMissionSchema.parse(
    await request(`/api/v1/intelligence/missions/${id}/retry`, { method: "POST" }),
  );
}

export async function getIntelligenceResults(id: string, limit = 100) {
  const payload = await request(`/api/v1/intelligence/missions/${id}/results?limit=${limit}`);
  return {
    mission: IntelligenceMissionSchema.parse(payload.mission),
    items: Array.isArray(payload.items) ? payload.items as Record<string, unknown>[] : [],
  };
}
