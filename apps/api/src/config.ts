import "dotenv/config";
import { z } from "zod";

const emptyToUndefined = (value: unknown) => {
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  return trimmed.length === 0 ? undefined : trimmed;
};

const optionalTrimmedString = z.preprocess(emptyToUndefined, z.string().optional());

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
  })
  .superRefine((values, context) => {
    if (values.DIAGNOSTIC_PROVIDER !== "n8n") return;

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
  });

const parsed = ConfigSchema.parse(process.env);

export const config = {
  ...parsed,
  N8N_WEBHOOK_SECRET: parsed.N8N_WEBHOOK_SECRET ?? "",
  allowedOrigins: parsed.ALLOWED_ORIGINS.split(",")
    .map((origin) => origin.trim())
    .filter(Boolean),
};
