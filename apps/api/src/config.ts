import "dotenv/config";
import { z } from "zod";

const ConfigSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(4000),
  ALLOWED_ORIGINS: z.string().default("http://localhost:5173"),
  DIAGNOSTIC_PROVIDER: z.enum(["demo", "n8n"]).default("demo"),
  DEMO_DIAGNOSTIC_DELAY_MS: z.coerce.number().int().nonnegative().default(5200),
  N8N_DIAGNOSTIC_WEBHOOK_URL: z.string().url().optional().or(z.literal("")),
  N8N_WEBHOOK_SECRET: z.string().optional().default(""),
});

const parsed = ConfigSchema.parse(process.env);
export const config = {
  ...parsed,
  allowedOrigins: parsed.ALLOWED_ORIGINS.split(",").map((origin) => origin.trim()).filter(Boolean),
};
