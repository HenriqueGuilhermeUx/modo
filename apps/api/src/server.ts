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
  paymentsProvider: config.PAYMENTS_PROVIDER,
  wooviAppId: config.WOOVI_APP_ID,
  wooviWebhookAuthorization: config.WOOVI_WEBHOOK_AUTHORIZATION,
  contentProvider: config.CONTENT_PROVIDER,
  contentWebhookUrl: config.N8N_CONTENT_WEBHOOK_URL,
  contentSecret: config.N8N_CONTENT_SECRET,
  publicApiUrl: config.PUBLIC_API_URL,
  contentDemoDelayMs: config.CONTENT_DEMO_DELAY_MS,
  intelligenceProvider: config.INTELLIGENCE_PROVIDER,
  apifyBaseUrl: config.APIFY_API_BASE_URL,
  apifyToken: config.APIFY_API_TOKEN,
  n8nIntelligenceWebhookUrl: config.N8N_INTELLIGENCE_WEBHOOK_URL,
  n8nIntelligenceSecret: config.N8N_INTELLIGENCE_SECRET,
  intelligenceCallbackSecret: config.INTELLIGENCE_CALLBACK_SECRET,
  intelligenceRequestTimeoutMs: config.INTELLIGENCE_REQUEST_TIMEOUT_MS,
  intelligenceTaskIds: {
    market_radar: config.APIFY_MARKET_RADAR_TASK_ID,
    b2b_prospecting: config.APIFY_B2B_PROSPECTING_TASK_ID,
    price_monitoring: config.APIFY_PRICE_MONITORING_TASK_ID,
  },
});

try {
  await app.listen({ host: "0.0.0.0", port: config.PORT });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
