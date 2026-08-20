import { createApp } from "./app.js";
import { config } from "./config.js";
import { DemoDiagnosticProvider } from "./providers/demo-diagnostic-provider.js";
import { N8nDiagnosticProvider } from "./providers/n8n-diagnostic-provider.js";
import { registerHumanOperationsRoutes } from "./routes/human-operations-routes.js";
import { registerNativePublisherRoutes } from "./routes/native-publisher-routes.js";
import { registerStrategyNetworkRoutes } from "./routes/strategy-network-routes.js";
import { AuthService } from "./services/auth-service.js";
import { ContentAssetService } from "./services/content-asset-service.js";
import { ContentService } from "./services/content-service.js";
import { NativePublisherService } from "./services/native-publisher-service.js";

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
  diagnosticProviderName: config.DIAGNOSTIC_PROVIDER,
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
  instagramClientId: config.INSTAGRAM_CLIENT_ID,
  instagramClientSecret: config.INSTAGRAM_CLIENT_SECRET,
  instagramRedirectUri: config.INSTAGRAM_REDIRECT_URI,
  instagramEncryptionSecret: config.INSTAGRAM_TOKEN_ENCRYPTION_SECRET,
  instagramScopes: config.INSTAGRAM_SCOPES,
  instagramApiVersion: config.INSTAGRAM_API_VERSION,
  instagramGraphBaseUrl: config.INSTAGRAM_GRAPH_BASE_URL,
  publicWebUrl: config.PUBLIC_WEB_URL,
});

// O Publisher nativo é um módulo próprio com rotas exclusivas. Ele compartilha
// apenas o banco e os dados do core; LinkedIn/Postiz continuam registrados uma
// única vez pelo createApp/registerCreativeIntelligenceRoutes.
const publisherAuth = new AuthService({
  databaseUrl: config.DATABASE_URL,
  databaseSsl: config.DATABASE_SSL,
  sessionDays: config.AUTH_SESSION_DAYS,
});
const publisherContent = new ContentService({
  databaseUrl: config.DATABASE_URL,
  databaseSsl: config.DATABASE_SSL,
});
const publisherAssets = new ContentAssetService({
  databaseUrl: config.DATABASE_URL,
  databaseSsl: config.DATABASE_SSL,
  publicApiUrl: config.PUBLIC_API_URL,
});
const nativePublisher = new NativePublisherService({
  databaseUrl: config.DATABASE_URL,
  databaseSsl: config.DATABASE_SSL,
  content: publisherContent,
  assets: publisherAssets,
  encryptionSecret: config.INSTAGRAM_TOKEN_ENCRYPTION_SECRET,
  instagramGraphBaseUrl: config.INSTAGRAM_GRAPH_BASE_URL,
  instagramApiVersion: config.INSTAGRAM_API_VERSION,
  facebookAppId: process.env.FACEBOOK_APP_ID,
  facebookAppSecret: process.env.FACEBOOK_APP_SECRET,
  facebookRedirectUri:
    process.env.FACEBOOK_REDIRECT_URI ||
    "https://modo-api-3m10.onrender.com/api/v1/native-publisher/facebook/callback",
  facebookScopes:
    process.env.FACEBOOK_SCOPES ||
    "pages_show_list,pages_read_engagement,pages_manage_posts,read_insights",
  facebookApiVersion: process.env.FACEBOOK_API_VERSION || "v21.0",
  threadsClientId: process.env.THREADS_CLIENT_ID,
  threadsClientSecret: process.env.THREADS_CLIENT_SECRET,
  threadsRedirectUri:
    process.env.THREADS_REDIRECT_URI ||
    "https://modo-api-3m10.onrender.com/api/v1/native-publisher/threads/callback",
  threadsScopes:
    process.env.THREADS_SCOPES ||
    "threads_basic,threads_content_publish,threads_manage_insights",
  threadsGraphBaseUrl: process.env.THREADS_GRAPH_BASE_URL || "https://graph.threads.net",
  threadsApiVersion: process.env.THREADS_API_VERSION || "v1.0",
  linkedinConfigured: Boolean(
    config.LINKEDIN_CLIENT_ID &&
    config.LINKEDIN_CLIENT_SECRET &&
    config.LINKEDIN_REDIRECT_URI &&
    config.LINKEDIN_TOKEN_ENCRYPTION_SECRET,
  ),
  webUrl: config.PUBLIC_WEB_URL,
});
await Promise.all([
  publisherAuth.initialize(),
  publisherContent.initialize(),
  publisherAssets.initialize(),
]);
await nativePublisher.initialize();
await registerNativePublisherRoutes(app, {
  auth: publisherAuth,
  content: publisherContent,
  publisher: nativePublisher,
});

app.addHook("onClose", async () => {
  await Promise.all([
    publisherAuth.close(),
    publisherContent.close(),
    publisherAssets.close(),
    nativePublisher.close(),
  ]);
});

app.get("/api/v1/native-publisher/health", async () => ({
  status: "ok",
  provider: "modo_native",
  requiresLocalInfrastructure: false,
  storage: nativePublisher.storage,
  scheduling: "enabled",
  retries: "enabled",
  analytics: "enabled",
  learningLoop: "enabled",
  instagram: {
    configured: Boolean(
      config.INSTAGRAM_CLIENT_ID &&
      config.INSTAGRAM_CLIENT_SECRET &&
      config.INSTAGRAM_REDIRECT_URI &&
      config.INSTAGRAM_TOKEN_ENCRYPTION_SECRET,
    ),
    redirectUri: config.INSTAGRAM_REDIRECT_URI,
  },
  facebook: {
    configured: nativePublisher.facebookConfigured,
    redirectUri:
      process.env.FACEBOOK_REDIRECT_URI ||
      "https://modo-api-3m10.onrender.com/api/v1/native-publisher/facebook/callback",
  },
  threads: {
    configured: nativePublisher.threadsConfigured,
    redirectUri:
      process.env.THREADS_REDIRECT_URI ||
      "https://modo-api-3m10.onrender.com/api/v1/native-publisher/threads/callback",
  },
  linkedin: {
    configured: Boolean(
      config.LINKEDIN_CLIENT_ID &&
      config.LINKEDIN_CLIENT_SECRET &&
      config.LINKEDIN_REDIRECT_URI &&
      config.LINKEDIN_TOKEN_ENCRYPTION_SECRET,
    ),
    redirectUri: config.LINKEDIN_REDIRECT_URI || null,
  },
  postiz: {
    optional: true,
    configured: Boolean(config.POSTIZ_API_KEY),
  },
}));

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
