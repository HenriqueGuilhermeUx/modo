import type {
  ContentRequest,
  ContentRequestCreate,
  GeneratedContent,
} from "@modo/contracts/content";
import pg, { type Pool } from "pg";

const { Pool: PgPool } = pg;

interface ContentServiceOptions {
  databaseUrl?: string;
  databaseSsl?: boolean;
}

type Row = {
  id: string;
  organization_id: string;
  brand_id: string;
  content_type: ContentRequest["contentType"];
  objective: ContentRequest["objective"];
  brief: string;
  channel: string;
  status: ContentRequest["status"];
  credits_charged: number;
  revision_count: number;
  max_revisions: number;
  revision_instructions: string | null;
  output: GeneratedContent | null;
  error: string | null;
  provider_run_id: string | null;
  approved_at: Date | null;
  created_at: Date;
  updated_at: Date;
};

function mapRow(row: Row): ContentRequest {
  return {
    id: row.id,
    organizationId: row.organization_id,
    brandId: row.brand_id,
    contentType: row.content_type,
    objective: row.objective,
    brief: row.brief,
    channel: row.channel,
    status: row.status,
    creditsCharged: row.credits_charged,
    revisionCount: row.revision_count,
    maxRevisions: row.max_revisions,
    revisionInstructions: row.revision_instructions,
    output: row.output,
    error: row.error,
    providerRunId: row.provider_run_id,
    approvedAt: row.approved_at?.toISOString() ?? null,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

export class ContentError extends Error {
  constructor(
    public readonly code: string,
    public readonly statusCode: number,
    message: string,
  ) {
    super(message);
    this.name = "ContentError";
  }
}

export class ContentService {
  private readonly pool?: Pool;
  private readonly items: ContentRequest[] = [];

  constructor(options: ContentServiceOptions = {}) {
    if (options.databaseUrl) {
      this.pool = new PgPool({
        connectionString: options.databaseUrl,
        ssl: options.databaseSsl ? { rejectUnauthorized: false } : undefined,
        max: 5,
      });
    }
  }

  get storage(): "memory" | "postgres" {
    return this.pool ? "postgres" : "memory";
  }

  async initialize() {
    if (!this.pool) return;
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS modo_content_requests (
        id TEXT PRIMARY KEY,
        organization_id TEXT NOT NULL REFERENCES modo_organizations(id) ON DELETE CASCADE,
        brand_id TEXT NOT NULL REFERENCES modo_brands(id) ON DELETE CASCADE,
        content_type TEXT NOT NULL,
        objective TEXT NOT NULL,
        brief TEXT NOT NULL,
        channel TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'queued',
        credits_charged INTEGER NOT NULL,
        revision_count INTEGER NOT NULL DEFAULT 0,
        max_revisions INTEGER NOT NULL DEFAULT 1,
        revision_instructions TEXT,
        output JSONB,
        error TEXT,
        provider_run_id TEXT,
        approved_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      ALTER TABLE modo_content_requests ADD COLUMN IF NOT EXISTS revision_count INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE modo_content_requests ADD COLUMN IF NOT EXISTS max_revisions INTEGER NOT NULL DEFAULT 1;
      ALTER TABLE modo_content_requests ADD COLUMN IF NOT EXISTS revision_instructions TEXT;
      ALTER TABLE modo_content_requests ADD COLUMN IF NOT EXISTS provider_run_id TEXT;
      ALTER TABLE modo_content_requests ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ;

      CREATE INDEX IF NOT EXISTS modo_content_requests_org_idx
        ON modo_content_requests(organization_id, created_at DESC);
    `);
  }

  async close() {
    await this.pool?.end();
  }

  async create(
    id: string,
    organizationId: string,
    input: ContentRequestCreate,
    creditsCharged: number,
    maxRevisions: number,
  ): Promise<ContentRequest> {
    if (this.pool) {
      const result = await this.pool.query<Row>(
        `INSERT INTO modo_content_requests(
          id, organization_id, brand_id, content_type, objective, brief,
          channel, credits_charged, max_revisions
        ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)
        RETURNING *`,
        [
          id,
          organizationId,
          input.brandId,
          input.contentType,
          input.objective,
          input.brief,
          input.channel,
          creditsCharged,
          maxRevisions,
        ],
      );
      return mapRow(result.rows[0]);
    }

    const now = new Date().toISOString();
    const item: ContentRequest = {
      id,
      organizationId,
      brandId: input.brandId,
      contentType: input.contentType,
      objective: input.objective,
      brief: input.brief,
      channel: input.channel,
      status: "queued",
      creditsCharged,
      revisionCount: 0,
      maxRevisions,
      revisionInstructions: null,
      output: null,
      error: null,
      providerRunId: null,
      approvedAt: null,
      createdAt: now,
      updatedAt: now,
    };
    this.items.unshift(item);
    return item;
  }

  async list(organizationId: string): Promise<ContentRequest[]> {
    if (this.pool) {
      const result = await this.pool.query<Row>(
        `SELECT * FROM modo_content_requests
         WHERE organization_id=$1
         ORDER BY created_at DESC
         LIMIT 100`,
        [organizationId],
      );
      return result.rows.map(mapRow);
    }
    return this.items.filter((item) => item.organizationId === organizationId);
  }

  async getForOrganization(id: string, organizationId: string) {
    const item = await this.getInternal(id);
    if (!item || item.organizationId !== organizationId) {
      throw new ContentError("CONTENT_NOT_FOUND", 404, "Pedido de conteúdo não encontrado.");
    }
    return item;
  }

  async getInternal(id: string): Promise<ContentRequest | null> {
    if (this.pool) {
      const result = await this.pool.query<Row>(
        "SELECT * FROM modo_content_requests WHERE id=$1 LIMIT 1",
        [id],
      );
      return result.rowCount ? mapRow(result.rows[0]) : null;
    }
    return this.items.find((item) => item.id === id) ?? null;
  }

  async markProcessing(id: string) {
    return this.updateInternal(id, (item) => ({
      ...item,
      status: "processing",
      error: null,
      updatedAt: new Date().toISOString(),
    }), `UPDATE modo_content_requests
        SET status='processing', error=NULL, updated_at=NOW()
        WHERE id=$1 AND status IN ('queued','revision_requested')
        RETURNING *`);
  }

  async complete(id: string, output: GeneratedContent, providerRunId?: string) {
    if (this.pool) {
      const result = await this.pool.query<Row>(
        `UPDATE modo_content_requests
         SET status='ready', output=$2::jsonb, error=NULL,
             provider_run_id=COALESCE($3, provider_run_id), updated_at=NOW()
         WHERE id=$1 AND status IN ('queued','processing','revision_requested')
         RETURNING *`,
        [id, JSON.stringify(output), providerRunId ?? null],
      );
      if (!result.rowCount) throw this.invalidTransition();
      return mapRow(result.rows[0]);
    }
    return this.updateMemory(id, (item) => ({
      ...item,
      status: "ready",
      output,
      error: null,
      providerRunId: providerRunId ?? item.providerRunId,
      updatedAt: new Date().toISOString(),
    }));
  }

  async fail(id: string, error: string, providerRunId?: string) {
    if (this.pool) {
      const result = await this.pool.query<Row>(
        `UPDATE modo_content_requests
         SET status='failed', error=$2,
             provider_run_id=COALESCE($3, provider_run_id), updated_at=NOW()
         WHERE id=$1 AND status IN ('queued','processing','revision_requested')
         RETURNING *`,
        [id, error, providerRunId ?? null],
      );
      if (!result.rowCount) throw this.invalidTransition();
      return mapRow(result.rows[0]);
    }
    return this.updateMemory(id, (item) => ({
      ...item,
      status: "failed",
      error,
      providerRunId: providerRunId ?? item.providerRunId,
      updatedAt: new Date().toISOString(),
    }));
  }

  async approve(id: string, organizationId: string) {
    await this.getForOrganization(id, organizationId);
    if (this.pool) {
      const result = await this.pool.query<Row>(
        `UPDATE modo_content_requests
         SET status='approved', approved_at=NOW(), updated_at=NOW()
         WHERE id=$1 AND organization_id=$2 AND status='ready'
         RETURNING *`,
        [id, organizationId],
      );
      if (!result.rowCount) throw this.invalidTransition("Somente conteúdos prontos podem ser aprovados.");
      return mapRow(result.rows[0]);
    }
    return this.updateMemory(id, (item) => {
      if (item.organizationId !== organizationId || item.status !== "ready") {
        throw this.invalidTransition("Somente conteúdos prontos podem ser aprovados.");
      }
      const now = new Date().toISOString();
      return { ...item, status: "approved", approvedAt: now, updatedAt: now };
    });
  }

  async requestRevision(id: string, organizationId: string, instructions: string) {
    const current = await this.getForOrganization(id, organizationId);
    if (current.status !== "ready") {
      throw this.invalidTransition("A revisão só pode ser solicitada para um conteúdo pronto.");
    }
    if (current.revisionCount >= current.maxRevisions) {
      throw new ContentError(
        "REVISION_LIMIT_REACHED",
        409,
        "O limite de revisões incluídas neste plano foi atingido.",
      );
    }

    if (this.pool) {
      const result = await this.pool.query<Row>(
        `UPDATE modo_content_requests
         SET status='revision_requested', revision_count=revision_count+1,
             revision_instructions=$3, error=NULL, updated_at=NOW()
         WHERE id=$1 AND organization_id=$2 AND status='ready'
           AND revision_count < max_revisions
         RETURNING *`,
        [id, organizationId, instructions],
      );
      if (!result.rowCount) throw this.invalidTransition();
      return mapRow(result.rows[0]);
    }
    return this.updateMemory(id, (item) => ({
      ...item,
      status: "revision_requested",
      revisionCount: item.revisionCount + 1,
      revisionInstructions: instructions,
      error: null,
      updatedAt: new Date().toISOString(),
    }));
  }

  async retry(id: string, organizationId: string) {
    const current = await this.getForOrganization(id, organizationId);
    if (current.status !== "failed") {
      throw this.invalidTransition("Somente pedidos com falha podem ser reenviados.");
    }
    if (this.pool) {
      const result = await this.pool.query<Row>(
        `UPDATE modo_content_requests
         SET status='queued', error=NULL, updated_at=NOW()
         WHERE id=$1 AND organization_id=$2 AND status='failed'
         RETURNING *`,
        [id, organizationId],
      );
      if (!result.rowCount) throw this.invalidTransition();
      return mapRow(result.rows[0]);
    }
    return this.updateMemory(id, (item) => ({
      ...item,
      status: "queued",
      error: null,
      updatedAt: new Date().toISOString(),
    }));
  }

  private async updateInternal(
    id: string,
    memoryUpdate: (item: ContentRequest) => ContentRequest,
    query: string,
  ) {
    if (this.pool) {
      const result = await this.pool.query<Row>(query, [id]);
      if (!result.rowCount) throw this.invalidTransition();
      return mapRow(result.rows[0]);
    }
    return this.updateMemory(id, memoryUpdate);
  }

  private updateMemory(id: string, update: (item: ContentRequest) => ContentRequest) {
    const index = this.items.findIndex((item) => item.id === id);
    if (index < 0) {
      throw new ContentError("CONTENT_NOT_FOUND", 404, "Pedido de conteúdo não encontrado.");
    }
    const next = update(this.items[index]);
    this.items[index] = next;
    return next;
  }

  private invalidTransition(message = "Este pedido não pode mudar para o estado solicitado.") {
    return new ContentError("INVALID_CONTENT_TRANSITION", 409, message);
  }
}
