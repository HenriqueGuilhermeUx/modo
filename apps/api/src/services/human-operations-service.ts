import { createHash, randomUUID } from "node:crypto";
import pg, { type Pool } from "pg";

const { Pool: PgPool } = pg;

interface Options {
  databaseUrl?: string;
  databaseSsl?: boolean;
}

export class HumanOperationsError extends Error {
  constructor(
    public readonly code: string,
    public readonly statusCode: number,
    message: string,
  ) {
    super(message);
    this.name = "HumanOperationsError";
  }
}

function hashToken(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

export class HumanOperationsService {
  private readonly pool?: Pool;

  constructor(options: Options = {}) {
    if (options.databaseUrl) {
      this.pool = new PgPool({
        connectionString: options.databaseUrl,
        ssl: options.databaseSsl ? { rejectUnauthorized: false } : undefined,
        max: 3,
      });
    }
  }

  async initialize() {
    if (!this.pool) return;
    await this.pool.query(`
      ALTER TABLE modo_human_support_requests
        ADD COLUMN IF NOT EXISTS internal_notes TEXT NOT NULL DEFAULT '';
      ALTER TABLE modo_human_support_requests
        ADD COLUMN IF NOT EXISTS assigned_application_id TEXT;
      ALTER TABLE modo_human_support_requests
        ADD COLUMN IF NOT EXISTS triaged_at TIMESTAMPTZ;

      ALTER TABLE modo_specialist_applications
        ADD COLUMN IF NOT EXISTS internal_notes TEXT NOT NULL DEFAULT '';
      ALTER TABLE modo_specialist_applications
        ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ;
    `);
  }

  async close() {
    await this.pool?.end();
  }

  async authenticateAdmin(token: string) {
    if (!token) throw new HumanOperationsError("ADMIN_UNAUTHORIZED", 401, "Acesso administrativo não autorizado.");
    if (!this.pool) throw new HumanOperationsError("DATABASE_REQUIRED", 503, "A operação humana exige PostgreSQL.");
    const result = await this.pool.query(
      `SELECT 1 FROM modo_platform_admin_sessions
       WHERE token_hash=$1 AND expires_at>NOW() LIMIT 1`,
      [hashToken(token)],
    );
    if (!result.rowCount) throw new HumanOperationsError("ADMIN_UNAUTHORIZED", 401, "Sua sessão administrativa expirou.");
  }

  async overview() {
    if (!this.pool) return { support: {}, talent: {} };
    const [support, talent] = await Promise.all([
      this.pool.query<{ status: string; count: number }>(
        `SELECT status,COUNT(*)::int AS count FROM modo_human_support_requests GROUP BY status`,
      ),
      this.pool.query<{ status: string; count: number }>(
        `SELECT status,COUNT(*)::int AS count FROM modo_specialist_applications GROUP BY status`,
      ),
    ]);
    return {
      support: Object.fromEntries(support.rows.map((row) => [row.status, Number(row.count)])),
      talent: Object.fromEntries(talent.rows.map((row) => [row.status, Number(row.count)])),
    };
  }

  async listSupportRequests() {
    if (!this.pool) return [];
    const result = await this.pool.query(
      `SELECT r.*,o.name AS organization_name,b.name AS brand_name,
        u.name AS requester_name,u.email AS requester_email,
        a.name AS assigned_name,a.primary_role AS assigned_role
       FROM modo_human_support_requests r
       JOIN modo_organizations o ON o.id=r.organization_id
       JOIN modo_brands b ON b.id=r.brand_id
       JOIN modo_users u ON u.id=r.user_id
       LEFT JOIN modo_specialist_applications a ON a.id=r.assigned_application_id
       ORDER BY
         CASE r.status WHEN 'requested' THEN 0 WHEN 'triage' THEN 1 WHEN 'proposal' THEN 2 WHEN 'in_progress' THEN 3 ELSE 4 END,
         CASE r.urgency WHEN 'priority' THEN 0 ELSE 1 END,
         r.created_at ASC
       LIMIT 300`,
    );
    return result.rows.map((row) => ({
      id: row.id,
      organizationId: row.organization_id,
      organizationName: row.organization_name,
      brandId: row.brand_id,
      brandName: row.brand_name,
      requesterName: row.requester_name,
      requesterEmail: row.requester_email,
      contentRequestId: row.content_request_id,
      type: row.support_type,
      context: row.context,
      desiredOutcome: row.desired_outcome,
      urgency: row.urgency,
      status: row.status,
      pricingStatus: row.pricing_status,
      internalNotes: row.internal_notes || "",
      assignedApplicationId: row.assigned_application_id,
      assignedName: row.assigned_name || null,
      assignedRole: row.assigned_role || null,
      createdAt: row.created_at.toISOString(),
      updatedAt: row.updated_at.toISOString(),
    }));
  }

  async updateSupportRequest(id: string, input: {
    status?: string;
    pricingStatus?: string;
    internalNotes?: string;
    assignedApplicationId?: string | null;
  }) {
    if (!this.pool) throw new HumanOperationsError("DATABASE_REQUIRED", 503, "A operação humana exige PostgreSQL.");
    if (input.assignedApplicationId) {
      const candidate = await this.pool.query(
        "SELECT 1 FROM modo_specialist_applications WHERE id=$1 AND status IN ('approved','talent_pool') LIMIT 1",
        [input.assignedApplicationId],
      );
      if (!candidate.rowCount) {
        throw new HumanOperationsError("SPECIALIST_NOT_AVAILABLE", 409, "Selecione um profissional aprovado ou no banco de talentos.");
      }
    }
    const result = await this.pool.query(
      `UPDATE modo_human_support_requests SET
        status=COALESCE($2,status),
        pricing_status=COALESCE($3,pricing_status),
        internal_notes=COALESCE($4,internal_notes),
        assigned_application_id=$5,
        triaged_at=CASE WHEN COALESCE($2,status)<>'requested' THEN COALESCE(triaged_at,NOW()) ELSE triaged_at END,
        updated_at=NOW()
       WHERE id=$1 RETURNING id,status,pricing_status,internal_notes,assigned_application_id,updated_at`,
      [id,input.status || null,input.pricingStatus || null,input.internalNotes ?? null,input.assignedApplicationId ?? null],
    );
    if (!result.rowCount) throw new HumanOperationsError("SUPPORT_REQUEST_NOT_FOUND", 404, "Pedido de apoio não encontrado.");
    await this.audit("human_support.updated", "human_support_request", id, input);
    return result.rows[0];
  }

  async listApplications() {
    if (!this.pool) return [];
    const result = await this.pool.query(
      `SELECT * FROM modo_specialist_applications
       ORDER BY
         CASE status WHEN 'received' THEN 0 WHEN 'under_review' THEN 1 WHEN 'approved' THEN 2 WHEN 'talent_pool' THEN 3 ELSE 4 END,
         created_at ASC
       LIMIT 500`,
    );
    return result.rows.map((row) => ({
      id: row.id,
      name: row.name,
      email: row.email,
      whatsapp: row.whatsapp,
      city: row.city,
      primaryRole: row.primary_role,
      secondaryRoles: row.secondary_roles,
      experienceYears: Number(row.experience_years),
      portfolioUrl: row.portfolio_url,
      linkedinUrl: row.linkedin_url,
      availability: row.availability,
      engagementPreference: row.engagement_preference,
      about: row.about,
      status: row.status,
      internalNotes: row.internal_notes || "",
      createdAt: row.created_at.toISOString(),
      updatedAt: row.updated_at.toISOString(),
    }));
  }

  async updateApplication(id: string, input: { status?: string; internalNotes?: string }) {
    if (!this.pool) throw new HumanOperationsError("DATABASE_REQUIRED", 503, "A operação humana exige PostgreSQL.");
    const result = await this.pool.query(
      `UPDATE modo_specialist_applications SET
        status=COALESCE($2,status),
        internal_notes=COALESCE($3,internal_notes),
        reviewed_at=CASE WHEN COALESCE($2,status)<>'received' THEN COALESCE(reviewed_at,NOW()) ELSE reviewed_at END,
        updated_at=NOW()
       WHERE id=$1 RETURNING id,status,internal_notes,updated_at`,
      [id,input.status || null,input.internalNotes ?? null],
    );
    if (!result.rowCount) throw new HumanOperationsError("APPLICATION_NOT_FOUND", 404, "Candidatura não encontrada.");
    await this.audit("specialist_application.updated", "specialist_application", id, input);
    return result.rows[0];
  }

  private async audit(action: string, targetType: string, targetId: string, metadata: unknown) {
    if (!this.pool) return;
    await this.pool.query(
      `INSERT INTO modo_admin_audit_log(id,action,target_type,target_id,metadata)
       VALUES($1,$2,$3,$4,$5::jsonb)`,
      [randomUUID(),action,targetType,targetId,JSON.stringify(metadata)],
    );
  }
}
