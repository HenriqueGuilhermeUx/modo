import {
  LinkedInConnectResponseSchema,
  LinkedInConnectionStatusSchema,
  LinkedInPublicationListSchema,
  LinkedInPublicationSchema,
  type LinkedInConnectRequest,
  type LinkedInPublication,
} from "@modo/contracts/linkedin";
import { getSessionToken } from "./api";

const API_URL = (import.meta.env.VITE_API_URL || "http://localhost:4000").replace(/\/$/, "");

async function request(path: string, init?: RequestInit) {
  const response = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${getSessionToken()}`,
      ...init?.headers,
    },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.message || "Não foi possível concluir a solicitação.");
  return payload;
}

export async function getLinkedInStatus() {
  return LinkedInConnectionStatusSchema.parse(await request("/api/v1/linkedin/status"));
}

export async function connectLinkedIn(input: LinkedInConnectRequest) {
  return LinkedInConnectResponseSchema.parse(
    await request("/api/v1/linkedin/connect", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  );
}

export async function disconnectLinkedIn() {
  return request("/api/v1/linkedin/disconnect", { method: "POST" });
}

export async function listLinkedInPublications(): Promise<LinkedInPublication[]> {
  return LinkedInPublicationListSchema.parse(
    await request("/api/v1/linkedin/publications"),
  ).publications;
}

export async function publishToLinkedIn(contentRequestId: string, scheduledFor?: string) {
  return LinkedInPublicationSchema.parse(
    await request("/api/v1/linkedin/publications", {
      method: "POST",
      body: JSON.stringify({
        contentRequestId,
        ...(scheduledFor ? { scheduledFor } : {}),
      }),
    }),
  );
}

export async function downloadLinkedInDocument(contentRequestId: string) {
  const response = await fetch(
    `${API_URL}/api/v1/linkedin/content/${contentRequestId}/document`,
    { headers: { authorization: `Bearer ${getSessionToken()}` } },
  );
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.message || "Não foi possível gerar o documento.");
  }
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `modo-linkedin-${contentRequestId}.pdf`;
  anchor.click();
  URL.revokeObjectURL(url);
}
