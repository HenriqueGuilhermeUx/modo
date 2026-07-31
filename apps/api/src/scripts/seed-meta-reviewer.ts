import { config } from "../config.js";
import { AuthService } from "../services/auth-service.js";
import { BillingService } from "../services/billing-service.js";
import { seedMetaReviewer } from "../services/meta-reviewer-seed.js";

const auth = new AuthService({
  databaseUrl: config.DATABASE_URL,
  databaseSsl: config.DATABASE_SSL,
  sessionDays: config.AUTH_SESSION_DAYS,
});
const billing = new BillingService({
  databaseUrl: config.DATABASE_URL,
  databaseSsl: config.DATABASE_SSL,
});

try {
  await auth.initialize();
  await billing.initialize();
  const result = await seedMetaReviewer({
    databaseUrl: config.DATABASE_URL,
    databaseSsl: config.DATABASE_SSL,
    password: process.env.REVIEWER_TEST_PASSWORD,
  });
  if (!result) {
    throw new Error("Defina REVIEWER_TEST_PASSWORD antes de executar o seed.");
  }
  console.info(`Usuário de revisão Meta pronto: ${result.email}`);
  console.info(`Organização: ${result.organizationId}`);
  console.info(`Marca: ${result.brandId}`);
} finally {
  await Promise.all([auth.close(), billing.close()]);
}
