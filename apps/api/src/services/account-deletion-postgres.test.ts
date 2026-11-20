import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { randomUUID } from "node:crypto";
import { AuthService } from "./auth-service.js";

// Dedicated CI PostgreSQL container only. Never point at a production database.
const databaseUrl = process.env.MODO_DELETION_TEST_DATABASE_URL;
const suite = databaseUrl ? describe : describe.skip;

suite("account deletion intake / PostgreSQL isolation", () => {
  let auth: AuthService;
  let second: AuthService;
  let pool: pg.Pool;
  const createdUsers: string[] = [];
  const createdOrgs: string[] = [];

  beforeAll(async () => {
    if (!databaseUrl || !/^(postgresql|postgres):\/\//.test(databaseUrl))
      throw new Error("Explicit CI PostgreSQL URL required");
    // Block accidental connection to non-local or non-test databases.
    const url = new URL(databaseUrl);
    if (!["127.0.0.1", "localhost"].includes(url.hostname) || url.pathname !== "/modo_deletion_ci")
      throw new Error("Only local dedicated modo_deletion_ci may be used");
    auth = new AuthService({ databaseUrl, databaseSsl: false });
    second = new AuthService({ databaseUrl, databaseSsl: false });
    pool = new pg.Pool({ connectionString: databaseUrl });
    await auth.initialize();
    await second.initialize();
  });

  afterAll(async () => {
    if (pool) {
      for (const id of createdUsers) await pool.query("DELETE FROM modo_users WHERE id=$1", [id]);
      for (const id of createdOrgs) await pool.query("DELETE FROM modo_organizations WHERE id=$1", [id]);
      await pool.end();
    }
    if (second) await second.close();
    if (auth) await auth.close();
  });

  it("persists one pending ticket across instances and concurrent retries without deleting accounts", async () => {
    const suffix = randomUUID();
    const credentials = { name: "Deletion QA", organizationName: "Isolated CI", email: `qa-${suffix}@example.invalid`, password: "TestOnly9!NoProduction" };
    const session = await auth.register(credentials);
    createdUsers.push(session.user.id);
    createdOrgs.push(session.organization.id);

    const [a, b] = await Promise.all([
      auth.requestAccountDeletion(session.user.id, session.organization.id),
      second.requestAccountDeletion(session.user.id, session.organization.id),
    ]);
    expect(a.id).toBe(b.id);
    expect(a.status).toBe("pending");
    expect(b.createdAt).toBe(a.createdAt);
    const afterRetry = await second.requestAccountDeletion(session.user.id, session.organization.id);
    expect(afterRetry).toEqual(a);

    const result = await pool.query<{ count: string }>(
      "SELECT COUNT(*)::text AS count FROM modo_account_deletion_requests WHERE user_id=$1 AND status='pending'",
      [session.user.id],
    );
    expect(result.rows[0]?.count).toBe("1");
    expect((await second.authenticate(session.token)).user.id).toBe(session.user.id);
    expect((await pool.query("SELECT 1 FROM modo_users WHERE id=$1", [session.user.id])).rowCount).toBe(1);
  });

  it("isolates different users and rejects orphaned requests with a foreign-key error", async () => {
    const suffix = randomUUID();
    const session = await auth.register({ name: "Second QA", organizationName: "Independent CI", email: `qa-${suffix}@example.invalid`, password: "TestOnly9!NoProduction" });
    createdUsers.push(session.user.id);
    createdOrgs.push(session.organization.id);
    const ticket = await auth.requestAccountDeletion(session.user.id, session.organization.id);
    expect(ticket.status).toBe("pending");
    const rows = await pool.query("SELECT user_id FROM modo_account_deletion_requests WHERE id=$1", [ticket.id]);
    expect(rows.rows[0]?.user_id).toBe(session.user.id);
    await expect(auth.requestAccountDeletion(randomUUID(), session.organization.id)).rejects.toThrow();
  });
});
