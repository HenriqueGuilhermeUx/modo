import { createApp } from "./app.js";
import { config } from "./config.js";
import { DemoDiagnosticProvider } from "./providers/demo-diagnostic-provider.js";
import { N8nDiagnosticProvider } from "./providers/n8n-diagnostic-provider.js";

function createProvider() {
  if (config.DIAGNOSTIC_PROVIDER === "n8n") {
    if (!config.N8N_DIAGNOSTIC_WEBHOOK_URL) {
      throw new Error("N8N_DIAGNOSTIC_WEBHOOK_URL é obrigatório quando DIAGNOSTIC_PROVIDER=n8n.");
    }
    return new N8nDiagnosticProvider(config.N8N_DIAGNOSTIC_WEBHOOK_URL, config.N8N_WEBHOOK_SECRET);
  }
  return new DemoDiagnosticProvider(config.DEMO_DIAGNOSTIC_DELAY_MS);
}

const app = await createApp({
  provider: createProvider(),
  allowedOrigins: config.allowedOrigins,
  logger: true,
  databaseUrl: config.DATABASE_URL,
  databaseSsl: config.DATABASE_SSL,
  sessionDays: config.AUTH_SESSION_DAYS,
  enableDemoBilling: config.ENABLE_DEMO_BILLING,
});

try {
  await app.listen({ host: "0.0.0.0", port: config.PORT });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
