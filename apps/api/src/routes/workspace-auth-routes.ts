import { LoginRequestSchema, RegisterRequestSchema } from "@modo/contracts";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { AuthError } from "../services/auth-service.js";
import { BillingService } from "../services/billing-service.js";
import { PasswordResetError, PasswordResetService } from "../services/password-reset-service.js";
import { WorkspaceAuthService, type WorkspaceType } from "../services/workspace-auth-service.js";

interface Options {
  databaseUrl?: string;
  databaseSsl?: boolean;
  sessionDays?: number;
}

const ForgotPasswordSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(180),
  mode: z.enum(["business", "agency"]).optional().default("business"),
});

const NewPasswordSchema = z
  .string()
  .min(8, "A senha deve ter pelo menos 8 caracteres.")
  .max(128)
  .regex(/[A-Za-z]/, "A senha deve conter uma letra.")
  .regex(/[0-9]/, "A senha deve conter um número.");

const ResetPasswordSchema = z.object({
  token: z.string().trim().min(20).max(300),
  password: NewPasswordSchema,
});

async function passwordAction<T>(operation: () => Promise<T>) {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof PasswordResetError) {
      throw new AuthError(error.code, error.statusCode, error.message);
    }
    throw error;
  }
}

export async function registerWorkspaceAuthRoutes(app: FastifyInstance, options: Options) {
  const workspaceAuth = new WorkspaceAuthService(options);
  const billing = new BillingService({ databaseUrl: options.databaseUrl, databaseSsl: options.databaseSsl });
  const passwordReset = new PasswordResetService({
    databaseUrl: options.databaseUrl,
    databaseSsl: options.databaseSsl,
    publicWebUrl: process.env.PUBLIC_WEB_URL,
    resendApiKey: process.env.RESEND_API_KEY,
    emailFrom: process.env.PASSWORD_RESET_EMAIL_FROM || process.env.HUMAN_SUPPORT_EMAIL_FROM,
  });

  await Promise.all([billing.initialize(), workspaceAuth.initialize(), passwordReset.initialize()]);
  app.addHook("onClose", async () => {
    await Promise.all([workspaceAuth.close(), billing.close(), passwordReset.close()]);
  });

  function registerPair(workspaceType: WorkspaceType) {
    app.post(
      `/api/v1/auth/${workspaceType}/register`,
      { config: { rateLimit: { max: 8, timeWindow: "15 minutes" } } },
      async (request, reply) => {
        const session = await workspaceAuth.register(RegisterRequestSchema.parse(request.body), workspaceType);
        await billing.createOrUpdateDemoSubscription(session.organization.id, "trial");
        return reply.code(201).send(session);
      },
    );

    app.post(
      `/api/v1/auth/${workspaceType}/login`,
      { config: { rateLimit: { max: 12, timeWindow: "15 minutes" } } },
      async (request) => workspaceAuth.login(LoginRequestSchema.parse(request.body), workspaceType),
    );
  }

  registerPair("business");
  registerPair("agency");

  app.post(
    "/api/v1/auth/password/forgot",
    { config: { rateLimit: { max: 5, timeWindow: "15 minutes" } } },
    async (request, reply) => {
      const input = ForgotPasswordSchema.parse(request.body);
      const result = await passwordAction(() => passwordReset.request(input.email, input.mode));
      return reply.code(202).send(result);
    },
  );

  app.post(
    "/api/v1/auth/password/reset",
    { config: { rateLimit: { max: 10, timeWindow: "15 minutes" } } },
    async (request) => {
      const input = ResetPasswordSchema.parse(request.body);
      return passwordAction(() => passwordReset.reset(input.token, input.password));
    },
  );

  app.get("/api/v1/workspace-auth/health", async () => ({
    status: "ok",
    configured: workspaceAuth.configured,
    separation: "business_vs_agency",
    passwordRecovery: passwordReset.configured ? "configured" : "not_configured",
  }));
}
