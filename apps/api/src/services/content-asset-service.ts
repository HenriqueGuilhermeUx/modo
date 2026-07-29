import { randomUUID } from "node:crypto";
import pg, { type Pool } from "pg";

const { Pool: PgPool } = pg;

interface ContentAssetServiceOptions {
  databaseUrl?: string;
  databaseSsl?: boolean;
  publicApiUrl?: string;
}

interface StoredAsset {
  id: string;
  publicToken: string;
  organizationId: string;
  contentRequestId: string;
  mimeType: string;
  data: Buffer;
}

type AssetRow = {
  id: string;
  public_token: string;
  organization_id: string;
  content_request_id: string;
  mime_type: string;
  data: Buffer;
};

export class ContentAssetService {
  private readonly pool?: Pool;
  private readonly memory = new Map<string, StoredAsset>();
  private readonly publicApiUrl: string;

  constructor(options: ContentAssetServiceOptions = {}) {
    if (options.databaseUrl) {
      this.pool = new PgPool({
        connectionString: options.databaseUrl,
        ssl: options.databaseSsl ? { rejectUnauthorized: false } : undefined,
        max: 3,
      });
    }
    this.publicApiUrl = (options.publicApiUrl || "http://localhost:4000").replace(/\/$/, "");
  }

  get storage(): "memory" | "postgres" {
    return this.pool ? "postgres" : "memory";
  }

  async initialize() {
    if (!this.pool) return;
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS modo_content_assets (
        id TEXT PRIMARY KEY,
        public_token TEXT NOT NULL UNIQUE,
        organization_id TEXT NOT NULL REFERENCES modo_organizations(id) ON DELETE CASCADE,
        content_request_id TEXT NOT NULL REFERENCES modo_content_requests(id) ON DELETE CASCADE,
        mime_type TEXT NOT NULL,
        data BYTEA NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS modo_content_assets_request_idx
        ON modo_content_assets(content_request_id, created_at DESC);
    `);
  }

  async close() {
    await this.pool?.end();
  }

  async save(input: {
    organizationId: string;
    contentRequestId: string;
    mimeType: string;
    data: Buffer;
  }) {
    const id = randomUUID();
    const publicToken = randomUUID();
    if (this.pool) {
      await this.pool.query(
        `INSERT INTO modo_content_assets(
          id, public_token, organization_id, content_request_id, mime_type, data
        ) VALUES($1,$2,$3,$4,$5,$6)`,
        [id, publicToken, input.organizationId, input.contentRequestId, input.mimeType, input.data],
      );
    } else {
      this.memory.set(publicToken, { id, publicToken, ...input });
    }
    return {
      id,
      url: `${this.publicApiUrl}/api/v1/public/content-assets/${publicToken}`,
    };
  }

  async getLatestForRequest(organizationId: string, contentRequestId: string): Promise<{ mimeType: string; data: Buffer } | null> {
    if (this.pool) {
      const result = await this.pool.query<AssetRow>(
        `SELECT id, public_token, organization_id, content_request_id, mime_type, data
         FROM modo_content_assets
         WHERE organization_id=$1 AND content_request_id=$2
         ORDER BY created_at DESC LIMIT 1`,
        [organizationId, contentRequestId],
      );
      if (!result.rowCount) return null;
      return { mimeType: result.rows[0].mime_type, data: result.rows[0].data };
    }
    const matches = [...this.memory.values()]
      .filter((asset) => asset.organizationId === organizationId && asset.contentRequestId === contentRequestId);
    const asset = matches[matches.length - 1];
    return asset ? { mimeType: asset.mimeType, data: asset.data } : null;
  }

  async getForRequestByToken(
    organizationId: string,
    contentRequestId: string,
    publicToken: string,
  ): Promise<{ mimeType: string; data: Buffer } | null> {
    if (!publicToken) return null;
    if (this.pool) {
      const result = await this.pool.query<AssetRow>(
        `SELECT id, public_token, organization_id, content_request_id, mime_type, data
         FROM modo_content_assets
         WHERE organization_id=$1 AND content_request_id=$2 AND public_token=$3
         LIMIT 1`,
        [organizationId, contentRequestId, publicToken],
      );
      if (!result.rowCount) return null;
      return { mimeType: result.rows[0].mime_type, data: result.rows[0].data };
    }
    const asset = this.memory.get(publicToken);
    if (!asset || asset.organizationId !== organizationId || asset.contentRequestId !== contentRequestId) {
      return null;
    }
    return { mimeType: asset.mimeType, data: asset.data };
  }

  async getPublic(publicToken: string): Promise<{ mimeType: string; data: Buffer } | null> {
    if (this.pool) {
      const result = await this.pool.query<AssetRow>(
        `SELECT id, public_token, organization_id, content_request_id, mime_type, data
         FROM modo_content_assets WHERE public_token=$1 LIMIT 1`,
        [publicToken],
      );
      if (!result.rowCount) return null;
      return { mimeType: result.rows[0].mime_type, data: result.rows[0].data };
    }
    const asset = this.memory.get(publicToken);
    return asset ? { mimeType: asset.mimeType, data: asset.data } : null;
  }
}
