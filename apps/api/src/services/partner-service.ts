import type { PartnerApplication, PartnerApplicationCreate } from "@modo/contracts/strategy-network";
import { randomUUID } from "node:crypto";
import pg, { type Pool } from "pg";

const { Pool: PgPool } = pg;

interface Options {
  databaseUrl?: string;
  databaseSsl?: boolean;
}

export class PartnerError extends Error {
  constructor(
    public readonly code: string,
    public readonly statusCode: number,
    message: string,
  ) {
    super(message);
    this.name = "PartnerError";
  }
}

function nowIso() {
  return new Date().toISOString();
}

export class PartnerService {
  private readonly pool?: Pool;
  private readonly applications: PartnerApplication[] = [];

  constructor(options: Options = {}) {
    if (options.databaseUrl) {
      this.pool = new PgPool({
        connectionString: options.databaseUrl,
        ssl: options.databaseSsl ? { rejectUnauthorized: false } : undefined,
        max: 3,
      });
    }
  }

  get storage(): "postgres" | "memory" {
    return this.pool ? "postgres" : "memory";
  }

  async initialize() {
    if (!this.pool) return;
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS modo_partner_applications (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        email TEXT NOT NULL,
        whatsapp TEXT NOT NULL,
        company_name TEXT NOT NULL,
        city TEXT NOT NULL DEFAULT '',
        website_url TEXT NOT NULL DEFAULT '',
        instagram_url TEXT NOT NULL DEFAULT '',
        business_type TEXT NOT NULL,
        active_clients INTEGER NOT NULL DEFAULT 0,
        monthly_service_revenue_cents INTEGER,
        current_services TEXT[] NOT NULL DEFAULT '{}',
        why_partner TEXT NOT NULL,
        target_clients_with_modo INTEGER NOT NULL DEFAULT 1,
        status TEXT NOT NULL DEFAULT 'received',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS modo_partner_applications_status_idx
        ON modo_partner_applications(status, created_at DESC);
      CREATE UNIQUE INDEX IF NOT EXISTS modo_partner_applications_email_company_idx
        ON modo_partner_applications(LOWER(email), LOWER(company_name));
    `);
  }

  async close() {
    await this.pool?.end();
  }

  async createApplication(input: PartnerApplicationCreate): Promise<PartnerApplication> {
    const createdAt = nowIso();
    const item: PartnerApplication = {
      ...input,
      id: randomUUID(),
      status: "received",
      createdAt,
      updatedAt: createdAt,
    };

    if (!this.pool) {
      const duplicate = this.applications.some(
        (candidate) =>
          candidate.email === input.email &&
          candidate.companyName.toLowerCase() === input.companyName.toLowerCase(),
      );
      if (duplicate) {
        throw new PartnerError("PARTNER_APPLICATION_ALREADY_EXISTS", 409, "Esta candidatura já foi recebida.");
      }
      this.applications.unshift(item);
      return item;
    }

    try {
      const result = await this.pool.query<{
        id: string;
        name: string;
        email: string;
        whatsapp: string;
        company_name: string;
        city: string;
        website_url: string;
        instagram_url: string;
        business_type: PartnerApplication["businessType"];
        active_clients: number;
        monthly_service_revenue_cents: number | null;
        current_services: string[];
        why_partner: string;
        target_clients_with_modo: number;
        status: PartnerApplication["status"];
        created_at: Date;
        updated_at: Date;
      }>(
        `INSERT INTO modo_partner_applications(
          id,name,email,whatsapp,company_name,city,website_url,instagram_url,business_type,
          active_clients,monthly_service_revenue_cents,current_services,why_partner,target_clients_with_modo
        ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
        RETURNING *`,
        [
          item.id,
          item.name,
          item.email,
          item.whatsapp,
          item.companyName,
          item.city,
          item.websiteUrl || "",
          item.instagramUrl || "",
          item.businessType,
          item.activeClients,
          item.monthlyServiceRevenueCents,
          item.currentServices,
          item.whyPartner,
          item.targetClientsWithModo,
        ],
      );
      const row = result.rows[0];
      return {
        id: row.id,
        name: row.name,
        email: row.email,
        whatsapp: row.whatsapp,
        companyName: row.company_name,
        city: row.city,
        websiteUrl: row.website_url,
        instagramUrl: row.instagram_url,
        businessType: row.business_type,
        activeClients: row.active_clients,
        monthlyServiceRevenueCents: row.monthly_service_revenue_cents,
        currentServices: row.current_services,
        whyPartner: row.why_partner,
        targetClientsWithModo: row.target_clients_with_modo,
        consent: true,
        status: row.status,
        createdAt: row.created_at.toISOString(),
        updatedAt: row.updated_at.toISOString(),
      };
    } catch (error) {
      if ((error as { code?: string }).code === "23505") {
        throw new PartnerError("PARTNER_APPLICATION_ALREADY_EXISTS", 409, "Esta candidatura já foi recebida.");
      }
      throw error;
    }
  }
}
