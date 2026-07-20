import { AuthSessionSchema, type PlanSlug, type SubscriptionStatus } from "@modo/contracts";
import {
  AdminDiscountCampaignCreateSchema,
  AdminDiscountCampaignListSchema,
  AdminDiscountCampaignSchema,
  AdminInvitationCreateSchema,
  AdminInvitationListSchema,
  AdminInvitationSchema,
  AdminLoginRequestSchema,
  AdminOrganizationListSchema,
  AdminOverviewSchema,
  AdminSessionSchema,
  InvitationAcceptRequestSchema,
  InvitationPreviewSchema,
  type AdminCreditAdjustment,
  type AdminDiscountCampaignCreate,
  type AdminInvitationCreate,
  type AdminSession,
  type AdminSubscriptionUpdate,
  type InvitationAcceptRequest,
} from "@modo/contracts/admin";
import { saveSessionToken } from "./api";

const API_URL = (import.meta.env.VITE_API_URL || "http://localhost:4000").replace(/\/$/, "");
const ADMIN_TOKEN_KEY = "modo.platformAdminToken";

export const getAdminToken = () => window.localStorage.getItem(ADMIN_TOKEN_KEY) ?? "";
export const saveAdminToken = (token: string) => window.localStorage.setItem(ADMIN_TOKEN_KEY, token);
export const clearAdminToken = () => window.localStorage.removeItem(ADMIN_TOKEN_KEY);

async function request<T>(path: string, init?: RequestInit, authenticated = true): Promise<T> {
  const token = authenticated ? getAdminToken() : "";
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
    if (response.status === 401 && authenticated) clearAdminToken();
    throw new Error(payload.message || "Não foi possível concluir a operação administrativa.");
  }
  return payload as T;
}

export async function loginAdmin(email: string, password: string): Promise<AdminSession> {
  const input = AdminLoginRequestSchema.parse({ email, password });
  const session = AdminSessionSchema.parse(
    await request<unknown>("/api/v1/admin/login", {
      method: "POST",
      body: JSON.stringify(input),
    }, false),
  );
  saveAdminToken(session.token);
  return session;
}

export async function logoutAdmin() {
  await request<void>("/api/v1/admin/logout", { method: "POST" }).catch(() => undefined);
  clearAdminToken();
}

export async function getAdminMe() {
  return request<{ admin: AdminSession["admin"] }>("/api/v1/admin/me");
}

export async function getAdminOverview() {
  return AdminOverviewSchema.parse(await request<unknown>("/api/v1/admin/overview"));
}

export async function listAdminOrganizations() {
  return AdminOrganizationListSchema.parse(
    await request<unknown>("/api/v1/admin/organizations"),
  ).organizations;
}

export async function adjustOrganizationCredits(id: string, input: AdminCreditAdjustment) {
  return request<{ adjusted: boolean; usage: unknown }>(
    `/api/v1/admin/organizations/${id}/credits`,
    { method: "POST", body: JSON.stringify(input) },
  );
}

export async function updateOrganizationSubscription(
  id: string,
  input: AdminSubscriptionUpdate,
) {
  return request<{ usage: unknown }>(
    `/api/v1/admin/organizations/${id}/subscription`,
    { method: "PATCH", body: JSON.stringify(input) },
  );
}

export async function listAdminInvitations() {
  return AdminInvitationListSchema.parse(
    await request<unknown>("/api/v1/admin/invitations"),
  ).invitations;
}

export async function createAdminInvitation(input: AdminInvitationCreate) {
  return AdminInvitationSchema.parse(
    await request<unknown>("/api/v1/admin/invitations", {
      method: "POST",
      body: JSON.stringify(AdminInvitationCreateSchema.parse(input)),
    }),
  );
}

export async function revokeAdminInvitation(id: string) {
  return AdminInvitationSchema.parse(
    await request<unknown>(`/api/v1/admin/invitations/${id}/revoke`, { method: "POST" }),
  );
}

export async function listAdminDiscounts() {
  return AdminDiscountCampaignListSchema.parse(
    await request<unknown>("/api/v1/admin/discounts"),
  ).campaigns;
}

export async function createAdminDiscount(input: AdminDiscountCampaignCreate) {
  return AdminDiscountCampaignSchema.parse(
    await request<unknown>("/api/v1/admin/discounts", {
      method: "POST",
      body: JSON.stringify(AdminDiscountCampaignCreateSchema.parse(input)),
    }),
  );
}

export async function setAdminDiscountActive(id: string, active: boolean) {
  return AdminDiscountCampaignSchema.parse(
    await request<unknown>(`/api/v1/admin/discounts/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ active }),
    }),
  );
}

export async function previewInvitation(token: string) {
  return InvitationPreviewSchema.parse(
    await request<unknown>(`/api/v1/invitations/${encodeURIComponent(token)}`, undefined, false),
  );
}

export async function acceptInvitation(token: string, input: InvitationAcceptRequest) {
  const session = AuthSessionSchema.parse(
    await request<unknown>(`/api/v1/invitations/${encodeURIComponent(token)}/accept`, {
      method: "POST",
      body: JSON.stringify(InvitationAcceptRequestSchema.parse(input)),
    }, false),
  );
  saveSessionToken(session.token);
  return session;
}

export type OrganizationPlanUpdate = { plan?: PlanSlug; status?: SubscriptionStatus };
