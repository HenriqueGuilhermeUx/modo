import {
  AuthSessionSchema,
  BrandCreateRequestSchema,
  BrandSchema,
  DashboardSchema,
  DiagnosticJobSchema,
  LeadCreateRequestSchema,
  LoginRequestSchema,
  RegisterRequestSchema,
  type AuthSession,
  type Brand,
  type BrandCreateRequest,
  type Dashboard,
  type DiagnosticCreateRequest,
  type DiagnosticJob,
  type LeadCreateRequest,
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
import {
  WooviCheckoutRequestSchema,
  WooviCheckoutResponseSchema,
  type WooviCheckoutRequest,
  type WooviCheckoutResponse,
} from "@modo/contracts/payment";

const API_URL = (import.meta.env.VITE_API_URL || "http://localhost:4000").replace(/\/$/, "");
const TOKEN_KEY = "modo.sessionToken";

export const getSessionToken = () => window.localStorage.getItem(TOKEN_KEY) ?? "";
export const saveSessionToken = (token: string) => window.localStorage.setItem(TOKEN_KEY, token);
export const clearSessionToken = () => window.localStorage.removeItem(TOKEN_KEY);

async function request<T>(path: string, init?: RequestInit, authenticated = false): Promise<T> {
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
  if (!response.ok) {
    if (response.status === 401 && authenticated) clearSessionToken();
    throw new Error(payload.message || "Não foi possível concluir a solicitação.");
  }
  return payload as T;
}

export const createDiagnostic = (input: DiagnosticCreateRequest) =>
  request<{ id: string }>("/api/v1/diagnostics", {
    method: "POST",
    body: JSON.stringify(input),
  });

export async function getDiagnostic(id: string): Promise<DiagnosticJob> {
  return DiagnosticJobSchema.parse(await request<unknown>(`/api/v1/diagnostics/${id}`));
}

export const captureLead = (input: LeadCreateRequest) =>
  request<{ id: string; status: string }>("/api/v1/leads", {
    method: "POST",
    body: JSON.stringify(LeadCreateRequestSchema.parse(input)),
  });

export async function registerAccount(input: RegisterRequest): Promise<AuthSession> {
  const session = AuthSessionSchema.parse(
    await request<unknown>("/api/v1/auth/register", {
      method: "POST",
      body: JSON.stringify(RegisterRequestSchema.parse(input)),
    }),
  );
  saveSessionToken(session.token);
  return session;
}

export async function loginAccount(input: LoginRequest): Promise<AuthSession> {
  const session = AuthSessionSchema.parse(
    await request<unknown>("/api/v1/auth/login", {
      method: "POST",
      body: JSON.stringify(LoginRequestSchema.parse(input)),
    }),
  );
  saveSessionToken(session.token);
  return session;
}

export async function getDashboard(): Promise<Dashboard> {
  return DashboardSchema.parse(await request<unknown>("/api/v1/dashboard", undefined, true));
}

export async function createBrand(input: BrandCreateRequest): Promise<Brand> {
  return BrandSchema.parse(
    await request<unknown>(
      "/api/v1/brands",
      {
        method: "POST",
        body: JSON.stringify(BrandCreateRequestSchema.parse(input)),
      },
      true,
    ),
  );
}

export async function listContentRequests(): Promise<ContentRequest[]> {
  return ContentRequestListSchema.parse(
    await request<unknown>("/api/v1/content-requests", undefined, true),
  ).requests;
}

export async function createContentRequest(input: ContentRequestCreate) {
  const payload = await request<{ request: unknown; usage: Dashboard["usage"] }>(
    "/api/v1/content-requests",
    {
      method: "POST",
      body: JSON.stringify(ContentRequestCreateSchema.parse(input)),
    },
    true,
  );
  return {
    request: ContentRequestSchema.parse(payload.request),
    usage: payload.usage,
  };
}

export async function createWooviCheckout(
  input: WooviCheckoutRequest,
): Promise<WooviCheckoutResponse> {
  return WooviCheckoutResponseSchema.parse(
    await request<unknown>(
      "/api/v1/payments/checkout",
      {
        method: "POST",
        body: JSON.stringify(WooviCheckoutRequestSchema.parse(input)),
      },
      true,
    ),
  );
}

export async function cancelWooviSubscription() {
  return request<{ canceled: boolean; providerId: string; usage: Dashboard["usage"] }>(
    "/api/v1/payments/cancel",
    { method: "POST" },
    true,
  );
}

export async function logoutAccount() {
  await request<void>("/api/v1/auth/logout", { method: "POST" }, true).catch(() => undefined);
  clearSessionToken();
}
