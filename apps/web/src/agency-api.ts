import type { ContentRequest } from "@modo/contracts/content";
import { getSessionToken } from "./api";

const API_URL = (import.meta.env.VITE_API_URL || "http://localhost:4000").replace(/\/$/, "");

async function parse<T>(response: Response): Promise<T> {
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.message || "Não foi possível concluir a solicitação.");
  return payload as T;
}

export type AgencyApprovalLink = {
  brandId: string;
  brandName: string;
  approvalUrl: string;
  expiresAt: string;
};

export type AgencyApprovalItem = Pick<
  ContentRequest,
  | "id"
  | "contentType"
  | "objective"
  | "brief"
  | "channel"
  | "status"
  | "revisionCount"
  | "maxRevisions"
  | "revisionInstructions"
  | "output"
  | "approvedAt"
  | "createdAt"
  | "updatedAt"
>;

export type AgencyApprovalPortal = {
  brand: { id: string; name: string };
  expiresAt: string;
  items: AgencyApprovalItem[];
};

export async function createAgencyApprovalLink(brandId: string): Promise<AgencyApprovalLink> {
  const response = await fetch(`${API_URL}/api/v1/agency/brands/${encodeURIComponent(brandId)}/approval-links`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${getSessionToken()}`,
    },
  });
  return parse<AgencyApprovalLink>(response);
}

export async function getAgencyApprovalPortal(token: string): Promise<AgencyApprovalPortal> {
  const response = await fetch(`${API_URL}/api/v1/agency/approvals/${encodeURIComponent(token)}`);
  return parse<AgencyApprovalPortal>(response);
}

export async function approveAgencyContent(token: string, contentId: string): Promise<AgencyApprovalItem> {
  const response = await fetch(`${API_URL}/api/v1/agency/approvals/${encodeURIComponent(token)}/content/${encodeURIComponent(contentId)}/approve`, {
    method: "POST",
    headers: { "content-type": "application/json" },
  });
  return parse<AgencyApprovalItem>(response);
}

export async function requestAgencyContentRevision(token: string, contentId: string, instructions: string): Promise<AgencyApprovalItem> {
  const response = await fetch(`${API_URL}/api/v1/agency/approvals/${encodeURIComponent(token)}/content/${encodeURIComponent(contentId)}/revision`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ instructions }),
  });
  return parse<AgencyApprovalItem>(response);
}
