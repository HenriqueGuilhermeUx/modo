import type {
  SmartBotsIntake,
  SmartBotsIntakePayload,
  SmartBotsIntakeStatus,
} from "@modo/contracts/smartbots";
import { randomUUID } from "node:crypto";
import pg, { type Pool } from "pg";

const { Pool: PgPool } = pg;

export type SmartBotsDispatchProvider = "queue" | "direct" | "n8n";

interface Options {
  databaseUrl?: string;
  databaseSsl?: boolean;
  dispatchProvider?: SmartBotsDispatchProvider;
  partnerEndpoint?: string;
  partnerApiKey?: string;
  n8nWebhookUrl?: string;
  n8nSecret?: string;
  requestTimeoutMs?: number;
}

type IntakeRow = {
  id: string;
  organization_id: string;
  user_id: string;
  partner: "modo";
  plan: "presenca";
  business_name: string;
  owner_name: string;
  email: string;
  phone: string;
  instagram: string;
  segment: string;
  services: string;
  opening_hours: string;
  faq: string;
  prices: string;
  welcome_message: string;
  google_review_link: string;
  notes: string;
  status: SmartBotsIntakeStatus;
  provider_message: string;
  created_at: Date;
  updated_at: Date;
};

function mapRow(row: IntakeRow): SmartBotsIntake {
  return {
    id: row.id,
    organizationId: row.organization_id,
    userId: row.user_id,
    partner: row.partner,
    plan: row.plan,
    businessName: row.business_name,
    ownerName: row.owner_name,
    email: row.email,
    phone: row.phone,
    instagram: row.instagram,
    segment: row.segment,
    services: row.services,
    openingHours: row.opening_hours,
    faq: row.faq,
    prices: row.prices,
    welcomeMessage: row.welcome_message,
    googleReviewLink: row.google_review_link,
    notes: row.notes,
    status: row.status,
    providerMessage: row.provider_message,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

function intakePayload(intake: SmartBotsIntake): SmartBotsIntakePayload {
  return {
    partner: "modo",
    plan: "presenca",
    businessName: intake.businessName,
    ownerName: intake.ownerName,
    email: intake.email,
    phone: intake.phone,
    instagram: intake.instagram,
    segment: intake.segment,
    services: intake.services,
    openingHours: intake.openingHours,
    faq: intake.faq,
    prices: intake.prices,
    welcomeMessage: intake.welcomeMessage,
    googleReviewLink: intake.googleReviewLink,
    notes: intake.notes,
  };
}

export class SmartBotsService {
  private readonly pool?: Pool;
  public readonly dispatchProvider: SmartBotsDispatchProvider;
  private readonly partnerEndpoint?: string;
  private readonly partnerApiKey?: string;
  private readonly n8nWebhookUrl?: string;
  private readonly n8nSecret?: string;
  private readonly requestTimeoutMs: number;
  private readonly memory = new Map<string, SmartBotsIntake>();

  constructor(options: Options = {}) {
    this.dispatchProvider = options.dispatchProvider ?? "queue";
    this.partnerEndpoint = options.partnerEndpoint?.trim() || undefined;
    this.partnerApiKey = options.partnerApiKey?.trim() || undefined;
    this.n8nWebhookUrl = options.n8nWebhookUrl?.trim() || undefined;
    this.n8nSecret = options.n8nSecret?.trim() || undefined;
    const timeout = Number(options.requestTimeoutMs ?? 15_000);
    this.requestTimeoutMs = Number.isFinite(timeout)
      ? Math.min(120_000, Math.max(1_000, timeout))
      : 15_000;

    if (this.dispatchProvider === "direct" && (!this.partnerEndpoint || !this.partnerApiKey)) {
      throw new Error(
        "SMARTBOTS_PARTNER_ENDPOINT e SMARTBOTS_PARTNER_API_KEY são obrigatórios no envio direto.",
      );
    }
    if (this.dispatchProvider === "n8n" && (!this.n8nWebhookUrl || !this.n8nSecret)) {
      throw new Error(
        "N8N_SMARTBOTS_WEBHOOK_URL e N8N_SMARTBOTS_SECRET são obrigatórios na orquestração n8n.",
      );
    }

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
      CREATE TABLE IF NOT EXISTS modo_smartbots_intakes (
        id TEXT PRIMARY KEY,
        organization_id TEXT NOT NULL REFERENCES modo_organizations(id) ON DELETE CASCADE,
        user_id TEXT NOT NULL,
        partner TEXT NOT NULL DEFAULT 'modo',
        plan TEXT NOT NULL DEFAULT 'presenca',
        business_name TEXT NOT NULL,
        owner_name TEXT NOT NULL,
        email TEXT NOT NULL,
        phone TEXT NOT NULL,
        instagram TEXT NOT NULL DEFAULT '',
        segment TEXT NOT NULL,
        services TEXT NOT NULL,
        opening_hours TEXT NOT NULL DEFAULT '',
        faq TEXT NOT NULL DEFAULT '',
        prices TEXT NOT NULL DEFAULT '',
        welcome_message TEXT NOT NULL,
        google_review_link TEXT NOT NULL DEFAULT '',
        notes TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'submitted',
        provider_message TEXT NOT NULL DEFAULT '',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE(organization_id)
      );
      CREATE INDEX IF NOT EXISTS modo_smartbots_intakes_status_idx
        ON modo_smartbots_intakes(status, updated_at DESC);
    `);
  }

  async close() {
    await this.pool?.end();
  }

  async submit(
    organizationId: string,
    userId: string,
    payload: SmartBotsIntakePayload,
  ): Promise<SmartBotsIntake> {
    const saved = this.pool
      ? await this.savePostgres(organizationId, userId, payload)
      : this.saveMemory(organizationId, userId, payload);

    return this.dispatch(saved);
  }

  async retry(id: string): Promise<SmartBotsIntake> {
    const intake = await this.getById(id);
    if (!intake) throw new Error("Solicitação SmartBots não encontrada.");
    const queued = await this.updateStatus(id, "submitted", "");
    return this.dispatch(queued);
  }

  async getForOrganization(organizationId: string): Promise<SmartBotsIntake | null> {
    if (this.pool) {
      const result = await this.pool.query<IntakeRow>(
        `SELECT * FROM modo_smartbots_intakes WHERE organization_id=$1 LIMIT 1`,
        [organizationId],
      );
      return result.rows[0] ? mapRow(result.rows[0]) : null;
    }
    return this.memory.get(organizationId) ?? null;
  }

  async listAll(): Promise<SmartBotsIntake[]> {
    if (this.pool) {
      const result = await this.pool.query<IntakeRow>(
        `SELECT * FROM modo_smartbots_intakes ORDER BY updated_at DESC LIMIT 500`,
      );
      return result.rows.map(mapRow);
    }
    return [...this.memory.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async updateStatus(id: string, status: SmartBotsIntakeStatus, providerMessage = "") {
    if (this.pool) {
      const result = await this.pool.query<IntakeRow>(
        `UPDATE modo_smartbots_intakes
         SET status=$2, provider_message=$3, updated_at=NOW()
         WHERE id=$1 RETURNING *`,
        [id, status, providerMessage],
      );
      if (!result.rows[0]) throw new Error("Solicitação SmartBots não encontrada.");
      return mapRow(result.rows[0]);
    }

    const entry = [...this.memory.values()].find((item) => item.id === id);
    if (!entry) throw new Error("Solicitação SmartBots não encontrada.");
    const updated = { ...entry, status, providerMessage, updatedAt: new Date().toISOString() };
    this.memory.set(updated.organizationId, updated);
    return updated;
  }

  private async dispatch(saved: SmartBotsIntake): Promise<SmartBotsIntake> {
    if (this.dispatchProvider === "queue") return saved;

    const payload = intakePayload(saved);
    const isN8n = this.dispatchProvider === "n8n";
    const endpoint = isN8n ? this.n8nWebhookUrl! : this.partnerEndpoint!;
    const headers: Record<string, string> = {
      "content-type": "application/json",
      "idempotency-key": saved.id,
      "x-modo-source": "modo-presenca",
    };
    if (isN8n) headers["x-modo-secret"] = this.n8nSecret!;
    else headers["x-partner-key"] = this.partnerApiKey!;

    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers,
        body: JSON.stringify(isN8n ? { intakeId: saved.id, payload } : payload),
        signal: AbortSignal.timeout(this.requestTimeoutMs),
      });
      const detail = (await response.text().catch(() => "")).slice(0, 1000);
      return this.updateStatus(
        saved.id,
        response.ok ? "sent" : "failed",
        detail || `${isN8n ? "n8n" : "SmartBots"} respondeu ${response.status}.`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "Falha ao encaminhar para a SmartBots.";
      return this.updateStatus(saved.id, "failed", message.slice(0, 1000));
    }
  }

  private async getById(id: string): Promise<SmartBotsIntake | null> {
    if (this.pool) {
      const result = await this.pool.query<IntakeRow>(
        `SELECT * FROM modo_smartbots_intakes WHERE id=$1 LIMIT 1`,
        [id],
      );
      return result.rows[0] ? mapRow(result.rows[0]) : null;
    }
    return [...this.memory.values()].find((item) => item.id === id) ?? null;
  }

  private async savePostgres(
    organizationId: string,
    userId: string,
    payload: SmartBotsIntakePayload,
  ) {
    const result = await this.pool!.query<IntakeRow>(
      `INSERT INTO modo_smartbots_intakes(
        id,organization_id,user_id,partner,plan,business_name,owner_name,email,phone,
        instagram,segment,services,opening_hours,faq,prices,welcome_message,
        google_review_link,notes,status,provider_message
      ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,'submitted','')
      ON CONFLICT(organization_id) DO UPDATE SET
        user_id=EXCLUDED.user_id,
        partner=EXCLUDED.partner,
        plan=EXCLUDED.plan,
        business_name=EXCLUDED.business_name,
        owner_name=EXCLUDED.owner_name,
        email=EXCLUDED.email,
        phone=EXCLUDED.phone,
        instagram=EXCLUDED.instagram,
        segment=EXCLUDED.segment,
        services=EXCLUDED.services,
        opening_hours=EXCLUDED.opening_hours,
        faq=EXCLUDED.faq,
        prices=EXCLUDED.prices,
        welcome_message=EXCLUDED.welcome_message,
        google_review_link=EXCLUDED.google_review_link,
        notes=EXCLUDED.notes,
        status='submitted',
        provider_message='',
        updated_at=NOW()
      RETURNING *`,
      [
        randomUUID(), organizationId, userId, payload.partner, payload.plan,
        payload.businessName, payload.ownerName, payload.email, payload.phone,
        payload.instagram, payload.segment, payload.services, payload.openingHours,
        payload.faq, payload.prices, payload.welcomeMessage,
        payload.googleReviewLink, payload.notes,
      ],
    );
    return mapRow(result.rows[0]);
  }

  private saveMemory(
    organizationId: string,
    userId: string,
    payload: SmartBotsIntakePayload,
  ) {
    const current = this.memory.get(organizationId);
    const now = new Date().toISOString();
    const saved: SmartBotsIntake = {
      ...payload,
      id: current?.id ?? randomUUID(),
      organizationId,
      userId,
      status: "submitted",
      providerMessage: "",
      createdAt: current?.createdAt ?? now,
      updatedAt: now,
    };
    this.memory.set(organizationId, saved);
    return saved;
  }
}
