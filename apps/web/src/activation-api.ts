import { getSessionToken } from "./api";

const API_URL = (import.meta.env.VITE_API_URL || "http://localhost:4000").replace(/\/$/, "");

export type ActivationEventName =
  | "onboarding_started"
  | "onboarding_completed"
  | "studio_opened"
  | "studio_saved"
  | "asset_exported";

export type ActivationSummary = {
  activated: boolean;
  progress: number;
  completedCount: number;
  totalSteps: number;
  steps: Array<{
    id: "account" | "brand" | "onboarding" | "content" | "approval" | "export";
    label: string;
    description: string;
    completed: boolean;
    completedAt: string | null;
  }>;
  nextAction: {
    label: string;
    description: string;
    path: string;
  };
  metrics: {
    brands: number;
    requests: number;
    ready: number;
    approved: number;
    failed: number;
    exports: number;
  };
};

async function activationRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const token = getSessionToken();
  const response = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...init?.headers,
    },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.message || "Não foi possível atualizar sua jornada.");
  return payload as T;
}

export function getActivationSummary() {
  return activationRequest<ActivationSummary>("/api/v1/activation-summary");
}

export function trackActivationEvent(
  event: ActivationEventName,
  metadata: Record<string, string | number | boolean | null> = {},
) {
  return activationRequest<{ event: unknown }>("/api/v1/activation-events", {
    method: "POST",
    body: JSON.stringify({ event, metadata }),
  });
}
