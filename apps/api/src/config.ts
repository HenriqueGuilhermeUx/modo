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
    ALLOWED_ORIGINS: z.preprocess(
      emptyToUndefined,
      z.string().default("http://localhost:5173"),
    ),
    DIAGNOSTIC_PROVIDER: z.enum(["demo", "n8n"]).default("demo"),
    DEMO_DIAGNOSTIC_DELAY_MS: z.coerce.number().int().nonnegative().default(5200),
    N8N_DIAGNOSTIC_WEBHOOK_URL: optionalTrimmedString,
    N8N_WEBHOOK_SECRET: optionalTrimmedString,
    DATABASE_URL: optionalTrimmedString,
    DATABASE_SSL: booleanFromEnvironment,
    AUTH_SESSION_DAYS: z.coerce.number().int().min(1).max(365).default(30),
    ENABLE_DEMO_BILLING: booleanFromEnvironment,
    PAYMENTS_PROVIDER: z.enum(["disabled", "mercado_pago"]).default("disabled"),
    MERCADO_PAGO_ACCESS_TOKEN: optionalTrimmedString,
    MERCADO_PAGO_WEBHOOK_SECRET: optionalTrimmedString,
    PUBLIC_APP_URL: optionalUrl.default("https://modo1.netlify.app"),
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

    if (values.PAYMENTS_PROVIDER === "mercado_pago") {
      if (!values.MERCADO_PAGO_ACCESS_TOKEN) {
        context.addIssue({
          code: "custom",
          path: ["MERCADO_PAGO_ACCESS_TOKEN"],
          message: "Informe o Access Token do Mercado Pago.",
        });
      }
      if (!values.MERCADO_PAGO_WEBHOOK_SECRET) {
        context.addIssue({
          code: "custom",
          path: ["MERCADO_PAGO_WEBHOOK_SECRET"],
          message: "Informe a assinatura secreta do webhook do Mercado Pago.",
        });
      }
    }
  });

const parsed = ConfigSchema.parse(process.env);

export const config = {
  ...parsed,
  N8N_WEBHOOK_SECRET: parsed.N8N_WEBHOOK_SECRET ?? "",
  allowedOrigins: parsed.ALLOWED_ORIGINS.split(",")
    .map((origin) => origin.trim())
    .filter(Boolean),
};
