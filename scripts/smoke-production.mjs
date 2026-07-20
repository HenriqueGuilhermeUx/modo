const apiUrl = (process.env.MODO_API_URL || "https://modo-api-3m10.onrender.com").replace(/\/$/, "");
const adminEmail = process.env.MODO_ADMIN_EMAIL || "";
const adminPassword = process.env.MODO_ADMIN_PASSWORD || "";

async function request(path, init) {
  const response = await fetch(`${apiUrl}${path}`, init);
  const text = await response.text();
  let payload = {};
  try { payload = text ? JSON.parse(text) : {}; } catch { payload = { raw: text }; }
  if (!response.ok) {
    throw new Error(`${init?.method || "GET"} ${path} -> ${response.status}: ${payload.message || text}`);
  }
  return payload;
}

function check(condition, message) {
  if (!condition) throw new Error(message);
  console.log(`✓ ${message}`);
}

console.log(`MODO production smoke: ${apiUrl}`);
const health = await request("/health");
check(health.status === "ok", "API saudável");
check(health.version === "0.9.0", `versão 0.9.0 ativa (${health.version})`);
check(health.contentProvider === "n8n", `produção de conteúdo via n8n (${health.contentProvider})`);
check(health.accountStorage === "postgres", "contas em PostgreSQL");
check(health.billingStorage === "postgres", "billing em PostgreSQL");
check(health.contentStorage === "postgres", "conteúdo em PostgreSQL");
check(health.platformAdmin === "enabled", "painel administrativo habilitado");

if (!adminEmail || !adminPassword) {
  console.log("• Admin não testado: defina MODO_ADMIN_EMAIL e MODO_ADMIN_PASSWORD somente no terminal local.");
  process.exit(0);
}

const session = await request("/api/v1/admin/login", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ email: adminEmail, password: adminPassword }),
});
check(Boolean(session.token), "login administrativo");
const headers = { authorization: `Bearer ${session.token}`, "content-type": "application/json" };
const overview = await request("/api/v1/admin/overview", { headers });
check(Number.isInteger(overview.organizations), "overview administrativo");
const organizations = await request("/api/v1/admin/organizations", { headers });
check(Array.isArray(organizations.organizations), "listagem de organizações");
const invitations = await request("/api/v1/admin/invitations", { headers });
check(Array.isArray(invitations.invitations), "listagem de convites");
const discounts = await request("/api/v1/admin/discounts", { headers });
check(Array.isArray(discounts.campaigns), "listagem de campanhas de desconto");
await request("/api/v1/admin/logout", { method: "POST", headers });
check(true, "logout administrativo");
console.log("\nSmoke test concluído sem alterações de dados.");
