import {
  AuthSessionSchema,
  BrandCreateRequestSchema,
  BrandSchema,
  DashboardSchema,
  LoginRequestSchema,
  RegisterRequestSchema,
  type AuthSession,
  type Brand,
  type BrandCreateRequest,
  type Dashboard,
  type LoginRequest,
  type RegisterRequest,
} from "@modo/contracts";
import {
  ContentRequestCreateSchema,
  ContentRequestListSchema,
  ContentRequestSchema,
  type ContentRequest,
  type ContentRequestCreate,
} from "@modo/contracts/content";

const API_URL = (process.env.EXPO_PUBLIC_API_URL || "https://modo-api-3m10.onrender.com").replace(/\/$/, "");

export class MobileApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code?: string,
  ) {
    super(message);
    this.name = "MobileApiError";
  }
}

async function request<T>(path: string, init?: RequestInit, token?: string): Promise<T> {
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
    const source = payload && typeof payload === "object" ? payload as Record<string, unknown> : {};
    throw new MobileApiError(
      String(source.message || "Não foi possível concluir a solicitação."),
      response.status,
      typeof source.code === "string" ? source.code : undefined,
    );
  }
  return payload as T;
}

export async function login(input: LoginRequest): Promise<AuthSession> {
  return AuthSessionSchema.parse(await request<unknown>("/api/v1/auth/business/login", {
    method: "POST",
    body: JSON.stringify(LoginRequestSchema.parse(input)),
  }));
}

export async function register(input: RegisterRequest): Promise<AuthSession> {
  return AuthSessionSchema.parse(await request<unknown>("/api/v1/auth/business/register", {
    method: "POST",
    body: JSON.stringify(RegisterRequestSchema.parse(input)),
  }));
}

export async function logout(token: string) {
  await request<void>("/api/v1/auth/logout", { method: "POST" }, token).catch(() => undefined);
}

export async function getDashboard(token: string): Promise<Dashboard> {
  return DashboardSchema.parse(await request<unknown>("/api/v1/dashboard", undefined, token));
}

export async function createBrand(token: string, input: BrandCreateRequest): Promise<Brand> {
  return BrandSchema.parse(await request<unknown>("/api/v1/brands", {
    method: "POST",
    body: JSON.stringify(BrandCreateRequestSchema.parse(input)),
  }, token));
}

export async function listContent(token: string): Promise<ContentRequest[]> {
  return ContentRequestListSchema.parse(
    await request<unknown>("/api/v1/content-requests", undefined, token),
  ).requests;
}

export async function getContent(token: string, id: string): Promise<ContentRequest> {
  return ContentRequestSchema.parse(
    await request<unknown>(`/api/v1/content-requests/${id}`, undefined, token),
  );
}

export async function createContent(token: string, input: ContentRequestCreate) {
  const payload = await request<{ request: unknown; usage: Dashboard["usage"] }>(
    "/api/v1/content-requests",
    {
      method: "POST",
      body: JSON.stringify(ContentRequestCreateSchema.parse(input)),
    },
    token,
  );
  return {
    request: ContentRequestSchema.parse(payload.request),
    usage: payload.usage,
  };
}

export async function approveContent(token: string, id: string): Promise<ContentRequest> {
  return ContentRequestSchema.parse(
    await request<unknown>(`/api/v1/content-requests/${id}/approve`, { method: "POST" }, token),
  );
}
