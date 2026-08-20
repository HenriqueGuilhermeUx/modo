import { DistributionQualityReportSchema, type DistributionQualityReport } from "@modo/contracts/distribution-quality";
import {
  NativeAnalyticsSummarySchema,
  NativeCalendarSchema,
  NativeConnectionListSchema,
  NativeMetaConnectResponseSchema,
  NativePublicationListSchema,
  NativePublicationSchema,
  NativeScheduleRequestSchema,
  type NativeAnalyticsSummary,
  type NativeCalendar,
  type NativeConnection,
  type NativePublication,
  type NativeScheduleRequest,
  type NativeSocialPlatform,
} from "@modo/contracts/native-publisher";
import { getSessionToken } from "./api";

const API_URL = (import.meta.env.VITE_API_URL || "http://localhost:4000").replace(/\/$/, "");

async function request(path: string, init?: RequestInit) {
  const token = getSessionToken();
  const headers = new Headers(init?.headers);
  if (token) headers.set("authorization", `Bearer ${token}`);
  if (init?.body) headers.set("content-type", "application/json");
  const response = await fetch(`${API_URL}${path}`, { ...init, headers });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.message || "Não foi possível concluir a operação no Publisher.");
  return payload;
}

export async function listNativeConnections(brandId?: string): Promise<NativeConnection[]> {
  const query = brandId ? `?brandId=${encodeURIComponent(brandId)}` : "";
  return NativeConnectionListSchema.parse(
    await request(`/api/v1/native-publisher/connections${query}`),
  ).connections;
}

export async function getNativeQuality(contentRequestId: string): Promise<DistributionQualityReport> {
  return DistributionQualityReportSchema.parse(
    await request(`/api/v1/native-publisher/content/${encodeURIComponent(contentRequestId)}/quality`),
  );
}

export async function connectNativeMeta(platform: "facebook" | "threads", brandId: string) {
  return NativeMetaConnectResponseSchema.parse(
    await request(`/api/v1/native-publisher/${platform}/connect`, {
      method: "POST",
      body: JSON.stringify({ brandId }),
    }),
  );
}

export async function listFacebookCandidates(selectionId: string) {
  const payload = await request(
    `/api/v1/native-publisher/facebook/candidates?selection=${encodeURIComponent(selectionId)}`,
  ) as { pages?: Array<{ id?: string; name?: string; pictureUrl?: string | null }> };
  return (payload.pages || []).map((page) => ({
    id: String(page.id || ""),
    name: String(page.name || "Página do Facebook"),
    pictureUrl: page.pictureUrl || null,
  })).filter((page) => page.id);
}

export async function selectFacebookPage(selectionId: string, pageId: string) {
  return request("/api/v1/native-publisher/facebook/select", {
    method: "POST",
    body: JSON.stringify({ selectionId, pageId }),
  });
}

export async function disconnectNativeChannel(brandId: string, platform: NativeSocialPlatform) {
  return request("/api/v1/native-publisher/disconnect", {
    method: "POST",
    body: JSON.stringify({ brandId, platform }),
  });
}

export async function createNativePublication(input: NativeScheduleRequest): Promise<{
  publication: NativePublication;
  quality: DistributionQualityReport;
}> {
  const payload = await request("/api/v1/native-publisher/publications", {
    method: "POST",
    body: JSON.stringify(NativeScheduleRequestSchema.parse(input)),
  }) as { publication?: unknown; quality?: unknown };
  return {
    publication: NativePublicationSchema.parse(payload.publication),
    quality: DistributionQualityReportSchema.parse(payload.quality),
  };
}

export async function listNativePublications(filters: {
  brandId?: string;
  from?: string;
  to?: string;
} = {}): Promise<NativePublication[]> {
  const params = new URLSearchParams();
  if (filters.brandId) params.set("brandId", filters.brandId);
  if (filters.from) params.set("from", filters.from);
  if (filters.to) params.set("to", filters.to);
  const suffix = params.size ? `?${params.toString()}` : "";
  return NativePublicationListSchema.parse(
    await request(`/api/v1/native-publisher/publications${suffix}`),
  ).publications;
}

export async function cancelNativePublication(id: string) {
  const payload = await request(`/api/v1/native-publisher/publications/${encodeURIComponent(id)}/cancel`, {
    method: "POST",
  }) as { publication?: unknown };
  return payload.publication ? NativePublicationSchema.parse(payload.publication) : null;
}

export async function retryNativePublication(id: string) {
  return NativePublicationSchema.parse(
    await request(`/api/v1/native-publisher/publications/${encodeURIComponent(id)}/retry`, {
      method: "POST",
    }),
  );
}

export async function refreshNativeAnalytics(id: string): Promise<NativeAnalyticsSummary> {
  return NativeAnalyticsSummarySchema.parse(
    await request(`/api/v1/native-publisher/publications/${encodeURIComponent(id)}/analytics/refresh`, {
      method: "POST",
    }),
  );
}

export async function getNativeBrandInsights(brandId: string) {
  return request(`/api/v1/native-publisher/brands/${encodeURIComponent(brandId)}/insights`) as Promise<{
    samples: number;
    averageScore: number;
    bestScore: number;
    signal: "insufficient_data" | "strong" | "weak" | "learning";
  }>;
}

export async function getNativeCalendar(filters: {
  brandId?: string;
  from?: string;
  to?: string;
} = {}): Promise<NativeCalendar> {
  const params = new URLSearchParams();
  if (filters.brandId) params.set("brandId", filters.brandId);
  if (filters.from) params.set("from", filters.from);
  if (filters.to) params.set("to", filters.to);
  const suffix = params.size ? `?${params.toString()}` : "";
  return NativeCalendarSchema.parse(
    await request(`/api/v1/native-publisher/calendar${suffix}`),
  );
}
