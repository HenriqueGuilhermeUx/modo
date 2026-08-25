const API_URL = (import.meta.env.VITE_API_URL || "http://localhost:4000").replace(/\/$/, "");

async function request(path: string, body: Record<string, unknown>) {
  const response = await fetch(`${API_URL}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.message || "Não foi possível concluir a recuperação de senha.");
  }
  return payload as Record<string, unknown>;
}

export async function requestPasswordReset(email: string, mode: "business" | "agency") {
  await request("/api/v1/auth/password/forgot", { email, mode });
}

export async function resetPassword(token: string, password: string) {
  await request("/api/v1/auth/password/reset", { token, password });
}
