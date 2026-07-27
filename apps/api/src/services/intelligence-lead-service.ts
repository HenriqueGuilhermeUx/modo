import { createHash, randomUUID } from "node:crypto";
import pg, { type Pool, type PoolClient } from "pg";

const { Pool: PgPool } = pg;

export type IntelligenceLeadStatus =
  | "new"
  | "qualified"
  | "contacted"
  | "negotiating"
  | "won"
  | "lost"
  | "archived";

export type IntelligenceLeadPriority = "low" | "medium" | "high";

export interface IntelligenceLeadUpdate {
  status?: IntelligenceLeadStatus;
  priority?: IntelligenceLeadPriority;
  notes?: string;
}

export interface IntelligenceLead {
  leadId: string;
  position: number;
  businessName: string;
  category: string;
  phone: string;
  website: string;
  rating: number;
  reviewsCount: number;
  address: string;
  city: string;
  state: string;
  countryCode: string;
  mapsUrl: string;
  qualityScore: number;
  contactAvailable: boolean;
  pipelineStatus: IntelligenceLeadStatus;
  priority: IntelligenceLeadPriority;
  notes: string;
  occurrenceCount: number;
  firstSeenAt: string;
  lastSeenAt: string;
}

interface Options {
  databaseUrl?: string;
  databaseSsl?: boolean;
}

interface LeadRow {
  id: string;
  organization_id: string;
  fingerprint: string;
  business_name: string;
  category: string;
  phone: string;
  website: string;
  rating: number;
  reviews_count: number;
  address: string;
  city: string;
  state: string;
  country_code: string;
  maps_url: string;
  quality_score: number;
  pipeline_status: IntelligenceLeadStatus;
  priority: IntelligenceLeadPriority;
  notes: string;
  first_seen_at: Date;
  last_seen_at: Date;
  created_at: Date;
  updated_at: Date;
  occurrence_count?: number;
}

interface MemoryLead extends LeadRow {
  missionIds: Set<string>;
}

interface NormalizedLead {
  position: number;
  businessName: string;
  category: string;
  phone: string;
  website: string;
  rating: number;
  reviewsCount: number;
  address: string;
  city: string;
  state: string;
  countryCode: string;
  mapsUrl: string;
  qualityScore: number;
  fingerprint: string;
}

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function number(value: unknown) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizedWords(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function googlePlaceId(mapsUrl: string) {
  if (!mapsUrl) return "";
  try {
    return new URL(mapsUrl).searchParams.get("query_place_id") || "";
  } catch {
    return "";
  }
}

function fingerprintFor(lead: Omit<NormalizedLead, "fingerprint">) {
  const placeId = googlePlaceId(lead.mapsUrl);
  const phone = lead.phone.replace(/\D/g, "");
  const addressKey = normalizedWords(`${lead.businessName}|${lead.address}|${lead.city}|${lead.state}`);
  const fallback = normalizedWords(`${lead.businessName}|${lead.city}|${lead.category}`);
  const key = placeId
    ? `place:${placeId}`
    : phone.length >= 10
      ? `phone:${phone}`
      : addressKey.length > 8
        ? `address:${addressKey}`
        : `fallback:${fallback}`;
  return createHash("sha256").update(key).digest("hex");
}

function normalizeItem(item: Record<string, unknown>, index: number): NormalizedLead | null {
  const businessName = text(item.businessName) || text(item.title);
  if (!businessName) return null;

  const base = {
    position: Math.max(1, Math.trunc(number(item.position) || index + 1)),
    businessName,
    category: text(item.category) || text(item.categoryName),
    phone: text(item.phone),
    website: text(item.website),
    rating: number(item.rating) || number(item.totalScore),
    reviewsCount: Math.max(0, Math.trunc(number(item.reviewsCount))),
    address: text(item.address) || text(item.street),
    city: text(item.city),
    state: text(item.state),
    countryCode: text(item.countryCode),
    mapsUrl: text(item.mapsUrl) || text(item.url),
    qualityScore: Math.max(0, Math.min(100, Math.trunc(number(item.qualityScore)))),
  };

  return { ...base, fingerprint: fingerprintFor(base) };
}

function mapLead(row: LeadRow, position = 0): IntelligenceLead {
  return {
    leadId: row.id,
    position,
    businessName: row.business_name,
    category: row.category,
    phone: row.phone,
    website: row.website,
    rating: Number(row.rating || 0),
    reviewsCount: Number(row.reviews_count || 0),
    address: row.address,
    city: row.city,
    state: row.state,
    countryCode: row.country_code,
    mapsUrl: row.maps_url,
    qualityScore: Number(row.quality_score || 0),
    contactAvailable: Boolean(row.phone || row.website),
    pipelineStatus: row.pipeline_status,
    priority: row.priority,
    notes: row.notes,
    occurrenceCount: Number(row.occurrence_count || 1),
    firstSeenAt: row.first_seen_at.toISOString(),
    lastSeenAt: row.last_seen_at.toISOString(),
  };
}

export class IntelligenceLeadError extends Error {
  constructor(
    public readonly code: string,
    public readonly statusCode: number,
    message: string,
  ) {
    super(message);
    this.name = "IntelligenceLeadError";
  }
}

export class IntelligenceLeadService {
  private readonly pool?: Pool;
  private readonly memory = new Map<string, MemoryLead>();
  private readonly memoryIndex = new Map<string, string>();

  constructor(options: Options = {}) {
    if (options.databaseUrl) {
      this.pool = new PgPool({
        connectionString: options.databaseUrl,
        ssl: options.databaseSsl ? { rejectUnauthorized: false } : undefined,
        max: 4,
      });
    }
  }

  async initialize() {
    if (!this.pool) return;
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS modo_intelligence_leads (
        id TEXT PRIMARY KEY,
        organization_id TEXT NOT NULL REFERENCES modo_organizations(id) ON DELETE CASCADE,
        fingerprint TEXT NOT NULL,
        business_name TEXT NOT NULL,
        category TEXT NOT NULL DEFAULT '',
        phone TEXT NOT NULL DEFAULT '',
        website TEXT NOT NULL DEFAULT '',
        rating DOUBLE PRECISION NOT NULL DEFAULT 0,
        reviews_count INTEGER NOT NULL DEFAULT 0,
        address TEXT NOT NULL DEFAULT '',
        city TEXT NOT NULL DEFAULT '',
        state TEXT NOT NULL DEFAULT '',
        country_code TEXT NOT NULL DEFAULT '',
        maps_url TEXT NOT NULL DEFAULT '',
        quality_score INTEGER NOT NULL DEFAULT 0,
        pipeline_status TEXT NOT NULL DEFAULT 'new',
        priority TEXT NOT NULL DEFAULT 'medium',
        notes TEXT NOT NULL DEFAULT '',
        first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE(organization_id, fingerprint)
      );

      CREATE TABLE IF NOT EXISTS modo_intelligence_lead_missions (
        lead_id TEXT NOT NULL REFERENCES modo_intelligence_leads(id) ON DELETE CASCADE,
        mission_id TEXT NOT NULL REFERENCES modo_intelligence_missions(id) ON DELETE CASCADE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY(lead_id, mission_id)
      );

      CREATE INDEX IF NOT EXISTS modo_intelligence_leads_org_pipeline_idx
        ON modo_intelligence_leads(organization_id, pipeline_status, priority, updated_at DESC);
      CREATE INDEX IF NOT EXISTS modo_intelligence_lead_missions_mission_idx
        ON modo_intelligence_lead_missions(mission_id, lead_id);
    `);
  }

  async close() {
    await this.pool?.end();
  }

  async syncMissionResults(
    organizationId: string,
    missionId: string,
    items: Record<string, unknown>[],
  ): Promise<IntelligenceLead[]> {
    const normalized = items
      .map(normalizeItem)
      .filter((item): item is NormalizedLead => Boolean(item));

    if (!this.pool) return this.syncMemory(organizationId, missionId, normalized);
    if (!normalized.length) return [];

    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const ordered: Array<{ row: LeadRow; position: number }> = [];

      for (const lead of normalized) {
        const result = await client.query<LeadRow>(
          `INSERT INTO modo_intelligence_leads(
             id,organization_id,fingerprint,business_name,category,phone,website,rating,
             reviews_count,address,city,state,country_code,maps_url,quality_score
           ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
           ON CONFLICT(organization_id,fingerprint) DO UPDATE SET
             business_name=COALESCE(NULLIF(EXCLUDED.business_name,''),modo_intelligence_leads.business_name),
             category=COALESCE(NULLIF(EXCLUDED.category,''),modo_intelligence_leads.category),
             phone=COALESCE(NULLIF(EXCLUDED.phone,''),modo_intelligence_leads.phone),
             website=COALESCE(NULLIF(EXCLUDED.website,''),modo_intelligence_leads.website),
             rating=CASE WHEN EXCLUDED.rating > 0 THEN EXCLUDED.rating ELSE modo_intelligence_leads.rating END,
             reviews_count=GREATEST(EXCLUDED.reviews_count,modo_intelligence_leads.reviews_count),
             address=COALESCE(NULLIF(EXCLUDED.address,''),modo_intelligence_leads.address),
             city=COALESCE(NULLIF(EXCLUDED.city,''),modo_intelligence_leads.city),
             state=COALESCE(NULLIF(EXCLUDED.state,''),modo_intelligence_leads.state),
             country_code=COALESCE(NULLIF(EXCLUDED.country_code,''),modo_intelligence_leads.country_code),
             maps_url=COALESCE(NULLIF(EXCLUDED.maps_url,''),modo_intelligence_leads.maps_url),
             quality_score=GREATEST(EXCLUDED.quality_score,modo_intelligence_leads.quality_score),
             last_seen_at=NOW(),updated_at=NOW()
           RETURNING *`,
          [
            randomUUID(),
            organizationId,
            lead.fingerprint,
            lead.businessName,
            lead.category,
            lead.phone,
            lead.website,
            lead.rating,
            lead.reviewsCount,
            lead.address,
            lead.city,
            lead.state,
            lead.countryCode,
            lead.mapsUrl,
            lead.qualityScore,
          ],
        );
        const row = result.rows[0];
        ordered.push({ row, position: lead.position });
        await client.query(
          `INSERT INTO modo_intelligence_lead_missions(lead_id,mission_id)
           VALUES($1,$2) ON CONFLICT DO NOTHING`,
          [row.id, missionId],
        );
      }

      const ids = ordered.map((item) => item.row.id);
      const counts = await this.occurrenceCounts(client, ids);
      await client.query("COMMIT");
      return ordered.map(({ row, position }) => mapLead({
        ...row,
        occurrence_count: counts.get(row.id) || 1,
      }, position));
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async list(
    organizationId: string,
    filters: {
      status?: IntelligenceLeadStatus;
      priority?: IntelligenceLeadPriority;
      search?: string;
      limit?: number;
    } = {},
  ) {
    const limit = Math.min(500, Math.max(1, Math.trunc(filters.limit || 200)));
    const search = (filters.search || "").trim().toLowerCase();

    if (!this.pool) {
      return [...this.memory.values()]
        .filter((lead) => lead.organization_id === organizationId)
        .filter((lead) => !filters.status || lead.pipeline_status === filters.status)
        .filter((lead) => !filters.priority || lead.priority === filters.priority)
        .filter((lead) => !search || [lead.business_name, lead.phone, lead.city, lead.category]
          .some((value) => value.toLowerCase().includes(search)))
        .sort((a, b) => b.updated_at.getTime() - a.updated_at.getTime())
        .slice(0, limit)
        .map((lead, index) => mapLead({ ...lead, occurrence_count: lead.missionIds.size }, index + 1));
    }

    const result = await this.pool.query<LeadRow>(
      `SELECT l.*,COUNT(lm.mission_id)::int AS occurrence_count
       FROM modo_intelligence_leads l
       LEFT JOIN modo_intelligence_lead_missions lm ON lm.lead_id=l.id
       WHERE l.organization_id=$1
         AND ($2::text IS NULL OR l.pipeline_status=$2)
         AND ($3::text IS NULL OR l.priority=$3)
         AND ($4::text='' OR LOWER(l.business_name) LIKE $5 OR LOWER(l.phone) LIKE $5
              OR LOWER(l.city) LIKE $5 OR LOWER(l.category) LIKE $5)
       GROUP BY l.id
       ORDER BY
         CASE l.priority WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END,
         l.quality_score DESC,l.updated_at DESC
       LIMIT $6`,
      [
        organizationId,
        filters.status || null,
        filters.priority || null,
        search,
        `%${search}%`,
        limit,
      ],
    );
    return result.rows.map((row, index) => mapLead(row, index + 1));
  }

  async update(
    id: string,
    organizationId: string,
    input: IntelligenceLeadUpdate,
  ): Promise<IntelligenceLead> {
    if (!this.pool) {
      const lead = this.memory.get(id);
      if (!lead || lead.organization_id !== organizationId) {
        throw this.notFound();
      }
      if (input.status) lead.pipeline_status = input.status;
      if (input.priority) lead.priority = input.priority;
      if (input.notes !== undefined) lead.notes = input.notes.trim().slice(0, 2000);
      lead.updated_at = new Date();
      return mapLead({ ...lead, occurrence_count: lead.missionIds.size });
    }

    const result = await this.pool.query<LeadRow>(
      `UPDATE modo_intelligence_leads SET
         pipeline_status=COALESCE($3,pipeline_status),
         priority=COALESCE($4,priority),
         notes=COALESCE($5,notes),
         updated_at=NOW()
       WHERE id=$1 AND organization_id=$2
       RETURNING *`,
      [
        id,
        organizationId,
        input.status || null,
        input.priority || null,
        input.notes === undefined ? null : input.notes.trim().slice(0, 2000),
      ],
    );
    const row = result.rows[0];
    if (!row) throw this.notFound();
    const counts = await this.pool.query<{ count: number }>(
      `SELECT COUNT(*)::int AS count FROM modo_intelligence_lead_missions WHERE lead_id=$1`,
      [row.id],
    );
    return mapLead({ ...row, occurrence_count: Number(counts.rows[0]?.count || 1) });
  }

  private async occurrenceCounts(client: PoolClient, ids: string[]) {
    const result = await client.query<{ lead_id: string; count: number }>(
      `SELECT lead_id,COUNT(*)::int AS count
       FROM modo_intelligence_lead_missions
       WHERE lead_id = ANY($1::text[])
       GROUP BY lead_id`,
      [ids],
    );
    return new Map(result.rows.map((row) => [row.lead_id, Number(row.count || 1)]));
  }

  private syncMemory(
    organizationId: string,
    missionId: string,
    normalized: NormalizedLead[],
  ) {
    return normalized.map((lead) => {
      const indexKey = `${organizationId}:${lead.fingerprint}`;
      const existingId = this.memoryIndex.get(indexKey);
      const existing = existingId ? this.memory.get(existingId) : undefined;
      if (existing) {
        existing.business_name = lead.businessName || existing.business_name;
        existing.category = lead.category || existing.category;
        existing.phone = lead.phone || existing.phone;
        existing.website = lead.website || existing.website;
        existing.rating = lead.rating || existing.rating;
        existing.reviews_count = Math.max(existing.reviews_count, lead.reviewsCount);
        existing.address = lead.address || existing.address;
        existing.city = lead.city || existing.city;
        existing.state = lead.state || existing.state;
        existing.country_code = lead.countryCode || existing.country_code;
        existing.maps_url = lead.mapsUrl || existing.maps_url;
        existing.quality_score = Math.max(existing.quality_score, lead.qualityScore);
        existing.last_seen_at = new Date();
        existing.updated_at = new Date();
        existing.missionIds.add(missionId);
        return mapLead({ ...existing, occurrence_count: existing.missionIds.size }, lead.position);
      }

      const now = new Date();
      const row: MemoryLead = {
        id: randomUUID(),
        organization_id: organizationId,
        fingerprint: lead.fingerprint,
        business_name: lead.businessName,
        category: lead.category,
        phone: lead.phone,
        website: lead.website,
        rating: lead.rating,
        reviews_count: lead.reviewsCount,
        address: lead.address,
        city: lead.city,
        state: lead.state,
        country_code: lead.countryCode,
        maps_url: lead.mapsUrl,
        quality_score: lead.qualityScore,
        pipeline_status: "new",
        priority: "medium",
        notes: "",
        first_seen_at: now,
        last_seen_at: now,
        created_at: now,
        updated_at: now,
        missionIds: new Set([missionId]),
      };
      this.memory.set(row.id, row);
      this.memoryIndex.set(indexKey, row.id);
      return mapLead({ ...row, occurrence_count: 1 }, lead.position);
    });
  }

  private notFound() {
    return new IntelligenceLeadError(
      "INTELLIGENCE_LEAD_NOT_FOUND",
      404,
      "Lead comercial não encontrado nesta organização.",
    );
  }
}
