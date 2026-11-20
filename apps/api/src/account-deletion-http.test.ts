import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { randomUUID } from "node:crypto";
import { createApp } from "./app.js";
import { DemoDiagnosticProvider } from "./providers/demo-diagnostic-provider.js";

const databaseUrl = process.env.MODO_DELETION_TEST_DATABASE_URL;
const suite = databaseUrl ? describe : describe.skip;

suite("privacy deletion API / full HTTP authorization with isolated PostgreSQL", () => {
  let app: Awaited<ReturnType<typeof createApp>>;
  let pool: pg.Pool;
  const createdUsers: string[] = [];
  const createdOrgs: string[] = [];
  const oldAdminEmail = process.env.PLATFORM_ADMIN_EMAIL;
  const oldAdminPassword = process.env.PLATFORM_ADMIN_PASSWORD;

  beforeAll(async () => {
    if (!databaseUrl || !/^(postgresql|postgres):\/\//.test(databaseUrl))
      throw new Error("Explicit CI PostgreSQL URL is required");
    const url = new URL(databaseUrl);
    if (!["127.0.0.1", "localhost"].includes(url.hostname) || url.pathname !== "/modo_deletion_ci")
      throw new Error("Only local dedicated modo_deletion_ci is permitted");
    process.env.PLATFORM_ADMIN_EMAIL = "privacy-admin@example.invalid";
    process.env.PLATFORM_ADMIN_PASSWORD = "LocalOnlyAdmin9-NoProduction";
    pool = new pg.Pool({ connectionString: databaseUrl });
    app = await createApp({
      provider: new DemoDiagnosticProvider(0),
      databaseUrl,
      databaseSsl: false,
      enableDemoBilling: true,
      allowedOrigins: ["http://localhost:5173"],
    });
    await app.ready();
  }, 90_000);

  afterAll(async () => {
    if (app) await app.close();
    if (pool) {
      for (const id of createdUsers) await pool.query("DELETE FROM modo_users WHERE id=$1", [id]);
      for (const id of createdOrgs) await pool.query("DELETE FROM modo_organizations WHERE id=$1", [id]);
      await pool.end();
    }
    if (oldAdminEmail === undefined) delete process.env.PLATFORM_ADMIN_EMAIL;
    else process.env.PLATFORM_ADMIN_EMAIL = oldAdminEmail;
    if (oldAdminPassword === undefined) delete process.env.PLATFORM_ADMIN_PASSWORD;
    else process.env.PLATFORM_ADMIN_PASSWORD = oldAdminPassword;
  });

  async function signUp() {
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/auth/register",
      payload: { name: "Privacy Test", organizationName: "CI isolated", email: `qa-${randomUUID()}@example.invalid`, password: "TestOnly9!NoProduction" },
    });
    expect(response.statusCode).toBe(201);
    const body = response.json();
    createdUsers.push(body.user.id);
    createdOrgs.push(body.organization.id);
    return body.token as string;
  }

  it("requires an authenticated customer token, isolates status and denies customer access to admin queue", async () => {
    const unauthorized = await app.inject({ method: "POST", url: "/api/v1/auth/account-deletion-requests", payload: {} });
    expect(unauthorized.statusCode).toBe(401);
    const missingQueue = await app.inject({ method: "GET", url: "/api/v1/admin/privacy/deletion-requests" });
    expect(missingQueue.statusCode).toBe(401);

    const first = await signUp();
    const second = await signUp();
    const initial = await app.inject({ method: "GET", url: "/api/v1/auth/account-deletion-requests/current", headers: { authorization: `Bearer ${first}` } });
    expect(initial.statusCode).toBe(200);
    expect(initial.json().request).toBeNull();

    const requested = await app.inject({ method: "POST", url: "/api/v1/auth/account-deletion-requests", headers: { authorization: `Bearer ${first}` }, payload: {} });
    expect(requested.statusCode).toBe(202);
    const ticket = requested.json();
    expect(ticket.status).toBe("pending");
    expect(ticket.requestId).toBeTruthy();

    const current = await app.inject({ method: "GET", url: "/api/v1/auth/account-deletion-requests/current", headers: { authorization: `Bearer ${first}` } });
    expect(current.statusCode).toBe(200);
    expect(current.json().request.requestId).toBe(ticket.requestId);
    const other = await app.inject({ method: "GET", url: "/api/v1/auth/account-deletion-requests/current", headers: { authorization: `Bearer ${second}` } });
    expect(other.statusCode).toBe(200);
    expect(other.json().request).toBeNull();

    const denied = await app.inject({ method: "GET", url: "/api/v1/admin/privacy/deletion-requests", headers: { authorization: `Bearer ${first}` } });
    expect(denied.statusCode).toBe(401);
  });

  it("lists only for platform admin and audits queue viewing without leaking user email", async () => {
    const login = await app.inject({
      method: "POST", url: "/api/v1/admin/login",
      payload: { email: "privacy-admin@example.invalid", password: "LocalOnlyAdmin9-NoProduction" },
    });
    expect(login.statusCode).toBe(200);
    const token = login.json().token as string;
    expect(token).toBeTruthy();

    const queue = await app.inject({
      method: "GET",
      url: "/api/v1/admin/privacy/deletion-requests",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(queue.statusCode).toBe(200);
    const requests = queue.json().requests as Array<{ requestId: string; status: string; email: string }>;
    expect(requests.length).toBeGreaterThan(0);
    expect(requests.every(item => item.status === "pending")).toBe(true);
    const audit = await pool.query<{ metadata: unknown }>(
      "SELECT metadata FROM modo_admin_audit_log WHERE action='privacy.deletion_queue_viewed' ORDER BY created_at DESC LIMIT 1",
    );
    expect(audit.rows.length).toBe(1);
    expect(JSON.stringify(audit.rows[0].metadata)).not.toContain("@example.invalid");
  });
});
