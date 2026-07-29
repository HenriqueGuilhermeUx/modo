import {
  type BrandFoundationProfile,
  type BrandFoundationUpsert,
  type ChannelMap,
  type ChannelMapUpsert,
  type HumanSupportRequest,
  type HumanSupportRequestCreate,
  type RevenueMap,
  type RevenueMapUpsert,
  type SpecialistApplication,
  type SpecialistApplicationCreate,
} from "@modo/contracts/strategy-network";
import { createHash, randomUUID } from "node:crypto";
import pg, { type Pool } from "pg";

const { Pool: PgPool } = pg;

type AuthContext = {
  userId: string;
  organizationId: string;
  email: string;
};

interface Options {
  databaseUrl?: string;
  databaseSsl?: boolean;
}

export class StrategyNetworkError extends Error {
  constructor(
    public readonly code: string,
    public readonly statusCode: number,
    message: string,
  ) {
    super(message);
    this.name = "StrategyNetworkError";
  }
}

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function nowIso() {
  return new Date().toISOString();
}

export class StrategyNetworkService {
  private readonly pool?: Pool;
  private readonly foundations = new Map<string, BrandFoundationProfile>();
  private readonly channelMaps = new Map<string, ChannelMap>();
  private readonly revenueMaps = new Map<string, RevenueMap>();
  private readonly supportRequests: HumanSupportRequest[] = [];
  private readonly applications: SpecialistApplication[] = [];

  constructor(options: Options = {}) {
    if (options.databaseUrl) {
      this.pool = new PgPool({
        connectionString: options.databaseUrl,
        ssl: options.databaseSsl ? { rejectUnauthorized: false } : undefined,
        max: 4,
      });
    }
  }

  get storage(): "postgres" | "memory" {
    return this.pool ? "postgres" : "memory";
  }

  async initialize() {
    if (!this.pool) return;
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS modo_brand_foundations (
        brand_id TEXT PRIMARY KEY REFERENCES modo_brands(id) ON DELETE CASCADE,
        organization_id TEXT NOT NULL REFERENCES modo_organizations(id) ON DELETE CASCADE,
        foundation JSONB NOT NULL DEFAULT '{}'::jsonb,
        status TEXT NOT NULL DEFAULT 'draft',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS modo_brand_foundations_org_idx
        ON modo_brand_foundations(organization_id, updated_at DESC);

      CREATE TABLE IF NOT EXISTS modo_channel_maps (
        brand_id TEXT PRIMARY KEY REFERENCES modo_brands(id) ON DELETE CASCADE,
        organization_id TEXT NOT NULL REFERENCES modo_organizations(id) ON DELETE CASCADE,
        channels JSONB NOT NULL DEFAULT '[]'::jsonb,
        status TEXT NOT NULL DEFAULT 'draft',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS modo_channel_maps_org_idx
        ON modo_channel_maps(organization_id, updated_at DESC);

      CREATE TABLE IF NOT EXISTS modo_revenue_maps (
        brand_id TEXT PRIMARY KEY REFERENCES modo_brands(id) ON DELETE CASCADE,
        organization_id TEXT NOT NULL REFERENCES modo_organizations(id) ON DELETE CASCADE,
        payload JSONB NOT NULL DEFAULT '{}'::jsonb,
        status TEXT NOT NULL DEFAULT 'draft',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS modo_revenue_maps_org_idx
        ON modo_revenue_maps(organization_id, updated_at DESC);

      CREATE TABLE IF NOT EXISTS modo_human_support_requests (
        id TEXT PRIMARY KEY,
        organization_id TEXT NOT NULL REFERENCES modo_organizations(id) ON DELETE CASCADE,
        user_id TEXT NOT NULL REFERENCES modo_users(id) ON DELETE CASCADE,
        brand_id TEXT NOT NULL REFERENCES modo_brands(id) ON DELETE CASCADE,
        content_request_id TEXT REFERENCES modo_content_requests(id) ON DELETE SET NULL,
        support_type TEXT NOT NULL,
        context TEXT NOT NULL,
        desired_outcome TEXT NOT NULL DEFAULT '',
        urgency TEXT NOT NULL DEFAULT 'normal',
        status TEXT NOT NULL DEFAULT 'requested',
        pricing_status TEXT NOT NULL DEFAULT 'under_review',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS modo_human_support_org_idx
        ON modo_human_support_requests(organization_id, created_at DESC);

      CREATE TABLE IF NOT EXISTS modo_specialist_applications (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        email TEXT NOT NULL,
        whatsapp TEXT NOT NULL DEFAULT '',
        city TEXT NOT NULL DEFAULT '',
        primary_role TEXT NOT NULL,
        secondary_roles TEXT[] NOT NULL DEFAULT '{}',
        experience_years INTEGER NOT NULL DEFAULT 0,
        portfolio_url TEXT NOT NULL,
        linkedin_url TEXT NOT NULL DEFAULT '',
        availability TEXT NOT NULL,
        engagement_preference TEXT NOT NULL,
        about TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'received',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS modo_specialist_applications_status_idx
        ON modo_specialist_applications(status, created_at DESC);
      CREATE UNIQUE INDEX IF NOT EXISTS modo_specialist_applications_email_portfolio_idx
        ON modo_specialist_applications(LOWER(email), portfolio_url);
    `);
  }

  async close() {
    await this.pool?.end();
  }

  async authenticate(token: string): Promise<AuthContext> {
    if (!token) throw new StrategyNetworkError("UNAUTHORIZED", 401, "Faça login para continuar.");
    if (!this.pool) {
      throw new StrategyNetworkError(
        "DATABASE_REQUIRED",
        503,
        "A Base Estratégica precisa do PostgreSQL para funcionar neste ambiente.",
      );
    }
    const result = await this.pool.query<{
      user_id: string;
      organization_id: string;
      email: string;
    }>(
      `SELECT s.user_id, s.organization_id, u.email
       FROM modo_sessions s
       JOIN modo_users u ON u.id=s.user_id
       WHERE s.token_hash=$1 AND s.expires_at>NOW()
       LIMIT 1`,
      [hashToken(token)],
    );
    const row = result.rows[0];
    if (!row) throw new StrategyNetworkError("UNAUTHORIZED", 401, "Sua sessão expirou. Entre novamente.");
    return { userId: row.user_id, organizationId: row.organization_id, email: row.email };
  }

  private async assertBrand(organizationId: string, brandId: string) {
    if (!this.pool) return;
    const result = await this.pool.query(
      "SELECT 1 FROM modo_brands WHERE id=$1 AND organization_id=$2 LIMIT 1",
      [brandId, organizationId],
    );
    if (!result.rowCount) {
      throw new StrategyNetworkError("BRAND_NOT_FOUND", 404, "Marca não encontrada nesta organização.");
    }
  }

  async getFoundation(organizationId: string, brandId: string): Promise<BrandFoundationProfile | null> {
    await this.assertBrand(organizationId, brandId);
    if (!this.pool) return this.foundations.get(`${organizationId}:${brandId}`) ?? null;
    const result = await this.pool.query<{
      foundation: BrandFoundationProfile["foundation"];
      status: BrandFoundationProfile["status"];
      updated_at: Date;
    }>(
      "SELECT foundation,status,updated_at FROM modo_brand_foundations WHERE brand_id=$1 AND organization_id=$2 LIMIT 1",
      [brandId, organizationId],
    );
    const row = result.rows[0];
    return row ? { organizationId, brandId, foundation: row.foundation, status: row.status, updatedAt: row.updated_at.toISOString() } : null;
  }

  async upsertFoundation(organizationId: string, input: BrandFoundationUpsert): Promise<BrandFoundationProfile> {
    await this.assertBrand(organizationId, input.brandId);
    if (!this.pool) {
      const item = { ...input, organizationId, updatedAt: nowIso() };
      this.foundations.set(`${organizationId}:${input.brandId}`, item);
      return item;
    }
    const result = await this.pool.query<{ foundation: BrandFoundationProfile["foundation"]; status: BrandFoundationProfile["status"]; updated_at: Date }>(
      `INSERT INTO modo_brand_foundations(brand_id,organization_id,foundation,status,updated_at)
       VALUES($1,$2,$3::jsonb,$4,NOW())
       ON CONFLICT(brand_id) DO UPDATE SET
         foundation=EXCLUDED.foundation,status=EXCLUDED.status,updated_at=NOW()
       WHERE modo_brand_foundations.organization_id=EXCLUDED.organization_id
       RETURNING foundation,status,updated_at`,
      [input.brandId, organizationId, JSON.stringify(input.foundation), input.status],
    );
    const row = result.rows[0];
    return { organizationId, brandId: input.brandId, foundation: row.foundation, status: row.status, updatedAt: row.updated_at.toISOString() };
  }

  async getChannelMap(organizationId: string, brandId: string): Promise<ChannelMap | null> {
    await this.assertBrand(organizationId, brandId);
    if (!this.pool) return this.channelMaps.get(`${organizationId}:${brandId}`) ?? null;
    const result = await this.pool.query<{ channels: ChannelMap["channels"]; status: ChannelMap["status"]; updated_at: Date }>(
      "SELECT channels,status,updated_at FROM modo_channel_maps WHERE brand_id=$1 AND organization_id=$2 LIMIT 1",
      [brandId, organizationId],
    );
    const row = result.rows[0];
    return row ? { organizationId, brandId, channels: row.channels, status: row.status, updatedAt: row.updated_at.toISOString() } : null;
  }

  async upsertChannelMap(organizationId: string, input: ChannelMapUpsert): Promise<ChannelMap> {
    await this.assertBrand(organizationId, input.brandId);
    if (!this.pool) {
      const item = { ...input, organizationId, updatedAt: nowIso() };
      this.channelMaps.set(`${organizationId}:${input.brandId}`, item);
      return item;
    }
    const result = await this.pool.query<{ channels: ChannelMap["channels"]; status: ChannelMap["status"]; updated_at: Date }>(
      `INSERT INTO modo_channel_maps(brand_id,organization_id,channels,status,updated_at)
       VALUES($1,$2,$3::jsonb,$4,NOW())
       ON CONFLICT(brand_id) DO UPDATE SET
         channels=EXCLUDED.channels,status=EXCLUDED.status,updated_at=NOW()
       WHERE modo_channel_maps.organization_id=EXCLUDED.organization_id
       RETURNING channels,status,updated_at`,
      [input.brandId, organizationId, JSON.stringify(input.channels), input.status],
    );
    const row = result.rows[0];
    return { organizationId, brandId: input.brandId, channels: row.channels, status: row.status, updatedAt: row.updated_at.toISOString() };
  }

  async getRevenueMap(organizationId: string, brandId: string): Promise<RevenueMap | null> {
    await this.assertBrand(organizationId, brandId);
    if (!this.pool) return this.revenueMaps.get(`${organizationId}:${brandId}`) ?? null;
    const result = await this.pool.query<{ payload: Omit<RevenueMap, "organizationId" | "updatedAt">; status: RevenueMap["status"]; updated_at: Date }>(
      "SELECT payload,status,updated_at FROM modo_revenue_maps WHERE brand_id=$1 AND organization_id=$2 LIMIT 1",
      [brandId, organizationId],
    );
    const row = result.rows[0];
    return row ? { ...row.payload, organizationId, brandId, status: row.status, updatedAt: row.updated_at.toISOString() } : null;
  }

  async upsertRevenueMap(organizationId: string, input: RevenueMapUpsert): Promise<RevenueMap> {
    await this.assertBrand(organizationId, input.brandId);
    if (!this.pool) {
      const item = { ...input, organizationId, updatedAt: nowIso() };
      this.revenueMaps.set(`${organizationId}:${input.brandId}`, item);
      return item;
    }
    const payload = { ...input };
    const result = await this.pool.query<{ payload: Omit<RevenueMap, "organizationId" | "updatedAt">; status: RevenueMap["status"]; updated_at: Date }>(
      `INSERT INTO modo_revenue_maps(brand_id,organization_id,payload,status,updated_at)
       VALUES($1,$2,$3::jsonb,$4,NOW())
       ON CONFLICT(brand_id) DO UPDATE SET
         payload=EXCLUDED.payload,status=EXCLUDED.status,updated_at=NOW()
       WHERE modo_revenue_maps.organization_id=EXCLUDED.organization_id
       RETURNING payload,status,updated_at`,
      [input.brandId, organizationId, JSON.stringify(payload), input.status],
    );
    const row = result.rows[0];
    return { ...row.payload, organizationId, brandId: input.brandId, status: row.status, updatedAt: row.updated_at.toISOString() };
  }

  async createSupportRequest(context: AuthContext, input: HumanSupportRequestCreate): Promise<HumanSupportRequest> {
    await this.assertBrand(context.organizationId, input.brandId);
    const createdAt = nowIso();
    const item: HumanSupportRequest = {
      id: randomUUID(),
      organizationId: context.organizationId,
      userId: context.userId,
      brandId: input.brandId,
      contentRequestId: input.contentRequestId ?? null,
      type: input.type,
      context: input.context,
      desiredOutcome: input.desiredOutcome,
      urgency: input.urgency,
      status: "requested",
      pricingStatus: "under_review",
      createdAt,
      updatedAt: createdAt,
    };
    if (!this.pool) {
      this.supportRequests.unshift(item);
      return item;
    }
    const result = await this.pool.query<{
      id: string; organization_id: string; user_id: string; brand_id: string; content_request_id: string | null;
      support_type: HumanSupportRequest["type"]; context: string; desired_outcome: string; urgency: HumanSupportRequest["urgency"];
      status: HumanSupportRequest["status"]; pricing_status: HumanSupportRequest["pricingStatus"]; created_at: Date; updated_at: Date;
    }>(
      `INSERT INTO modo_human_support_requests(
        id,organization_id,user_id,brand_id,content_request_id,support_type,context,desired_outcome,urgency
      ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [item.id,item.organizationId,item.userId,item.brandId,item.contentRequestId,item.type,item.context,item.desiredOutcome,item.urgency],
    );
    return this.mapSupportRow(result.rows[0]);
  }

  private mapSupportRow(row: {
    id: string; organization_id: string; user_id: string; brand_id: string; content_request_id: string | null;
    support_type: HumanSupportRequest["type"]; context: string; desired_outcome: string; urgency: HumanSupportRequest["urgency"];
    status: HumanSupportRequest["status"]; pricing_status: HumanSupportRequest["pricingStatus"]; created_at: Date; updated_at: Date;
  }): HumanSupportRequest {
    return {
      id: row.id,
      organizationId: row.organization_id,
      userId: row.user_id,
      brandId: row.brand_id,
      contentRequestId: row.content_request_id,
      type: row.support_type,
      context: row.context,
      desiredOutcome: row.desired_outcome,
      urgency: row.urgency,
      status: row.status,
      pricingStatus: row.pricing_status,
      createdAt: row.created_at.toISOString(),
      updatedAt: row.updated_at.toISOString(),
    };
  }

  async listSupportRequests(organizationId: string): Promise<HumanSupportRequest[]> {
    if (!this.pool) return this.supportRequests.filter((item) => item.organizationId === organizationId);
    const result = await this.pool.query(
      "SELECT * FROM modo_human_support_requests WHERE organization_id=$1 ORDER BY created_at DESC LIMIT 100",
      [organizationId],
    );
    return result.rows.map((row) => this.mapSupportRow(row));
  }

  async createSpecialistApplication(input: SpecialistApplicationCreate): Promise<SpecialistApplication> {
    const createdAt = nowIso();
    const item: SpecialistApplication = {
      ...input,
      id: randomUUID(),
      status: "received",
      createdAt,
      updatedAt: createdAt,
    };
    if (!this.pool) {
      const duplicate = this.applications.some((candidate) => candidate.email === input.email && candidate.portfolioUrl === input.portfolioUrl);
      if (duplicate) throw new StrategyNetworkError("APPLICATION_ALREADY_EXISTS", 409, "Esta candidatura já foi recebida.");
      this.applications.unshift(item);
      return item;
    }
    try {
      const result = await this.pool.query<{
        id: string; name: string; email: string; whatsapp: string; city: string;
        primary_role: SpecialistApplication["primaryRole"]; secondary_roles: SpecialistApplication["secondaryRoles"];
        experience_years: number; portfolio_url: string; linkedin_url: string;
        availability: SpecialistApplication["availability"]; engagement_preference: SpecialistApplication["engagementPreference"];
        about: string; status: SpecialistApplication["status"]; created_at: Date; updated_at: Date;
      }>(
        `INSERT INTO modo_specialist_applications(
          id,name,email,whatsapp,city,primary_role,secondary_roles,experience_years,
          portfolio_url,linkedin_url,availability,engagement_preference,about
        ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
        [item.id,item.name,item.email,item.whatsapp,item.city,item.primaryRole,item.secondaryRoles,item.experienceYears,item.portfolioUrl,item.linkedinUrl || "",item.availability,item.engagementPreference,item.about],
      );
      const row = result.rows[0];
      return {
        id: row.id,
        name: row.name,
        email: row.email,
        whatsapp: row.whatsapp,
        city: row.city,
        primaryRole: row.primary_role,
        secondaryRoles: row.secondary_roles,
        experienceYears: row.experience_years,
        portfolioUrl: row.portfolio_url,
        linkedinUrl: row.linkedin_url,
        availability: row.availability,
        engagementPreference: row.engagement_preference,
        about: row.about,
        consent: true,
        status: row.status,
        createdAt: row.created_at.toISOString(),
        updatedAt: row.updated_at.toISOString(),
      };
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (code === "23505") throw new StrategyNetworkError("APPLICATION_ALREADY_EXISTS", 409, "Esta candidatura já foi recebida.");
      throw error;
    }
  }
}
