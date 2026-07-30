import { createApp } from "./app.js";
import { config } from "./config.js";
import { DemoDiagnosticProvider } from "./providers/demo-diagnostic-provider.js";
import { N8nDiagnosticProvider } from "./providers/n8n-diagnostic-provider.js";
import { registerHumanOperationsRoutes } from "./routes/human-operations-routes.js";
import { registerStrategyNetworkRoutes } from "./routes/strategy-network-routes.js";

function createProvider() {
  if (config.DIAGNOSTIC_PROVIDER === "n8n") {
    if (!config.N8N_DIAGNOSTIC_WEBHOOK_URL) {
      throw new Error("N8N_DIAGNOSTIC_WEBHOOK_URL é obrigatório quando DIAGNOSTIC_PROVIDER=n8n.");
    }
    return new N8nDiagnosticProvider(config.N8N_DIAGNOSTIC_WEBHOOK_URL, config.N8N_WEBHOOK_SECRET);
  }
  return new DemoDiagnosticProvider(config.DEMO_DIAGNOSTIC_DELAY_MS);
}

if (config.NODE_ENV === "production" && !config.DATABASE_URL) {
  console.error("\n============================================================");
  console.error("[MODO_CRITICAL] PRODUÇÃO INICIADA SEM DATABASE_URL");
  console.error("Memória de marca, contas, campanhas e histórico ficarão indisponíveis.");
  console.error("Configure DATABASE_URL antes de aceitar tráfego de clientes.");
  console.error("============================================================\n");
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
  contentProvider: config.OPENAI_API_KEY ? "openai" : "native",
  contentSecret: config.N8N_CONTENT_SECRET,
  publicApiUrl: config.PUBLIC_API_URL,
  openAiApiKey: config.OPENAI_API_KEY,
  openAiTextModel: config.OPENAI_TEXT_MODEL,
  openAiImageModel: config.OPENAI_IMAGE_MODEL,
  canvaClientId: config.CANVA_CLIENT_ID,
  canvaClientSecret: config.CANVA_CLIENT_SECRET,
  canvaRedirectUri: config.CANVA_REDIRECT_URI,
  canvaEncryptionSecret: config.CANVA_TOKEN_ENCRYPTION_SECRET,
  canvaScopes: config.CANVA_SCOPES,
  publicWebUrl: config.PUBLIC_WEB_URL,
});

await registerStrategyNetworkRoutes(app, {
  databaseUrl: config.DATABASE_URL,
  databaseSsl: config.DATABASE_SSL,
  resendApiKey: config.RESEND_API_KEY,
  humanSupportEmailFrom: config.HUMAN_SUPPORT_EMAIL_FROM,
  humanSupportEmailTo: config.HUMAN_SUPPORT_EMAIL_TO,
  humanSupportNotificationWebhookUrl: config.HUMAN_SUPPORT_NOTIFICATION_WEBHOOK_URL,
  publicWebUrl: config.PUBLIC_WEB_URL,
});

await registerHumanOperationsRoutes(app, {
  databaseUrl: config.DATABASE_URL,
  databaseSsl: config.DATABASE_SSL,
});

try {
  await app.listen({ host: "0.0.0.0", port: config.PORT });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
