import { LoginRequestSchema, RegisterRequestSchema } from "@modo/contracts";
import type { FastifyInstance } from "fastify";
import { BillingService } from "../services/billing-service.js";
import { WorkspaceAuthService, type WorkspaceType } from "../services/workspace-auth-service.js";

interface Options {
  databaseUrl?: string;
  databaseSsl?: boolean;
  sessionDays?: number;
}

export async function registerWorkspaceAuthRoutes(app: FastifyInstance, options: Options) {
  const workspaceAuth = new WorkspaceAuthService(options);
  const billing = new BillingService({ databaseUrl: options.databaseUrl, databaseSsl: options.databaseSsl });

  await billing.initialize();
  await workspaceAuth.initialize();
  app.addHook("onClose", async () => {
    await Promise.all([workspaceAuth.close(), billing.close()]);
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

  app.get("/api/v1/workspace-auth/health", async () => ({
    status: "ok",
    configured: workspaceAuth.configured,
    separation: "business_vs_agency",
  }));
}
