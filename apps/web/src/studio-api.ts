import {
  ContentOutputUpdateSchema,
  ContentRequestSchema,
  type ContentOutputUpdate,
  type ContentRequest,
} from "@modo/contracts/content";
import { getSessionToken } from "./api";

const API_URL = (import.meta.env.VITE_API_URL || "http://localhost:4000").replace(/\/$/, "");

export async function saveStudioOutput(id: string, output: ContentOutputUpdate): Promise<ContentRequest> {
  const response = await fetch(`${API_URL}/api/v1/content-requests/${id}/output`, {
    method: "PATCH",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${getSessionToken()}`,
    },
    body: JSON.stringify(ContentOutputUpdateSchema.parse(output)),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.message || "Não foi possível salvar o conteúdo no Studio.");
  return ContentRequestSchema.parse(payload);
}
