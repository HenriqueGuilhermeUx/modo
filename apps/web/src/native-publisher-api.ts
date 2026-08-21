import {
  NativeAnalyticsSnapshotSchema,
  NativeBrandInsightSchema,
  NativeCalendarItemSchema,
  NativeConnectionSchema,
  NativePublicationSchema,
  type NativeAnalyticsSnapshot,
  type NativeBrandInsight,
  type NativeCalendarItem,
  type NativeConnection,
  type NativePublication,
  type NativePublisherMode,
  type NativePublisherProvider,
} from "@modo/contracts/native-publisher";
import { z } from "zod";
import { getSessionToken } from "./api";

const API_URL = (import.meta.env.VITE_API_URL || "http://localhost:4000").replace(/\/$/, "");

async function request(path: string, init?: RequestInit) {
  const headers = new Headers(init?.headers);
  headers.set("authorization", `Bearer ${getSessionToken()}`);
  if (init?.body) headers.set("content-type", "application/json");
  const response = await fetch(`${API_URL}${path}`, { ...init, headers });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.message || "Não foi possível concluir a operação no Publisher.");
  return payload;
}

export type PublisherHealth = {
  status: string;
  provider: string;
  storage: string;
  providers: Record<NativePublisherProvider, boolean>;
  capabilities: Record<string, boolean>;
  callbacks: { instagram: string | null; facebook: string | null; threads: string | null };
};

export async function getPublisherHealth(): Promise<PublisherHealth> {
  return request("/api/v2/publisher/health");
}

export async function listNativeConnections(brandId?: string): Promise<NativeConnection[]> {
  const query = brandId ? `?brandId=${encodeURIComponent(brandId)}` : "";
  const payload = await request(`/api/v2/publisher/connections${query}`);
  return z.array(NativeConnectionSchema).parse(payload.connections);
}

export async function importInstagramConnection(brandId: string): Promise<NativeConnection> {
  const payload = await request("/api/v2/publisher/connections/instagram/import", {
    method: "POST",
    body: JSON.stringify({ brandId }),
  });
  return NativeConnectionSchema.parse(payload.connection);
}

export async function importLinkedInConnection(brandId: string): Promise<NativeConnection> {
  const payload = await request("/api/v2/publisher/connections/linkedin/import", {
    method: "POST",
    body: JSON.stringify({ brandId }),
  });
  return NativeConnectionSchema.parse(payload.connection);
}

export async function startNativeConnection(provider: "instagram" | "facebook" | "threads", brandId: string) {
  return request(`/api/v2/publisher/connect/${provider}`, {
    method: "POST",
    body: JSON.stringify({ brandId }),
  }) as Promise<{ authorizationUrl: string }>;
}

export async function getNativeQuality(contentRequestId: string) {
  return request(`/api/v2/publisher/quality/${encodeURIComponent(contentRequestId)}`) as Promise<{
    score: number;
    status: "blocked" | "recommended" | "review";
    publishAllowed: boolean;
    blockers: string[];
    warnings: string[];
    checks: Array<{ key: string; label: string; score: number; maxScore: number; status: string; message: string }>;
  }>;
}

export async function createNativePublication(input: {
  contentRequestId: string;
  brandId: string;
  provider: NativePublisherProvider;
  connectionId?: string;
  mode: NativePublisherMode;
  scheduledFor?: string;
  idempotencyKey?: string;
}): Promise<{ publication: NativePublication; quality: unknown }> {
  const payload = await request("/api/v2/publisher/publications", {
    method: "POST",
    body: JSON.stringify(input),
  });
  return { publication: NativePublicationSchema.parse(payload.publication), quality: payload.quality };
}

export async function listNativePublications(brandId?: string): Promise<NativePublication[]> {
  const query = brandId ? `?brandId=${encodeURIComponent(brandId)}` : "";
  const payload = await request(`/api/v2/publisher/publications${query}`);
  return z.array(NativePublicationSchema).parse(payload.publications);
}

export async function cancelNativePublication(id: string): Promise<NativePublication> {
  const payload = await request(`/api/v2/publisher/publications/${encodeURIComponent(id)}/cancel`, { method: "POST", body: "{}" });
  return NativePublicationSchema.parse(payload.publication);
}

export async function retryNativePublication(id: string): Promise<NativePublication> {
  const payload = await request(`/api/v2/publisher/publications/${encodeURIComponent(id)}/retry`, { method: "POST", body: "{}" });
  return NativePublicationSchema.parse(payload.publication);
}

export async function refreshNativeAnalytics(id: string): Promise<NativeAnalyticsSnapshot> {
  const payload = await request(`/api/v2/publisher/publications/${encodeURIComponent(id)}/analytics/refresh`, { method: "POST", body: "{}" });
  return NativeAnalyticsSnapshotSchema.parse(payload.snapshot);
}

export async function getNativeAnalytics(id: string): Promise<NativeAnalyticsSnapshot[]> {
  const payload = await request(`/api/v2/publisher/publications/${encodeURIComponent(id)}/analytics`);
  return z.array(NativeAnalyticsSnapshotSchema).parse(payload.snapshots);
}

export async function getNativeBrandInsight(brandId: string, days = 30): Promise<NativeBrandInsight> {
  return NativeBrandInsightSchema.parse(await request(`/api/v2/publisher/brands/${encodeURIComponent(brandId)}/insights?days=${days}`));
}

export async function getNativeCalendar(brandId: string, from?: string, to?: string): Promise<NativeCalendarItem[]> {
  const query = new URLSearchParams();
  if (from) query.set("from", from);
  if (to) query.set("to", to);
  const payload = await request(`/api/v2/publisher/brands/${encodeURIComponent(brandId)}/calendar${query.size ? `?${query}` : ""}`);
  return z.array(NativeCalendarItemSchema).parse(payload.items);
}
