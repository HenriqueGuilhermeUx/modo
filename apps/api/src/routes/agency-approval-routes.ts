import type { Brand } from "@modo/contracts";
import type { ContentRequest } from "@modo/contracts/content";
import { ContentRevisionRequestSchema } from "@modo/contracts/content";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import pg, { type Pool } from "pg";
import { z } from "zod";
import { AuthError, AuthService } from "../services/auth-service.js";
import { ContentAssetService } from "../services/content-asset-service.js";
import { ContentAutomationService } from "../services/content-automation-service.js";
import { ContentError, ContentService } from "../services/content-service.js";

const { Pool: PgPool } = pg;

interface Options {
  databaseUrl?: string;
  databaseSsl?: boolean;
  publicApiUrl?: string;
  publicWebUrl?: string;
  openAiApiKey?: string;
  openAiTextModel?: string;
  openAiImageModel?: string;
}

type LinkContext = {
  organizationId: string;
  brandId: string;
  expiresAt: Date;
};

type MemoryLink = LinkContext & {
  tokenHash: string;
  revokedAt: Date | null;
};

function hashToken(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function bearerToken(request: FastifyRequest) {
  const value = request.headers.authorization;
  if (!value?.startsWith("Bearer ")) {
    throw new AuthError("UNAUTHORIZED", 401, "Faça login para continuar.");
  }
  return value.slice(7).trim();
}

function visibleContent(item: ContentRequest) {
  return ["ready", "approved", "revision_requested"].includes(item.status);
}

function publicContent(item: ContentRequest) {
  return {
    id: item.id,
    contentType: item.contentType,
    objective: item.objective,
    brief: item.brief,
    channel: item.channel,
    status: item.status,
    revisionCount: item.revisionCount,
    maxRevisions: item.maxRevisions,
    revisionInstructions: item.revisionInstructions,
    output: item.output,
    approvedAt: item.approvedAt,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  };
}

export async function registerAgencyApprovalRoutes(app: FastifyInstance, options: Options) {
  const auth = new AuthService({ databaseUrl: options.databaseUrl, databaseSsl: options.databaseSsl });
  const content = new ContentService({ databaseUrl: options.databaseUrl, databaseSsl: options.databaseSsl });
  const assets = new ContentAssetService({
    databaseUrl: options.databaseUrl,
    databaseSsl: options.databaseSsl,
    publicApiUrl: options.publicApiUrl,
  });
  const automation = new ContentAutomationService({
    provider: options.openAiApiKey ? "openai" : "native",
    content,
    assets,
    openAiApiKey: options.openAiApiKey,
    openAiTextModel: options.openAiTextModel,
    openAiImageModel: options.openAiImageModel,
  });
  const pool: Pool | undefined = options.databaseUrl
    ? new PgPool({
        connectionString: options.databaseUrl,
        ssl: options.databaseSsl ? { rejectUnauthorized: false } : undefined,
        max: 2,
      })
    : undefined;
  const memoryLinks = new Map<string, MemoryLink>();

  await Promise.all([auth.initialize(), content.initialize(), assets.initialize()]);
  if (pool) {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS modo_agency_approval_links (
        id UUID PRIMARY KEY,
        organization_id TEXT NOT NULL REFERENCES modo_organizations(id) ON DELETE CASCADE,
        brand_id TEXT NOT NULL REFERENCES modo_brands(id) ON DELETE CASCADE,
        token_hash TEXT NOT NULL UNIQUE,
        expires_at TIMESTAMPTZ NOT NULL,
        revoked_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS modo_agency_approval_links_brand_idx
        ON modo_agency_approval_links(organization_id,brand_id,created_at DESC);
      CREATE INDEX IF NOT EXISTS modo_agency_approval_links_token_idx
        ON modo_agency_approval_links(token_hash);
      DELETE FROM modo_agency_approval_links
       WHERE expires_at < NOW() - INTERVAL '30 days';
    `);
  }

  app.addHook("onClose", async () => {
    await Promise.all([auth.close(), content.close(), assets.close(), pool?.end()]);
  });

  async function assertBrand(organizationId: string, brandId: string): Promise<Brand> {
    const brand = (await auth.listBrands(organizationId)).find((item) => item.id === brandId);
    if (!brand) throw new AuthError("BRAND_NOT_FOUND", 404, "Cliente não encontrado nesta agência.");
    return brand;
  }

  async function resolveLink(rawToken: string): Promise<LinkContext> {
    const tokenHash = hashToken(rawToken);
    if (pool) {
      const result = await pool.query<{
        organization_id: string;
        brand_id: string;
        expires_at: Date;
      }>(
        `SELECT organization_id,brand_id,expires_at
           FROM modo_agency_approval_links
          WHERE token_hash=$1 AND revoked_at IS NULL AND expires_at>NOW()
          LIMIT 1`,
        [tokenHash],
      );
      const row = result.rows[0];
      if (!row) throw new ContentError("APPROVAL_LINK_INVALID", 404, "Este link de aprovação expirou ou não é mais válido.");
      return { organizationId: row.organization_id, brandId: row.brand_id, expiresAt: row.expires_at };
    }
    const link = memoryLinks.get(tokenHash);
    if (!link || link.revokedAt || link.expiresAt <= new Date()) {
      throw new ContentError("APPROVAL_LINK_INVALID", 404, "Este link de aprovação expirou ou não é mais válido.");
    }
    return link;
  }

  async function assertLinkedContent(context: LinkContext, contentId: string) {
    const item = await content.getForOrganization(contentId, context.organizationId);
    if (item.brandId !== context.brandId) {
      throw new ContentError("CONTENT_NOT_FOUND", 404, "Conteúdo não encontrado neste portal.");
    }
    return item;
  }

  app.post("/api/v1/agency/brands/:brandId/approval-links", async (request, reply) => {
    const current = await auth.authenticate(bearerToken(request));
    const brandId = z.string().uuid().parse((request.params as { brandId: string }).brandId);
    const brand = await assertBrand(current.organization.id, brandId);
    const rawToken = randomBytes(32).toString("base64url");
    const tokenHash = hashToken(rawToken);
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

    if (pool) {
      await pool.query(
        `UPDATE modo_agency_approval_links
            SET revoked_at=NOW()
          WHERE organization_id=$1 AND brand_id=$2 AND revoked_at IS NULL`,
        [current.organization.id, brandId],
      );
      await pool.query(
        `INSERT INTO modo_agency_approval_links(id,organization_id,brand_id,token_hash,expires_at)
         VALUES($1,$2,$3,$4,$5)`,
        [randomUUID(), current.organization.id, brandId, tokenHash, expiresAt],
      );
    } else {
      for (const link of memoryLinks.values()) {
        if (link.organizationId === current.organization.id && link.brandId === brandId && !link.revokedAt) {
          link.revokedAt = new Date();
        }
      }
      memoryLinks.set(tokenHash, {
        tokenHash,
        organizationId: current.organization.id,
        brandId,
        expiresAt,
        revokedAt: null,
      });
    }

    return reply.code(201).send({
      brandId,
      brandName: brand.name,
      approvalUrl: `${(options.publicWebUrl || "http://localhost:5173").replace(/\/$/, "")}/approve/${rawToken}`,
      expiresAt: expiresAt.toISOString(),
    });
  });

  app.get("/api/v1/agency/approvals/:token", async (request) => {
    const token = z.string().min(20).max(200).parse((request.params as { token: string }).token);
    const context = await resolveLink(token);
    const brand = await assertBrand(context.organizationId, context.brandId);
    const items = (await content.list(context.organizationId))
      .filter((item) => item.brandId === context.brandId && visibleContent(item))
      .map(publicContent);
    return {
      brand: { id: brand.id, name: brand.name },
      expiresAt: context.expiresAt.toISOString(),
      items,
    };
  });

  app.post("/api/v1/agency/approvals/:token/content/:contentId/approve", async (request) => {
    const params = z.object({ token: z.string().min(20).max(200), contentId: z.string().uuid() }).parse(request.params);
    const context = await resolveLink(params.token);
    await assertLinkedContent(context, params.contentId);
    return publicContent(await content.approve(params.contentId, context.organizationId));
  });

  app.post("/api/v1/agency/approvals/:token/content/:contentId/revision", async (request, reply) => {
    const params = z.object({ token: z.string().min(20).max(200), contentId: z.string().uuid() }).parse(request.params);
    const input = ContentRevisionRequestSchema.parse(request.body);
    const context = await resolveLink(params.token);
    await assertLinkedContent(context, params.contentId);
    const revised = await content.requestRevision(params.contentId, context.organizationId, input.instructions);
    const brand = await assertBrand(context.organizationId, context.brandId);
    void automation.dispatch(revised, brand).catch((error) => {
      request.log.error({ error, contentRequestId: revised.id }, "Falha ao gerar revisão solicitada no portal Agency");
    });
    return reply.code(202).send(publicContent(revised));
  });
}
