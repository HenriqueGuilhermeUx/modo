import {
  planEntitlements,
  type PlanSlug,
  type PublicPlanSlug,
  type SubscriptionStatus,
} from "@modo/contracts";
import type {
  AdminDiscountCampaign,
  AdminDiscountCampaignCreate,
  AdminInvitation,
  AdminInvitationCreate,
  AdminOrganization,
  AdminOverview,
  AdminSession,
  DiscountQuote,
  InvitationPreview,
  PlatformAdmin,
} from "@modo/contracts/admin";
import {
  createHash,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import pg, { type Pool } from "pg";

const { Pool: PgPool } = pg;

interface Options {
  databaseUrl?: string;
  databaseSsl?: boolean;
  email?: string;
  password?: string;
  name?: string;
  sessionHours?: number;
  publicWebUrl?: string;
}

type AdminSessionRow = {
  token_hash: string;
  expires_at: Date;
};

type InvitationRow = {
  id: string;
  email: string;
  plan_slug: PlanSlug;
  bonus_credits: number;
  note: string;
  status: AdminInvitation["status"];
  expires_at: Date;
  used_at: Date | null;
  revoked_at: Date | null;
  created_at: Date;
};

type CampaignRow = {
  id: string;
  name: string;
  code: string;
  kind: AdminDiscountCampaign["kind"];
  value: number;
  plans: PublicPlanSlug[];
  max_redemptions: number;
  redemptions: number;
  starts_at: Date;
  ends_at: Date;
  active: boolean;
  created_at: Date;
};

function hashToken(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function constantTimeEquals(received: string, expected: string) {
  const actualBuffer = Buffer.from(received, "utf8");
  const expectedBuffer = Buffer.from(expected, "utf8");
  return actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer);
}

function addHours(date: Date, hours: number) {
  return new Date(date.getTime() + hours * 60 * 60 * 1000);
}

function addDays(date: Date, days: number) {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

function mapInvitation(row: InvitationRow): AdminInvitation {
  const now = new Date();
  const effectiveStatus = row.status === "open" && row.expires_at <= now ? "expired" : row.status;
  return {
    id: row.id,
    email: row.email,
    plan: row.plan_slug,
    bonusCredits: Number(row.bonus_credits),
    note: row.note,
    status: effectiveStatus,
    expiresAt: row.expires_at.toISOString(),
    usedAt: row.used_at?.toISOString() ?? null,
    revokedAt: row.revoked_at?.toISOString() ?? null,
    createdAt: row.created_at.toISOString(),
  };
}

function mapCampaign(row: CampaignRow): AdminDiscountCampaign {
  return {
    id: row.id,
    name: row.name,
    code: row.code,
    kind: row.kind,
    value: Number(row.value),
    plans: row.plans,
    maxRedemptions: Number(row.max_redemptions),
    redemptions: Number(row.redemptions),
    startsAt: row.starts_at.toISOString(),
    endsAt: row.ends_at.toISOString(),
    active: row.active,
    createdAt: row.created_at.toISOString(),
  };
}

export class PlatformAdminError extends Error {
  constructor(
    public readonly code: string,
    public readonly statusCode: number,
    message: string,
  ) {
    super(message);
    this.name = "PlatformAdminError";
  }
}

export class PlatformAdminService {
  private readonly pool?: Pool;
  private readonly email: string;
  private readonly password: string;
  private readonly name: string;
  private readonly sessionHours: number;
  private readonly publicWebUrl: string;
  private readonly memorySessions = new Map<string, Date>();

  constructor(options: Options = {}) {
    this.email = (options.email || "").trim().toLowerCase();
    this.password = options.password || "";
    this.name = options.name?.trim() || "Administrador MODO";
    this.sessionHours = options.sessionHours ?? 12;
    this.publicWebUrl = (options.publicWebUrl || "http://localhost:5173").replace(/\/$/, "");
    if (options.databaseUrl) {
      this.pool = new PgPool({
        connectionString: options.databaseUrl,
        ssl: options.databaseSsl ? { rejectUnauthorized: false } : undefined,
        max: 5,
      });
    }
  }

  get enabled() {
    return Boolean(this.email && this.password.length >= 10);
  }

  get admin(): PlatformAdmin {
    return {
      id: "00000000-0000-4000-8000-000000000001",
      name: this.name,
      email: this.email,
      createdAt: "2026-01-01T00:00:00.000Z",
    };
  }

  async initialize() {
    if (!this.pool) return;
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS modo_platform_admin_sessions (
        id TEXT PRIMARY KEY,
        token_hash TEXT NOT NULL UNIQUE,
        expires_at TIMESTAMPTZ NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS modo_platform_admin_sessions_token_idx
        ON modo_platform_admin_sessions(token_hash);

      CREATE TABLE IF NOT EXISTS modo_admin_invitations (
        id TEXT PRIMARY KEY,
        token_hash TEXT NOT NULL UNIQUE,
        email TEXT NOT NULL,
        plan_slug TEXT NOT NULL,
        bonus_credits INTEGER NOT NULL DEFAULT 0,
        note TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'open',
        expires_at TIMESTAMPTZ NOT NULL,
        used_at TIMESTAMPTZ,
        revoked_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS modo_admin_invitations_email_idx
        ON modo_admin_invitations(email, created_at DESC);

      CREATE TABLE IF NOT EXISTS modo_discount_campaigns (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        code TEXT NOT NULL UNIQUE,
        kind TEXT NOT NULL,
        value INTEGER NOT NULL,
        plans TEXT[] NOT NULL,
        max_redemptions INTEGER NOT NULL,
        redemptions INTEGER NOT NULL DEFAULT 0,
        starts_at TIMESTAMPTZ NOT NULL,
        ends_at TIMESTAMPTZ NOT NULL,
        active BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS modo_discount_redemptions (
        id TEXT PRIMARY KEY,
        campaign_id TEXT NOT NULL REFERENCES modo_discount_campaigns(id) ON DELETE CASCADE,
        account_id TEXT NOT NULL REFERENCES modo_organizations(id) ON DELETE CASCADE,
        plan_slug TEXT NOT NULL,
        code TEXT NOT NULL,
        original_price_cents INTEGER NOT NULL,
        final_price_cents INTEGER NOT NULL,
        provider_id TEXT,
        status TEXT NOT NULL DEFAULT 'reserved',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE(campaign_id, account_id, plan_slug)
      );

      CREATE TABLE IF NOT EXISTS modo_admin_audit_log (
        id TEXT PRIMARY KEY,
        action TEXT NOT NULL,
        target_type TEXT NOT NULL,
        target_id TEXT,
        metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
  }

  async close() {
    await this.pool?.end();
  }

  async login(email: string, password: string): Promise<AdminSession> {
    if (!this.enabled) {
      throw new PlatformAdminError("ADMIN_NOT_CONFIGURED", 503, "O administrador da plataforma ainda não foi configurado.");
    }
    const validEmail = constantTimeEquals(email.trim().toLowerCase(), this.email);
    const validPassword = constantTimeEquals(password, this.password);
    if (!validEmail || !validPassword) {
      throw new PlatformAdminError("INVALID_ADMIN_CREDENTIALS", 401, "E-mail ou senha administrativa inválidos.");
    }

    const token = randomBytes(32).toString("base64url");
    const expiresAt = addHours(new Date(), this.sessionHours);
    if (this.pool) {
      await this.pool.query(
        `INSERT INTO modo_platform_admin_sessions(id,token_hash,expires_at)
         VALUES($1,$2,$3)`,
        [randomUUID(), hashToken(token), expiresAt],
      );
    } else {
      this.memorySessions.set(hashToken(token), expiresAt);
    }
    return { token, expiresAt: expiresAt.toISOString(), admin: this.admin };
  }

  async authenticate(token: string) {
    if (!token) throw new PlatformAdminError("ADMIN_UNAUTHORIZED", 401, "Acesso administrativo não autorizado.");
    const tokenHash = hashToken(token);
    if (this.pool) {
      const result = await this.pool.query<AdminSessionRow>(
        `SELECT token_hash,expires_at FROM modo_platform_admin_sessions
         WHERE token_hash=$1 AND expires_at>NOW() LIMIT 1`,
        [tokenHash],
      );
      if (!result.rowCount) throw new PlatformAdminError("ADMIN_UNAUTHORIZED", 401, "Sessão administrativa inválida ou expirada.");
      return this.admin;
    }
    const expiresAt = this.memorySessions.get(tokenHash);
    if (!expiresAt || expiresAt <= new Date()) {
      this.memorySessions.delete(tokenHash);
      throw new PlatformAdminError("ADMIN_UNAUTHORIZED", 401, "Sessão administrativa inválida ou expirada.");
    }
    return this.admin;
  }

  async logout(token: string) {
    const tokenHash = hashToken(token);
    if (this.pool) await this.pool.query("DELETE FROM modo_platform_admin_sessions WHERE token_hash=$1", [tokenHash]);
    else this.memorySessions.delete(tokenHash);
  }

  async overview(): Promise<AdminOverview> {
    const db = this.requirePool();
    const result = await db.query<{
      users: number;
      organizations: number;
      active_subscriptions: number;
      trial_subscriptions: number;
      suspended_subscriptions: number;
      content_requests: number;
      content_ready: number;
      invitations_open: number;
      campaigns_active: number;
      estimated_mrr_cents: number;
      payments_received: number;
    }>(`
      SELECT
        (SELECT COUNT(*)::int FROM modo_users) AS users,
        (SELECT COUNT(*)::int FROM modo_organizations) AS organizations,
        (SELECT COUNT(*)::int FROM modo_subscriptions WHERE status IN ('active','retrying') AND plan_slug<>'trial') AS active_subscriptions,
        (SELECT COUNT(*)::int FROM modo_subscriptions WHERE plan_slug='trial') AS trial_subscriptions,
        (SELECT COUNT(*)::int FROM modo_subscriptions WHERE status='suspended') AS suspended_subscriptions,
        (SELECT COUNT(*)::int FROM modo_content_requests) AS content_requests,
        (SELECT COUNT(*)::int FROM modo_content_requests WHERE status IN ('ready','approved')) AS content_ready,
        (SELECT COUNT(*)::int FROM modo_admin_invitations WHERE status='open' AND expires_at>NOW()) AS invitations_open,
        (SELECT COUNT(*)::int FROM modo_discount_campaigns WHERE active=TRUE AND starts_at<=NOW() AND ends_at>NOW()) AS campaigns_active,
        COALESCE((SELECT SUM(CASE plan_slug
          WHEN 'start' THEN 9900 WHEN 'presenca' THEN 19900 WHEN 'pro' THEN 39900 WHEN 'business' THEN 79000 ELSE 0 END)::int
          FROM modo_subscriptions WHERE status IN ('active','retrying')),0) AS estimated_mrr_cents,
        COALESCE((SELECT COUNT(*)::int FROM modo_payment_events WHERE event_type='PIX_AUTOMATIC_COBR_COMPLETED'),0) AS payments_received
    `);
    const row = result.rows[0];
    return {
      users: Number(row.users),
      organizations: Number(row.organizations),
      activeSubscriptions: Number(row.active_subscriptions),
      trialSubscriptions: Number(row.trial_subscriptions),
      suspendedSubscriptions: Number(row.suspended_subscriptions),
      contentRequests: Number(row.content_requests),
      contentReady: Number(row.content_ready),
      invitationsOpen: Number(row.invitations_open),
      discountCampaignsActive: Number(row.campaigns_active),
      estimatedMrrCents: Number(row.estimated_mrr_cents),
      paymentsReceived: Number(row.payments_received),
    };
  }

  async listOrganizations(): Promise<AdminOrganization[]> {
  const result = await this.requirePool().query<{
    id: string;
    name: string;
    owner_name: string;
    owner_email: string;
    plan_slug: PlanSlug;
    status: SubscriptionStatus;
    credits_granted: number;
    credits_used: number;
    brands: number;
    users: number;
    content_requests: number;
    created_at: Date;
  }>(`
    SELECT o.id,o.name,o.created_at,
      COALESCE((
        SELECT u.name FROM modo_memberships m
        JOIN modo_users u ON u.id=m.user_id
        WHERE m.organization_id=o.id
        ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END,m.created_at ASC
        LIMIT 1
      ),'Sem responsável') AS owner_name,
      COALESCE((
        SELECT u.email FROM modo_memberships m
        JOIN modo_users u ON u.id=m.user_id
        WHERE m.organization_id=o.id
        ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END,m.created_at ASC
        LIMIT 1
      ),'sem-responsavel@modo.app') AS owner_email,
      COALESCE(s.plan_slug,'trial') AS plan_slug,
      COALESCE(s.status,'canceled') AS status,
      COALESCE((
        SELECT SUM(l.credits)::int FROM modo_credit_ledger l
        WHERE l.account_id=o.id AND l.period_start=s.period_start AND l.credits>0
      ),0) AS credits_granted,
      COALESCE((
        SELECT ABS(SUM(l.credits))::int FROM modo_credit_ledger l
        WHERE l.account_id=o.id AND l.period_start=s.period_start AND l.credits<0
      ),0) AS credits_used,
      (SELECT COUNT(*)::int FROM modo_brands b WHERE b.organization_id=o.id) AS brands,
      (SELECT COUNT(*)::int FROM modo_memberships m WHERE m.organization_id=o.id) AS users,
      (SELECT COUNT(*)::int FROM modo_content_requests c WHERE c.organization_id=o.id) AS content_requests
    FROM modo_organizations o
    LEFT JOIN modo_subscriptions s ON s.account_id=o.id
    ORDER BY o.created_at DESC
    LIMIT 500
  `);
  return result.rows.map((row) => ({
    id: row.id,
    name: row.name,
    ownerName: row.owner_name,
    ownerEmail: row.owner_email,
    plan: row.plan_slug,
    status: row.status,
    creditsGranted: Number(row.credits_granted),
    creditsUsed: Number(row.credits_used),
    creditsRemaining: Math.max(0, Number(row.credits_granted) - Number(row.credits_used)),
    brands: Number(row.brands),
    users: Number(row.users),
    contentRequests: Number(row.content_requests),
    createdAt: row.created_at.toISOString(),
  }));
}

async createInvitation(input: AdminInvitationCreate): Promise<AdminInvitation> {
    const token = randomBytes(32).toString("base64url");
    const expiresAt = addDays(new Date(), input.expiresInDays);
    const result = await this.requirePool().query<InvitationRow>(
      `INSERT INTO modo_admin_invitations(
        id,token_hash,email,plan_slug,bonus_credits,note,expires_at
      ) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [randomUUID(), hashToken(token), input.email, input.plan, input.bonusCredits, input.note, expiresAt],
    );
    await this.audit("invitation.created", "invitation", result.rows[0].id, { email: input.email, plan: input.plan });
    return {
      ...mapInvitation(result.rows[0]),
      inviteUrl: `${this.publicWebUrl}/convite/${encodeURIComponent(token)}`,
    };
  }

  async listInvitations(): Promise<AdminInvitation[]> {
    await this.requirePool().query(
      `UPDATE modo_admin_invitations SET status='expired'
       WHERE status='open' AND expires_at<=NOW()`,
    );
    const result = await this.requirePool().query<InvitationRow>(
      "SELECT * FROM modo_admin_invitations ORDER BY created_at DESC LIMIT 300",
    );
    return result.rows.map(mapInvitation);
  }

  async revokeInvitation(id: string) {
    const result = await this.requirePool().query<InvitationRow>(
      `UPDATE modo_admin_invitations SET status='revoked',revoked_at=NOW()
       WHERE id=$1 AND status='open' RETURNING *`,
      [id],
    );
    if (!result.rowCount) throw new PlatformAdminError("INVITATION_NOT_OPEN", 409, "Convite não encontrado ou já encerrado.");
    await this.audit("invitation.revoked", "invitation", id, {});
    return mapInvitation(result.rows[0]);
  }

  async previewInvitation(token: string): Promise<InvitationPreview> {
    const result = await this.requirePool().query<InvitationRow>(
      `SELECT * FROM modo_admin_invitations
       WHERE token_hash=$1 AND status='open' AND expires_at>NOW() LIMIT 1`,
      [hashToken(token)],
    );
    const row = result.rows[0];
    if (!row) throw new PlatformAdminError("INVITATION_INVALID", 404, "Convite inválido, expirado ou já utilizado.");
    return {
      email: row.email,
      plan: row.plan_slug,
      bonusCredits: Number(row.bonus_credits),
      expiresAt: row.expires_at.toISOString(),
      note: row.note,
    };
  }

  async consumeInvitation(token: string, userId: string, organizationId: string) {
    const result = await this.requirePool().query<InvitationRow>(
      `UPDATE modo_admin_invitations SET status='used',used_at=NOW()
       WHERE token_hash=$1 AND status='open' AND expires_at>NOW() RETURNING *`,
      [hashToken(token)],
    );
    if (!result.rowCount) throw new PlatformAdminError("INVITATION_INVALID", 409, "O convite não está mais disponível.");
    await this.audit("invitation.used", "organization", organizationId, { userId, invitationId: result.rows[0].id });
    return mapInvitation(result.rows[0]);
  }

  async createCampaign(input: AdminDiscountCampaignCreate): Promise<AdminDiscountCampaign> {
    const result = await this.requirePool().query<CampaignRow>(
      `INSERT INTO modo_discount_campaigns(
        id,name,code,kind,value,plans,max_redemptions,starts_at,ends_at,active
       ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [randomUUID(), input.name, input.code, input.kind, input.value, input.plans, input.maxRedemptions, input.startsAt, input.endsAt, input.active],
    );
    await this.audit("discount.created", "discount_campaign", result.rows[0].id, { code: input.code });
    return mapCampaign(result.rows[0]);
  }

  async listCampaigns(): Promise<AdminDiscountCampaign[]> {
    const result = await this.requirePool().query<CampaignRow>(
      "SELECT * FROM modo_discount_campaigns ORDER BY created_at DESC LIMIT 300",
    );
    return result.rows.map(mapCampaign);
  }

  async setCampaignActive(id: string, active: boolean) {
    const result = await this.requirePool().query<CampaignRow>(
      `UPDATE modo_discount_campaigns SET active=$2,updated_at=NOW() WHERE id=$1 RETURNING *`,
      [id, active],
    );
    if (!result.rowCount) throw new PlatformAdminError("CAMPAIGN_NOT_FOUND", 404, "Campanha não encontrada.");
    await this.audit(active ? "discount.activated" : "discount.deactivated", "discount_campaign", id, {});
    return mapCampaign(result.rows[0]);
  }

  async reserveDiscount(accountId: string, plan: PublicPlanSlug, code?: string): Promise<DiscountQuote | null> {
    if (!code) return null;
    const client = await this.requirePool().connect();
    try {
      await client.query("BEGIN");
      const result = await client.query<CampaignRow>(
        `SELECT * FROM modo_discount_campaigns
         WHERE code=$1 AND active=TRUE AND starts_at<=NOW() AND ends_at>NOW()
           AND $2=ANY(plans) AND redemptions<max_redemptions
         FOR UPDATE`,
        [code.trim().toUpperCase(), plan],
      );
      const campaign = result.rows[0];
      if (!campaign) throw new PlatformAdminError("COUPON_INVALID", 400, "Cupom inválido, encerrado ou indisponível para este plano.");
      const duplicate = await client.query<{ id: string; original_price_cents: number; final_price_cents: number }>(
        `SELECT id,original_price_cents,final_price_cents FROM modo_discount_redemptions
         WHERE campaign_id=$1 AND account_id=$2 AND plan_slug=$3 LIMIT 1`,
        [campaign.id, accountId, plan],
      );
      if (duplicate.rowCount) throw new PlatformAdminError("COUPON_ALREADY_USED", 409, "Este cupom já foi utilizado por esta conta para o plano escolhido.");

      const originalPriceCents = planEntitlements[plan].priceCents;
      const savedCents = campaign.kind === "percent"
        ? Math.floor(originalPriceCents * Math.min(100, Number(campaign.value)) / 100)
        : Math.min(originalPriceCents - 1, Number(campaign.value));
      const finalPriceCents = Math.max(1, originalPriceCents - savedCents);
      const reservationId = randomUUID();
      await client.query(
        `INSERT INTO modo_discount_redemptions(
          id,campaign_id,account_id,plan_slug,code,original_price_cents,final_price_cents
         ) VALUES($1,$2,$3,$4,$5,$6,$7)`,
        [reservationId, campaign.id, accountId, plan, campaign.code, originalPriceCents, finalPriceCents],
      );
      await client.query(
        "UPDATE modo_discount_campaigns SET redemptions=redemptions+1,updated_at=NOW() WHERE id=$1",
        [campaign.id],
      );
      await client.query("COMMIT");
      return { campaignId: campaign.id, reservationId, code: campaign.code, originalPriceCents, finalPriceCents, savedCents };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async linkDiscountToProvider(reservationId: string, providerId: string) {
    if (!this.pool) return;
    await this.pool.query(
      `UPDATE modo_discount_redemptions SET provider_id=$2,status='checkout_created' WHERE id=$1`,
      [reservationId, providerId],
    );
  }

  async releaseDiscount(reservationId: string) {
    if (!this.pool) return;
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await client.query<{ campaign_id: string }>(
        `DELETE FROM modo_discount_redemptions WHERE id=$1 AND status='reserved' RETURNING campaign_id`,
        [reservationId],
      );
      if (result.rowCount) {
        await client.query(
          "UPDATE modo_discount_campaigns SET redemptions=GREATEST(0,redemptions-1),updated_at=NOW() WHERE id=$1",
          [result.rows[0].campaign_id],
        );
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
    } finally {
      client.release();
    }
  }

  async audit(action: string, targetType: string, targetId: string | null, metadata: Record<string, unknown>) {
    if (!this.pool) return;
    await this.pool.query(
      `INSERT INTO modo_admin_audit_log(id,action,target_type,target_id,metadata)
       VALUES($1,$2,$3,$4,$5::jsonb)`,
      [randomUUID(), action, targetType, targetId, JSON.stringify(metadata)],
    );
  }

  private requirePool() {
    if (!this.pool) throw new PlatformAdminError("ADMIN_DATABASE_REQUIRED", 503, "O painel administrativo exige PostgreSQL.");
    return this.pool;
  }
}
