import {
  DistributionQualityReportSchema,
  type DistributionQualityReport,
} from "@modo/contracts/distribution-quality";
import {
  PostizAnalyticsSummarySchema,
  PostizClaimRequestSchema,
  PostizClaimResponseSchema,
  PostizConnectRequestSchema,
  PostizConnectResponseSchema,
  PostizPublicationListSchema,
  PostizPublicationSchema,
  PostizPublishRequestSchema,
  PostizStatusSchema,
  type PostizAnalyticsSummary,
  type PostizClaimResponse,
  type PostizConnectRequest,
  type PostizConnectResponse,
  type PostizPublication,
  type PostizPublishRequest,
  type PostizStatus,
} from "@modo/contracts/postiz";
import { getSessionToken } from "./api";

const API_URL = (import.meta.env.VITE_API_URL || "http://localhost:4000").replace(/\/$/, "");

async function request<T>(path: string, init?: RequestInit): Promise<T> {
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
  if (!response.ok) {
    throw new Error(payload.message || "Não foi possível concluir a operação de distribuição.");
  }
  return payload as T;
}

export async function getDistributionStatus(brandId: string): Promise<PostizStatus> {
  return PostizStatusSchema.parse(
    await request<unknown>(`/api/v1/distribution/status?brandId=${encodeURIComponent(brandId)}`),
  );
}

export async function getDistributionQuality(contentRequestId: string): Promise<DistributionQualityReport> {
  return DistributionQualityReportSchema.parse(
    await request<unknown>(`/api/v1/content-requests/${contentRequestId}/distribution/quality`),
  );
}

export async function startDistributionConnection(
  input: PostizConnectRequest,
): Promise<PostizConnectResponse> {
  return PostizConnectResponseSchema.parse(
    await request<unknown>("/api/v1/distribution/connections", {
      method: "POST",
      body: JSON.stringify(PostizConnectRequestSchema.parse(input)),
    }),
  );
}

export async function claimDistributionConnection(pendingId: string): Promise<PostizClaimResponse> {
  const input = PostizClaimRequestSchema.parse({ pendingId });
  return PostizClaimResponseSchema.parse(
    await request<unknown>("/api/v1/distribution/connections/claim", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  );
}

export async function disconnectDistributionIntegration(id: string) {
  return request<{ disconnected: boolean }>(
    `/api/v1/distribution/integrations/${encodeURIComponent(id)}`,
    { method: "DELETE" },
  );
}

export async function distributeContent(
  contentRequestId: string,
  input: PostizPublishRequest,
): Promise<{ publications: PostizPublication[]; quality: DistributionQualityReport }> {
  const payload = await request<{ publications: unknown[]; quality: unknown }>(
    `/api/v1/content-requests/${contentRequestId}/distribute`,
    {
      method: "POST",
      body: JSON.stringify(PostizPublishRequestSchema.parse(input)),
    },
  );
  return {
    publications: payload.publications.map((item) => PostizPublicationSchema.parse(item)),
    quality: DistributionQualityReportSchema.parse(payload.quality),
  };
}

export async function listContentPublications(contentRequestId: string): Promise<PostizPublication[]> {
  return PostizPublicationListSchema.parse(
    await request<unknown>(`/api/v1/content-requests/${contentRequestId}/publications`),
  ).publications;
}

export async function refreshPublicationAnalytics(
  publicationId: string,
  days = 30,
): Promise<{ publication: PostizPublication; summary: PostizAnalyticsSummary }> {
  const payload = await request<{ publication: unknown; summary: unknown }>(
    `/api/v1/publications/${publicationId}/analytics/refresh`,
    { method: "POST", body: JSON.stringify({ days }) },
  );
  return {
    publication: PostizPublicationSchema.parse(payload.publication),
    summary: PostizAnalyticsSummarySchema.parse(payload.summary),
  };
}

export async function getDistributionInsights(brandId: string) {
  return request<{
    samples: number;
    averageScore: number;
    bestScore: number;
    signal: "insufficient_data" | "strong" | "weak" | "learning";
  }>(`/api/v1/brands/${brandId}/distribution/insights`);
}
