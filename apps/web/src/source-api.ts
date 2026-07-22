import {
  SourceExtractRequestSchema,
  SourceExtractResponseSchema,
  type SourceExtractResponse,
} from "@modo/contracts/source";
import { getSessionToken } from "./api";

const API_URL = (import.meta.env.VITE_API_URL || "http://localhost:4000").replace(/\/$/, "");

export async function extractSource(url: string): Promise<SourceExtractResponse> {
  const response = await fetch(`${API_URL}/api/v1/sources/extract`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${getSessionToken()}`,
    },
    body: JSON.stringify(SourceExtractRequestSchema.parse({ url })),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.message || "Não foi possível ler essa fonte.");
  return SourceExtractResponseSchema.parse(payload);
}
