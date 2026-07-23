import "dotenv/config";
import { z } from "zod";

const emptyToUndefined = (value: unknown) => {
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  return trimmed.length === 0 ? undefined : trimmed;
};

const optionalTrimmedString = z.preprocess(emptyToUndefined, z.string().optional());
const optionalUrl = z.preprocess(emptyToUndefined, z.string().url().optional());
const booleanFromEnvironment = z.preprocess((value) => {
  if (typeof value !== "string") return value;
  const normalized = value.trim().toLowerCase();
  if (["true", "1", "yes", "on"].includes(normalized)) return true;
  if (["false", "0", "no", "off", ""].includes(normalized)) return false;
  return value;
}, z.boolean().default(false));

const ConfigSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    PORT: z.coerce.number().int().positive().default(4000),
    PUBLIC_API_URL: z.preprocess(emptyToUndefined, z.string().url().default("http://localhost:4000")),
    PUBLIC_WEB_URL: z.preprocess(emptyToUndefined, z.string().url().default("http://localhost:5173")),
    ALLOWED_ORIGINS: z.preprocess(
      emptyToUndefined,
      z.string().default("http://localhost:5173"),
    ),
    DIAGNOSTIC_PROVIDER: z.enum(["demo", "n8n"]).default("demo"),
    DEMO_DIAGNOSTIC_DELAY_MS: z.coerce.number().int().nonnegative().default(2600),
    N8N_DIAGNOSTIC_WEBHOOK_URL: optionalTrimmedString,
    N8N_WEBHOOK_SECRET: optionalTrimmedString,
    CONTENT_PROVIDER: z.enum(["demo", "n8n"]).default("demo"),
    CONTENT_DEMO_DELAY_MS: z.coerce.number().int().nonnegative().default(1800),
    N8N_CONTENT_WEBHOOK_URL: optionalTrimmedString,
    N8N_CONTENT_SECRET: optionalTrimmedString,
    DATABASE_URL: optionalTrimmedString,
    DATABASE_SSL: booleanFromEnvironment,
    AUTH_SESSION_DAYS: z.coerce.number().int().min(1).max(365).default(30),
    ENABLE_DEMO_BILLING: booleanFromEnvironment,
    PAYMENTS_PROVIDER: z.enum(["disabled", "woovi"]).default("disabled"),
    WOOVI_APP_ID: optionalTrimmedString,
    WOOVI_WEBHOOK_AUTHORIZATION: optionalTrimmedString,
    LINKEDIN_CLIENT_ID: optionalTrimmedString,
    LINKEDIN_CLIENT_SECRET: optionalTrimmedString,
    LINKEDIN_REDIRECT_URI: optionalTrimmedString,
    LINKEDIN_SCOPES: z.preprocess(
      emptyToUndefined,
      z.string().default("r_liteprofile w_member_social"),
    ),
    LINKEDIN_TOKEN_ENCRYPTION_SECRET: optionalTrimmedString,
    LINKEDIN_API_VERSION: z.preprocess(emptyToUndefined, z.string().default("202606")),
    SMARTBOTS_PARTNER_ENDPOINT: optionalUrl,
  })
  .superRefine((values, context) => {
    if (values.DIAGNOSTIC_PROVIDER === "n8n") {
      const webhookUrl = z.string().url().safeParse(values.N8N_DIAGNOSTIC_WEBHOOK_URL);
      if (!webhookUrl.success) {
        context.addIssue({
          code: "custom",
          path: ["N8N_DIAGNOSTIC_WEBHOOK_URL"],
          message: "Informe uma URL válida quando DIAGNOSTIC_PROVIDER=n8n.",
        });
      }
      if (!values.N8N_WEBHOOK_SECRET) {
        context.addIssue({
          code: "custom",
          path: ["N8N_WEBHOOK_SECRET"],
          message: "Informe um segredo quando DIAGNOSTIC_PROVIDER=n8n.",
        });
      }
    }

    if (values.CONTENT_PROVIDER === "n8n") {
      const webhookUrl = z.string().url().safeParse(values.N8N_CONTENT_WEBHOOK_URL);
      if (!webhookUrl.success) {
        context.addIssue({
          code: "custom",
          path: ["N8N_CONTENT_WEBHOOK_URL"],
          message: "Informe uma URL válida quando CONTENT_PROVIDER=n8n.",
        });
      }
      if (!values.N8N_CONTENT_SECRET) {
        context.addIssue({
          code: "custom",
          path: ["N8N_CONTENT_SECRET"],
          message: "Informe um segredo quando CONTENT_PROVIDER=n8n.",
        });
      }
    }

    if (values.PAYMENTS_PROVIDER === "woovi") {
      if (!values.WOOVI_APP_ID) {
        context.addIssue({
          code: "custom",
          path: ["WOOVI_APP_ID"],
          message: "Informe o AppID da Woovi.",
        });
      }
      if (!values.WOOVI_WEBHOOK_AUTHORIZATION) {
        context.addIssue({
          code: "custom",
          path: ["WOOVI_WEBHOOK_AUTHORIZATION"],
          message: "Informe a autorização secreta do webhook Woovi.",
        });
      }
    }
  });

const parsed = ConfigSchema.parse(process.env);

export const config = {
  ...parsed,
  N8N_WEBHOOK_SECRET: parsed.N8N_WEBHOOK_SECRET ?? "",
  N8N_CONTENT_SECRET: parsed.N8N_CONTENT_SECRET ?? "",
  allowedOrigins: parsed.ALLOWED_ORIGINS.split(",")
    .map((origin) => origin.trim())
    .filter(Boolean),
};
