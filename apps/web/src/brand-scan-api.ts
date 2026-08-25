import {
  BrandScanRequestSchema,
  BrandScanResultSchema,
  type BrandScanResult,
} from "@modo/contracts/brand-scan";
import { getSessionToken } from "./api";

const API_URL = (import.meta.env.VITE_API_URL || "http://localhost:4000").replace(/\/$/, "");

function normalizeUrl(value: string) {
  const trimmed = value.trim();
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

export async function scanBrandUrl(value: string): Promise<BrandScanResult> {
  const input = BrandScanRequestSchema.parse({ url: normalizeUrl(value) });
  const response = await fetch(`${API_URL}/api/v1/brands/scan-url`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${getSessionToken()}`,
    },
    body: JSON.stringify(input),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.message || "Não foi possível conhecer a empresa a partir deste link.");
  }
  return BrandScanResultSchema.parse(payload);
}
