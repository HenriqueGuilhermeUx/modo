import { planEntitlements } from "@modo/contracts";
import { randomBytes, randomUUID, scryptSync } from "node:crypto";
import pg, { type PoolClient } from "pg";

const { Pool: PgPool } = pg;

export const META_REVIEWER_EMAIL = "revisor@trynexa.com.br";
export const META_REVIEWER_USER_NAME = "Revisor Meta";
export const META_REVIEWER_ORGANIZATION_NAME = "MODO App Review";
export const META_REVIEWER_BRAND_NAME = "MODO Review Brand";

interface SeedOptions {
  databaseUrl?: string;
  databaseSsl?: boolean;
  password?: string;
}

export interface MetaReviewerSeedResult {
  email: string;
  userId: string;
  organizationId: string;
  brandId: string;
  periodStart: string;
  periodEnd: string;
}

function hashPassword(password: string, salt: string) {
  return scryptSync(password, salt, 64).toString("hex");
}

function monthlyPeriod(now = new Date()) {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  const key = `${start.getUTCFullYear()}-${String(start.getUTCMonth() + 1).padStart(2, "0")}`;
  return { start, end, key };
}

async function ensureReviewerUser(client: PoolClient, password: string) {
  const email = META_REVIEWER_EMAIL.toLowerCase();
  const existing = await client.query<{ id: string }>(
    "SELECT id FROM modo_users WHERE LOWER(email)=$1 LIMIT 1",
    [email],
  );
  const salt = randomBytes(16).toString("hex");
  const passwordHash = hashPassword(password, salt);
  if (existing.rows[0]) {
    await client.query(
      `UPDATE modo_users
       SET name=$2, email=$3, password_hash=$4, password_salt=$5
       WHERE id=$1`,
      [existing.rows[0].id, META_REVIEWER_USER_NAME, email, passwordHash, salt],
    );
    return existing.rows[0].id;
  }
  const userId = randomUUID();
  await client.query(
    `INSERT INTO modo_users(id,name,email,password_hash,password_salt)
     VALUES($1,$2,$3,$4,$5)`,
    [userId, META_REVIEWER_USER_NAME, email, passwordHash, salt],
  );
  return userId;
}

async function ensureOrganization(client: PoolClient, userId: string) {
  const membership = await client.query<{ organization_id: string }>(
    `SELECT organization_id
     FROM modo_memberships
     WHERE user_id=$1
     ORDER BY created_at ASC
     LIMIT 1`,
    [userId],
  );
  if (membership.rows[0]) {
    await client.query(
      "UPDATE modo_organizations SET name=$2 WHERE id=$1",
      [membership.rows[0].organization_id, META_REVIEWER_ORGANIZATION_NAME],
    );
    return membership.rows[0].organization_id;
  }
  const organizationId = randomUUID();
  await client.query(
    "INSERT INTO modo_organizations(id,name) VALUES($1,$2)",
    [organizationId, META_REVIEWER_ORGANIZATION_NAME],
  );
  await client.query(
    `INSERT INTO modo_memberships(user_id,organization_id,role)
     VALUES($1,$2,'owner')`,
    [userId, organizationId],
  );
  return organizationId;
}

async function ensureBrand(client: PoolClient, organizationId: string) {
  const existing = await client.query<{ id: string }>(
    `SELECT id FROM modo_brands
     WHERE organization_id=$1 AND name=$2
     LIMIT 1`,
    [organizationId, META_REVIEWER_BRAND_NAME],
  );
  if (existing.rows[0]) {
    await client.query(
      `UPDATE modo_brands
       SET website_url=$2, instagram_handle=$3, niche=$4, updated_at=NOW()
       WHERE id=$1`,
      [
        existing.rows[0].id,
        "https://modo1.netlify.app",
        "@modo.appreview",
        "servicos_profissionais",
      ],
    );
    return existing.rows[0].id;
  }
  const brandId = randomUUID();
  await client.query(
    `INSERT INTO modo_brands(id,organization_id,name,website_url,instagram_handle,niche)
     VALUES($1,$2,$3,$4,$5,$6)`,
    [
      brandId,
      organizationId,
      META_REVIEWER_BRAND_NAME,
      "https://modo1.netlify.app",
      "@modo.appreview",
      "servicos_profissionais",
    ],
  );
  return brandId;
}

async function ensureReviewerSubscription(client: PoolClient, organizationId: string) {
  const period = monthlyPeriod();
  await client.query(
    `INSERT INTO modo_subscriptions(account_id,plan_slug,status,period_start,period_end)
     VALUES($1,'business','active',$2,$3)
     ON CONFLICT(account_id) DO UPDATE SET
       plan_slug='business',
       status='active',
       period_start=EXCLUDED.period_start,
       period_end=EXCLUDED.period_end,
       updated_at=NOW()`,
    [organizationId, period.start, period.end],
  );
  await client.query(
    `INSERT INTO modo_credit_ledger(
       id,account_id,entry_type,credits,reference_id,period_start,metadata
     ) VALUES($1,$2,'grant',$3,$4,$5,$6::jsonb)
     ON CONFLICT(account_id,entry_type,reference_id) DO NOTHING`,
    [
      randomUUID(),
      organizationId,
      planEntitlements.business.monthlyCredits,
      `meta-reviewer:${period.key}`,
      period.start,
      JSON.stringify({ source: "meta_app_review_seed", plan: "business" }),
    ],
  );
  return period;
}

export async function seedMetaReviewer(
  options: SeedOptions,
): Promise<MetaReviewerSeedResult | null> {
  const password = options.password?.trim();
  if (!password) return null;
  if (password.length < 8) {
    throw new Error("REVIEWER_TEST_PASSWORD deve ter pelo menos 8 caracteres.");
  }
  if (!options.databaseUrl) {
    throw new Error("DATABASE_URL é obrigatória para criar o usuário fixo de revisão da Meta.");
  }

  const pool = new PgPool({
    connectionString: options.databaseUrl,
    ssl: options.databaseSsl ? { rejectUnauthorized: false } : undefined,
    max: 1,
  });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
      "modo:meta-reviewer-seed",
    ]);
    const userId = await ensureReviewerUser(client, password);
    const organizationId = await ensureOrganization(client, userId);
    const brandId = await ensureBrand(client, organizationId);
    const period = await ensureReviewerSubscription(client, organizationId);
    await client.query("COMMIT");
    return {
      email: META_REVIEWER_EMAIL,
      userId,
      organizationId,
      brandId,
      periodStart: period.start.toISOString(),
      periodEnd: period.end.toISOString(),
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}
