import { getAdminToken } from "./admin-api";

const API_URL = (import.meta.env.VITE_API_URL || "http://localhost:4000").replace(/\/$/, "");

export type AdminSupportRequest = {
  id: string;
  organizationName: string;
  brandName: string;
  requesterName: string;
  requesterEmail: string;
  contentRequestId: string | null;
  type: string;
  context: string;
  desiredOutcome: string;
  urgency: "normal" | "priority";
  status: "requested" | "triage" | "proposal" | "in_progress" | "completed" | "declined";
  pricingStatus: "under_review" | "proposal_required" | "included" | "not_available";
  internalNotes: string;
  assignedApplicationId: string | null;
  assignedName: string | null;
  assignedRole: string | null;
  createdAt: string;
  updatedAt: string;
};

export type AdminSpecialistApplication = {
  id: string;
  name: string;
  email: string;
  whatsapp: string;
  city: string;
  primaryRole: string;
  secondaryRoles: string[];
  experienceYears: number;
  portfolioUrl: string;
  linkedinUrl: string;
  availability: string;
  engagementPreference: string;
  about: string;
  status: "received" | "under_review" | "approved" | "talent_pool" | "declined";
  internalNotes: string;
  createdAt: string;
  updatedAt: string;
};

export type AdminPartnerApplication = {
  id: string;
  name: string;
  email: string;
  whatsapp: string;
  companyName: string;
  city: string;
  websiteUrl: string;
  instagramUrl: string;
  businessType: string;
  activeClients: number;
  monthlyServiceRevenueCents: number | null;
  currentServices: string[];
  whyPartner: string;
  targetClientsWithModo: number;
  status: "received" | "under_review" | "interview" | "approved" | "waitlist" | "declined";
  internalNotes: string;
  createdAt: string;
  updatedAt: string;
};

export type HumanOperationsOverview = {
  support: Record<string, number>;
  talent: Record<string, number>;
  partners: Record<string, number>;
};

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${getAdminToken()}`,
      ...init?.headers,
    },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.message || "Não foi possível concluir a operação.");
  return payload as T;
}

export const getHumanOperationsOverview = () => request<HumanOperationsOverview>("/api/v1/admin/human-operations/overview");
export const listAdminSupportRequests = async () => (await request<{ requests: AdminSupportRequest[] }>("/api/v1/admin/human-operations/support-requests")).requests;
export const updateAdminSupportRequest = (id: string, input: Partial<Pick<AdminSupportRequest, "status" | "pricingStatus" | "internalNotes" | "assignedApplicationId">>) => request(`/api/v1/admin/human-operations/support-requests/${id}`, { method: "PATCH", body: JSON.stringify(input) });
export const listAdminSpecialistApplications = async () => (await request<{ applications: AdminSpecialistApplication[] }>("/api/v1/admin/human-operations/applications")).applications;
export const updateAdminSpecialistApplication = (id: string, input: Partial<Pick<AdminSpecialistApplication, "status" | "internalNotes">>) => request(`/api/v1/admin/human-operations/applications/${id}`, { method: "PATCH", body: JSON.stringify(input) });
export const listAdminPartnerApplications = async () => (await request<{ applications: AdminPartnerApplication[] }>("/api/v1/admin/human-operations/partner-applications")).applications;
export const updateAdminPartnerApplication = (id: string, input: Partial<Pick<AdminPartnerApplication, "status" | "internalNotes">>) => request(`/api/v1/admin/human-operations/partner-applications/${id}`, { method: "PATCH", body: JSON.stringify(input) });
