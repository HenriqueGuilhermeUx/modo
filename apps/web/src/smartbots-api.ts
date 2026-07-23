import {
  SmartBotsIntakeListSchema,
  SmartBotsIntakePayloadSchema,
  SmartBotsIntakeSchema,
  type SmartBotsIntakePayload,
  type SmartBotsIntakeStatus,
} from "@modo/contracts/smartbots";
import { getSessionToken } from "./api";
import { getAdminToken } from "./admin-api";

const API_URL = (import.meta.env.VITE_API_URL || "http://localhost:4000").replace(/\/$/, "");

async function request(path: string, token: string, init?: RequestInit) {
  const response = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...init?.headers,
    },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.message || "Não foi possível concluir a solicitação SmartBots.");
  return payload;
}

export async function getSmartBotsIntake() {
  const payload = await request("/api/v1/smartbots/intake", getSessionToken());
  return {
    eligible: Boolean(payload.eligible),
    requiredPlan: String(payload.requiredPlan || "presenca"),
    intake: payload.intake ? SmartBotsIntakeSchema.parse(payload.intake) : null,
  };
}

export async function submitSmartBotsIntake(input: SmartBotsIntakePayload) {
  return SmartBotsIntakeSchema.parse(
    await request("/api/v1/smartbots/intake", getSessionToken(), {
      method: "POST",
      body: JSON.stringify(SmartBotsIntakePayloadSchema.parse(input)),
    }),
  );
}

export async function listAdminSmartBotsIntakes() {
  return SmartBotsIntakeListSchema.parse(
    await request("/api/v1/admin/smartbots-intakes", getAdminToken()),
  ).intakes;
}

export async function updateAdminSmartBotsStatus(
  id: string,
  status: SmartBotsIntakeStatus,
  providerMessage = "",
) {
  return SmartBotsIntakeSchema.parse(
    await request(`/api/v1/admin/smartbots-intakes/${id}/status`, getAdminToken(), {
      method: "PATCH",
      body: JSON.stringify({ status, providerMessage }),
    }),
  );
}
