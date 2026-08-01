import "dotenv/config";
import { randomBytes, scryptSync } from "node:crypto";
import pg from "pg";
import { AuthService } from "../services/auth-service.js";
import { BillingService } from "../services/billing-service.js";

const { Pool } = pg;
const REVIEWER_EMAIL = "revisor@trynexa.com.br";
const REVIEWER_ORGANIZATION_ID = "modo-meta-review-organization";
const REVIEWER_BRAND_ID = "00000000-0000-4000-8000-000000000070";

function booleanEnvironment(value: string | undefined) {
  return ["1", "true", "yes", "on"].includes(String(value || "").trim().toLowerCase());
}

function hashPassword(password: string, salt: string) {
  return scryptSync(password, salt, 64).toString("hex");
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL?.trim();
  const password = process.env.REVIEWER_TEST_PASSWORD?.trim();
  const databaseSsl = booleanEnvironment(process.env.DATABASE_SSL);

  if (!databaseUrl) throw new Error("DATABASE_URL é obrigatória para criar o usuário de revisão da Meta.");
  if (!password || password.length < 12) {
    throw new Error("REVIEWER_TEST_PASSWORD deve existir e possuir ao menos 12 caracteres.");
  }

  const auth = new AuthService({ databaseUrl, databaseSsl });
  const billing = new BillingService({ databaseUrl, databaseSsl });
  await Promise.all([auth.initialize(), billing.initialize()]);
  await Promise.all([auth.close(), billing.close()]);

  const pool = new Pool({
    connectionString: databaseUrl,
    ssl: databaseSsl ? { rejectUnauthorized: false } : undefined,
    max: 2,
  });
  const client = await pool.connect();
  let organizationId = REVIEWER_ORGANIZATION_ID;

  try {
    await client.query("BEGIN");
    await client.query(
      `INSERT INTO modo_organizations(id,name)
       VALUES($1,$2)
       ON CONFLICT(id) DO UPDATE SET name=EXCLUDED.name`,
      [REVIEWER_ORGANIZATION_ID, "MODO · Revisão Meta"],
    );

    const salt = randomBytes(16).toString("hex");
    const userResult = await client.query<{ id: string }>(
      `INSERT INTO modo_users(id,name,email,password_hash,password_salt)
       VALUES($1,$2,$3,$4,$5)
       ON CONFLICT(email) DO UPDATE SET
         name=EXCLUDED.name,
         password_hash=EXCLUDED.password_hash,
         password_salt=EXCLUDED.password_salt
       RETURNING id`,
      [
        "modo-meta-review-user",
        "Revisor Meta",
        REVIEWER_EMAIL,
        hashPassword(password, salt),
        salt,
      ],
    );
    const userId = userResult.rows[0].id;

    const existingMembership = await client.query<{ organization_id: string }>(
      `SELECT organization_id FROM modo_memberships
       WHERE user_id=$1 ORDER BY created_at ASC LIMIT 1`,
      [userId],
    );
    if (existingMembership.rows[0]?.organization_id) {
      organizationId = existingMembership.rows[0].organization_id;
    } else {
      await client.query(
        `INSERT INTO modo_memberships(user_id,organization_id,role)
         VALUES($1,$2,'owner')
         ON CONFLICT(user_id,organization_id) DO UPDATE SET role='owner'`,
        [userId, REVIEWER_ORGANIZATION_ID],
      );
    }

    await client.query(
      `INSERT INTO modo_brands(
        id,organization_id,name,website_url,instagram_handle,niche,updated_at
      ) VALUES($1,$2,$3,$4,$5,$6,NOW())
      ON CONFLICT(id) DO UPDATE SET
        organization_id=EXCLUDED.organization_id,
        name=EXCLUDED.name,
        website_url=EXCLUDED.website_url,
        instagram_handle=EXCLUDED.instagram_handle,
        niche=EXCLUDED.niche,
        updated_at=NOW()`,
      [
        REVIEWER_BRAND_ID,
        organizationId,
        "Marca de Teste · Meta Review",
        "https://modo1.netlify.app",
        "@modo_review",
        "servicos_profissionais",
      ],
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
    await pool.end();
  }

  const reviewerBilling = new BillingService({ databaseUrl, databaseSsl });
  await reviewerBilling.initialize();
  await reviewerBilling.createOrUpdateDemoSubscription(organizationId, "business");
  await reviewerBilling.close();

  console.log(`Usuário de revisão Meta preparado: ${REVIEWER_EMAIL}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Falha ao preparar o usuário de revisão Meta.");
  process.exit(1);
});
