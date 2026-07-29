import {
  BrandFoundationProfileSchema,
  BrandFoundationUpsertSchema,
  ChannelMapSchema,
  ChannelMapUpsertSchema,
  HumanSupportRequestCreateSchema,
  HumanSupportRequestSchema,
  RevenueMapSchema,
  RevenueMapUpsertSchema,
  SpecialistApplicationCreateSchema,
  SpecialistApplicationSchema,
  type BrandFoundationProfile,
  type BrandFoundationUpsert,
  type ChannelMap,
  type ChannelMapUpsert,
  type HumanSupportRequest,
  type HumanSupportRequestCreate,
  type RevenueMap,
  type RevenueMapUpsert,
  type SpecialistApplication,
  type SpecialistApplicationCreate,
} from "@modo/contracts/strategy-network";
import { getSessionToken } from "./api";

const API_URL = (import.meta.env.VITE_API_URL || "http://localhost:4000").replace(/\/$/, "");

async function request<T>(path: string, init?: RequestInit, authenticated = true): Promise<T> {
  const token = authenticated ? getSessionToken() : "";
  const response = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...init?.headers,
    },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.message || "Não foi possível concluir a solicitação.");
  return payload as T;
}

export async function getBrandFoundation(brandId: string): Promise<BrandFoundationProfile | null> {
  const payload = await request<{ foundation: unknown }>(`/api/v1/brands/${brandId}/foundation`);
  return payload.foundation ? BrandFoundationProfileSchema.parse(payload.foundation) : null;
}

export async function saveBrandFoundation(input: BrandFoundationUpsert): Promise<BrandFoundationProfile> {
  const parsed = BrandFoundationUpsertSchema.parse(input);
  return BrandFoundationProfileSchema.parse(await request<unknown>(`/api/v1/brands/${input.brandId}/foundation`, {
    method: "PUT",
    body: JSON.stringify(parsed),
  }));
}

export async function getChannelMap(brandId: string): Promise<ChannelMap | null> {
  const payload = await request<{ channelMap: unknown }>(`/api/v1/brands/${brandId}/channel-map`);
  return payload.channelMap ? ChannelMapSchema.parse(payload.channelMap) : null;
}

export async function saveChannelMap(input: ChannelMapUpsert): Promise<ChannelMap> {
  const parsed = ChannelMapUpsertSchema.parse(input);
  return ChannelMapSchema.parse(await request<unknown>(`/api/v1/brands/${input.brandId}/channel-map`, {
    method: "PUT",
    body: JSON.stringify(parsed),
  }));
}

export async function getRevenueMap(brandId: string): Promise<RevenueMap | null> {
  const payload = await request<{ revenueMap: unknown }>(`/api/v1/brands/${brandId}/revenue-map`);
  return payload.revenueMap ? RevenueMapSchema.parse(payload.revenueMap) : null;
}

export async function saveRevenueMap(input: RevenueMapUpsert): Promise<RevenueMap> {
  const parsed = RevenueMapUpsertSchema.parse(input);
  return RevenueMapSchema.parse(await request<unknown>(`/api/v1/brands/${input.brandId}/revenue-map`, {
    method: "PUT",
    body: JSON.stringify(parsed),
  }));
}

export async function listHumanSupportRequests(): Promise<HumanSupportRequest[]> {
  const payload = await request<{ requests: unknown[] }>("/api/v1/human-support-requests");
  return payload.requests.map((item) => HumanSupportRequestSchema.parse(item));
}

export async function createHumanSupportRequest(input: HumanSupportRequestCreate): Promise<HumanSupportRequest> {
  return HumanSupportRequestSchema.parse(await request<unknown>("/api/v1/human-support-requests", {
    method: "POST",
    body: JSON.stringify(HumanSupportRequestCreateSchema.parse(input)),
  }));
}

export async function createSpecialistApplication(input: SpecialistApplicationCreate): Promise<SpecialistApplication> {
  return SpecialistApplicationSchema.parse(await request<unknown>("/api/v1/public/specialist-applications", {
    method: "POST",
    body: JSON.stringify(SpecialistApplicationCreateSchema.parse(input)),
  }, false));
}
