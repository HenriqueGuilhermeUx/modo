import {
  CreativePlanSchema,
  CreativeProfileSchema,
  CreativeRecommendationListSchema,
  CreativeRecommendationSchema,
  type CreativeFeedback,
  type CreativeProfile,
  type CreativeProfileUpsert,
  type CreativeRecommendation,
} from "@modo/contracts/creative-intelligence";
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

export async function getCreativeProfile(brandId: string): Promise<CreativeProfile> {
  return CreativeProfileSchema.parse(await request(`/api/v1/director/profile/${brandId}`));
}

export async function saveCreativeProfile(input: CreativeProfileUpsert): Promise<CreativeProfile> {
  return CreativeProfileSchema.parse(
    await request(`/api/v1/director/profile/${input.brandId}`, {
      method: "PUT",
      body: JSON.stringify(input),
    }),
  );
}

export async function generateCreativePlan(brandId: string) {
  return CreativePlanSchema.parse(
    await request(`/api/v1/director/plan/${brandId}`, { method: "POST" }),
  );
}

export async function listCreativeRecommendations(brandId: string) {
  return CreativeRecommendationListSchema.parse(
    await request(`/api/v1/director/recommendations/${brandId}`),
  ).recommendations;
}

export async function setCreativeRecommendationStatus(
  id: string,
  status: CreativeRecommendation["status"],
) {
  return CreativeRecommendationSchema.parse(
    await request(`/api/v1/director/recommendations/${id}/status`, {
      method: "POST",
      body: JSON.stringify({ status }),
    }),
  );
}

export async function recordCreativeFeedback(brandId: string, feedback: CreativeFeedback) {
  return request(`/api/v1/director/feedback/${brandId}`, {
    method: "POST",
    body: JSON.stringify(feedback),
  });
}
