import {
  PartnerApplicationCreateSchema,
  PartnerApplicationSchema,
  type PartnerApplication,
  type PartnerApplicationCreate,
} from "@modo/contracts/strategy-network";

const API_URL = (import.meta.env.VITE_API_URL || "http://localhost:4000").replace(/\/$/, "");

export async function createPartnerApplication(input: PartnerApplicationCreate): Promise<PartnerApplication> {
  const parsed = PartnerApplicationCreateSchema.parse(input);
  const response = await fetch(`${API_URL}/api/v1/public/partner-applications`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(parsed),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.message || "Não foi possível enviar sua candidatura agora.");
  }
  return PartnerApplicationSchema.parse(payload);
}
