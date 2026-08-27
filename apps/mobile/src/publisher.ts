import {
  NativeConnectionSchema,
  NativePublicationSchema,
  type NativeConnection,
  type NativePublication,
  type NativePublisherMode,
  type NativePublisherProvider,
} from "@modo/contracts/native-publisher";

const API_URL = (process.env.EXPO_PUBLIC_API_URL || "https://modo-api-3m10.onrender.com").replace(/\/$/, "");

export class MobilePublisherError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code?: string,
  ) {
    super(message);
    this.name = "MobilePublisherError";
  }
}

async function request<T>(path: string, token: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${token}`,
      ...(init?.body ? { "content-type": "application/json" } : {}),
      ...init?.headers,
    },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const source = payload && typeof payload === "object" ? payload as Record<string, unknown> : {};
    throw new MobilePublisherError(
      String(source.message || "Não foi possível concluir a operação de publicação."),
      response.status,
      typeof source.code === "string" ? source.code : undefined,
    );
  }
  return payload as T;
}

export async function listPublisherConnections(token: string, brandId: string): Promise<NativeConnection[]> {
  const payload = await request<{ connections?: unknown[] }>(
    `/api/v2/publisher/connections?brandId=${encodeURIComponent(brandId)}`,
    token,
  );
  return (payload.connections || []).map((item) => NativeConnectionSchema.parse(item));
}

export async function startPublisherConnection(
  token: string,
  provider: NativePublisherProvider,
  brandId: string,
): Promise<string> {
  const payload = await request<{ authorizationUrl?: string }>(
    `/api/v2/publisher/connect/${provider}`,
    token,
    { method: "POST", body: JSON.stringify({ brandId }) },
  );
  if (!payload.authorizationUrl) {
    throw new MobilePublisherError("O provedor não retornou a tela de autorização.", 502);
  }
  return payload.authorizationUrl;
}

export async function createPublisherPublication(
  token: string,
  input: {
    contentRequestId: string;
    brandId: string;
    provider: NativePublisherProvider;
    connectionId: string;
    videoProjectId?: string;
    mode: NativePublisherMode;
    scheduledFor?: string | null;
    idempotencyKey?: string;
  },
): Promise<NativePublication> {
  const payload = await request<{ publication: unknown }>(
    "/api/v2/publisher/publications",
    token,
    { method: "POST", body: JSON.stringify(input) },
  );
  return NativePublicationSchema.parse(payload.publication);
}

export async function listPublisherPublications(token: string, brandId: string): Promise<NativePublication[]> {
  const payload = await request<{ publications?: unknown[] }>(
    `/api/v2/publisher/publications?brandId=${encodeURIComponent(brandId)}`,
    token,
  );
  return (payload.publications || []).map((item) => NativePublicationSchema.parse(item));
}

export async function cancelPublisherPublication(token: string, id: string): Promise<NativePublication> {
  const payload = await request<{ publication: unknown }>(
    `/api/v2/publisher/publications/${encodeURIComponent(id)}/cancel`,
    token,
    { method: "POST", body: "{}" },
  );
  return NativePublicationSchema.parse(payload.publication);
}

export async function retryPublisherPublication(token: string, id: string): Promise<NativePublication> {
  const payload = await request<{ publication: unknown }>(
    `/api/v2/publisher/publications/${encodeURIComponent(id)}/retry`,
    token,
    { method: "POST", body: "{}" },
  );
  return NativePublicationSchema.parse(payload.publication);
}
