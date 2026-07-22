import { ContentOutputUpdateSchema } from "@modo/contracts/content";
import type { FastifyInstance, FastifyRequest } from "fastify";
import pg, { type Pool } from "pg";
import { AuthError, type AuthService } from "../services/auth-service.js";
import { ContentError, type ContentService } from "../services/content-service.js";

const { Pool: PgPool } = pg;

function bearerToken(request: FastifyRequest) {
  const value = request.headers.authorization;
  if (!value?.startsWith("Bearer ")) {
    throw new AuthError("UNAUTHORIZED", 401, "Faça login para continuar.");
  }
  return value.slice(7).trim();
}

interface Options {
  auth: AuthService;
  content: ContentService;
  databaseUrl?: string;
  databaseSsl?: boolean;
}

export async function registerStudioRoutes(app: FastifyInstance, options: Options) {
  const pool: Pool | undefined = options.databaseUrl
    ? new PgPool({
        connectionString: options.databaseUrl,
        ssl: options.databaseSsl ? { rejectUnauthorized: false } : undefined,
        max: 2,
      })
    : undefined;

  app.addHook("onClose", async () => pool?.end());

  app.patch("/api/v1/content-requests/:id/output", async (request) => {
    const context = await options.auth.authenticate(bearerToken(request));
    const id = (request.params as { id: string }).id;
    const current = await options.content.getForOrganization(id, context.organization.id);
    if (!["ready", "approved"].includes(current.status) || !current.output) {
      throw new ContentError(
        "CONTENT_NOT_EDITABLE",
        409,
        "Somente conteúdos prontos ou aprovados podem ser editados no Studio.",
      );
    }
    const output = ContentOutputUpdateSchema.parse(request.body);

    if (pool) {
      await pool.query(
        `UPDATE modo_content_requests
         SET output=$3::jsonb, updated_at=NOW()
         WHERE id=$1 AND organization_id=$2 AND status IN ('ready','approved')`,
        [id, context.organization.id, JSON.stringify(output)],
      );
      return options.content.getForOrganization(id, context.organization.id);
    }

    return {
      ...current,
      output,
      updatedAt: new Date().toISOString(),
    };
  });
}
