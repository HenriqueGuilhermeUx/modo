import { createApp } from "./app.js";
import { config } from "./config.js";
import { DemoDiagnosticProvider } from "./providers/demo-diagnostic-provider.js";
import { N8nDiagnosticProvider } from "./providers/n8n-diagnostic-provider.js";
import { registerHumanOperationsRoutes } from "./routes/human-operations-routes.js";
import { registerNativePublisherDirectOAuthRoutes } from "./routes/native-publisher-direct-oauth-routes.js";
import { registerNativePublisherInstagramComplianceRoutes } from "./routes/native-publisher-instagram-compliance-routes.js";
import { registerNativePublisherV2Routes } from "./routes/native-publisher-v2-routes.js";
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

// LinkedIn e Postiz V1 são registrados uma única vez pelo core em
// registerCreativeIntelligenceRoutes(). O Publisher V2 é encapsulado em plugin próprio.
app.get("/api/v1/native-publisher/health", async () => ({
  status: "ok",
  provider: "modo_native",
  requiresLocalInfrastructure: false,
  instagram: {
    configured: Boolean(
      config.INSTAGRAM_CLIENT_ID &&
      config.INSTAGRAM_CLIENT_SECRET &&
      config.INSTAGRAM_REDIRECT_URI &&
      config.INSTAGRAM_TOKEN_ENCRYPTION_SECRET,
    ),
    redirectUri: config.INSTAGRAM_REDIRECT_URI,
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

await app.register(async (scope) => {
  const instagramPublisherRedirectUri =
    process.env.INSTAGRAM_PUBLISHER_REDIRECT_URI ||
    "https://modo-api-3m10.onrender.com/api/v2/publisher/oauth/instagram/callback";
  const linkedinPublisherRedirectUri =
    process.env.LINKEDIN_PUBLISHER_REDIRECT_URI ||
    "https://modo-api-3m10.onrender.com/api/v2/publisher/oauth/linkedin/callback";

  await registerNativePublisherV2Routes(scope, {
    databaseUrl: config.DATABASE_URL,
    databaseSsl: config.DATABASE_SSL,
    publicApiUrl: config.PUBLIC_API_URL,
    publicWebUrl: config.PUBLIC_WEB_URL,
    instagramEncryptionSecret: config.INSTAGRAM_TOKEN_ENCRYPTION_SECRET,
    instagramGraphBaseUrl: config.INSTAGRAM_GRAPH_BASE_URL,
    instagramApiVersion: config.INSTAGRAM_API_VERSION,
    facebookAppId: process.env.FACEBOOK_APP_ID,
    facebookAppSecret: process.env.FACEBOOK_APP_SECRET,
    facebookRedirectUri:
      process.env.FACEBOOK_REDIRECT_URI ||
      "https://modo-api-3m10.onrender.com/api/v2/publisher/oauth/facebook/callback",
    facebookApiVersion: process.env.FACEBOOK_API_VERSION || "v26.0",
    threadsAppId: process.env.THREADS_APP_ID,
    threadsAppSecret: process.env.THREADS_APP_SECRET,
    threadsRedirectUri:
      process.env.THREADS_REDIRECT_URI ||
      "https://modo-api-3m10.onrender.com/api/v2/publisher/oauth/threads/callback",
    threadsScopes:
      process.env.THREADS_SCOPES ||
      "threads_basic,threads_content_publish,threads_manage_insights",
    linkedinEncryptionSecret: config.LINKEDIN_TOKEN_ENCRYPTION_SECRET,
    linkedinApiVersion: config.LINKEDIN_API_VERSION,
  });

  await registerNativePublisherDirectOAuthRoutes(scope, {
    databaseUrl: config.DATABASE_URL,
    databaseSsl: config.DATABASE_SSL,
    publicWebUrl: config.PUBLIC_WEB_URL,
    instagramClientId: config.INSTAGRAM_CLIENT_ID,
    instagramClientSecret: config.INSTAGRAM_CLIENT_SECRET,
    instagramRedirectUri: instagramPublisherRedirectUri,
    instagramEncryptionSecret: config.INSTAGRAM_TOKEN_ENCRYPTION_SECRET,
    instagramScopes: config.INSTAGRAM_SCOPES,
    instagramGraphBaseUrl: config.INSTAGRAM_GRAPH_BASE_URL,
    instagramApiVersion: config.INSTAGRAM_API_VERSION,
    linkedinClientId: config.LINKEDIN_CLIENT_ID,
    linkedinClientSecret: config.LINKEDIN_CLIENT_SECRET,
    linkedinRedirectUri: linkedinPublisherRedirectUri,
    linkedinEncryptionSecret: config.LINKEDIN_TOKEN_ENCRYPTION_SECRET,
    linkedinScopes: config.LINKEDIN_SCOPES,
  });

  await registerNativePublisherInstagramComplianceRoutes(scope, {
    databaseUrl: config.DATABASE_URL,
    databaseSsl: config.DATABASE_SSL,
    instagramClientSecret: config.INSTAGRAM_CLIENT_SECRET,
    publicWebUrl: config.PUBLIC_WEB_URL,
  });
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
