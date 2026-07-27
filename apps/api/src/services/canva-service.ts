import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";
import pg, { type Pool } from "pg";

const { Pool: PgPool } = pg;
const CANVA_API = "https://api.canva.com/rest/v1";
const CANVA_AUTH = "https://www.canva.com/api/oauth/authorize";
const OAUTH_STATE_MINUTES = 15;
const DESIGN_LINK_REFRESH_DAYS = 20;

const delay = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));

interface CanvaServiceOptions {
  clientId?: string;
  clientSecret?: string;
  redirectUri?: string;
  scopes?: string;
  encryptionSecret?: string;
  webUrl?: string;
  databaseUrl?: string;
  databaseSsl?: boolean;
}

interface OAuthState {
  state: string;
  accountId: string;
  contentRequestId: string | null;
  codeVerifier: string;
  expiresAt: Date;
}

interface Connection {
  accountId: string;
  encryptedAccessToken: string;
  encryptedRefreshToken: string;
  tokenExpiresAt: Date;
  scopes: string[];
  connectedAt: Date;
  updatedAt: Date;
}

interface ConnectionRow {
  account_id: string;
  encrypted_access_token: string;
  encrypted_refresh_token: string;
  token_expires_at: Date;
  scopes: string[];
  connected_at: Date;
  updated_at: Date;
}

interface DesignRow {
  account_id: string;
  content_request_id: string;
  design_id: string;
  asset_id: string;
  edit_url: string;
  view_url: string;
  links_refreshed_at: Date;
  created_at: Date;
  updated_at: Date;
}

interface TokenResponse {
  access_token?: string;
  refresh_token?: string;
  token_type?: string;
  expires_in?: number;
  scope?: string;
  code?: string;
  message?: string;
}

interface UploadJobPayload {
  job?: {
    id?: string;
    status?: "in_progress" | "success" | "failed";
    asset?: { id?: string };
    error?: { code?: string; message?: string };
  };
  code?: string;
  message?: string;
}

interface DesignPayload {
  design?: {
    id?: string;
    urls?: { edit_url?: string; view_url?: string };
  };
  code?: string;
  message?: string;
}

export interface CanvaDesign {
  provider: "canva";
  contentRequestId: string;
  designId: string;
  assetId: string;
  editUrl: string;
  viewUrl: string;
  createdAt: string;
  updatedAt: string;
}

export class CanvaError extends Error {
  constructor(
    public readonly code: string,
    public readonly statusCode: number,
    message: string,
  ) {
    super(message);
    this.name = "CanvaError";
  }
}

export class CanvaService {
  private readonly pool?: Pool;
  private readonly states = new Map<string, OAuthState>();
  private readonly connections = new Map<string, Connection>();
  private readonly designs = new Map<string, CanvaDesign>();
  private readonly refreshing = new Map<string, Promise<string>>();

  constructor(private readonly options: CanvaServiceOptions = {}) {
    if (options.databaseUrl) {
      this.pool = new PgPool({
        connectionString: options.databaseUrl,
        ssl: options.databaseSsl ? { rejectUnauthorized: false } : undefined,
        max: 3,
      });
    }
  }

  get configured() {
    return Boolean(
      this.options.clientId &&
      this.options.clientSecret &&
      this.options.redirectUri &&
      this.options.encryptionSecret,
    );
  }

  get storage(): "memory" | "postgres" {
    return this.pool ? "postgres" : "memory";
  }

  async initialize() {
    if (!this.pool) return;
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS modo_canva_oauth_states (
        state TEXT PRIMARY KEY,
        account_id TEXT NOT NULL REFERENCES modo_organizations(id) ON DELETE CASCADE,
        content_request_id TEXT REFERENCES modo_content_requests(id) ON DELETE CASCADE,
        encrypted_code_verifier TEXT NOT NULL,
        expires_at TIMESTAMPTZ NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS modo_canva_connections (
        account_id TEXT PRIMARY KEY REFERENCES modo_organizations(id) ON DELETE CASCADE,
        encrypted_access_token TEXT NOT NULL,
        encrypted_refresh_token TEXT NOT NULL,
        token_expires_at TIMESTAMPTZ NOT NULL,
        scopes TEXT[] NOT NULL DEFAULT '{}',
        connected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS modo_canva_designs (
        account_id TEXT NOT NULL REFERENCES modo_organizations(id) ON DELETE CASCADE,
        content_request_id TEXT NOT NULL REFERENCES modo_content_requests(id) ON DELETE CASCADE,
        design_id TEXT NOT NULL,
        asset_id TEXT NOT NULL,
        edit_url TEXT NOT NULL,
        view_url TEXT NOT NULL,
        links_refreshed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY(account_id, content_request_id),
        UNIQUE(account_id, design_id)
      );

      CREATE INDEX IF NOT EXISTS modo_canva_designs_content_idx
        ON modo_canva_designs(content_request_id, created_at DESC);

      DELETE FROM modo_canva_oauth_states WHERE expires_at < NOW();
    `);
  }

  async close() {
    await this.pool?.end();
  }

  async getStatus(accountId: string) {
    const connection = await this.getConnection(accountId);
    if (!this.configured) {
      return {
        provider: "canva" as const,
        integrationConfigured: false,
        connected: false,
        expiresAt: null,
        scopes: [],
        message: "A integração Canva aguarda a configuração do aplicativo no ambiente da MODO.",
      };
    }
    if (!connection) {
      return {
        provider: "canva" as const,
        integrationConfigured: true,
        connected: false,
        expiresAt: null,
        scopes: this.scopes,
        message: "Conecte sua conta Canva para criar uma versão editável após a aprovação.",
      };
    }
    return {
      provider: "canva" as const,
      integrationConfigured: true,
      connected: true,
      expiresAt: connection.tokenExpiresAt.toISOString(),
      scopes: connection.scopes,
      message: "Canva conectado. Somente conteúdos aprovados podem ser enviados.",
    };
  }

  async createAuthorizationUrl(accountId: string, contentRequestId?: string) {
    this.requireConfigured();
    const state = randomBytes(48).toString("base64url");
    const codeVerifier = randomBytes(64).toString("base64url");
    const codeChallenge = createHash("sha256").update(codeVerifier).digest("base64url");
    await this.saveState({
      state,
      accountId,
      contentRequestId: contentRequestId || null,
      codeVerifier,
      expiresAt: new Date(Date.now() + OAUTH_STATE_MINUTES * 60_000),
    });

    const url = new URL(CANVA_AUTH);
    url.searchParams.set("code_challenge", codeChallenge);
    url.searchParams.set("code_challenge_method", "s256");
    url.searchParams.set("scope", this.scopes.join(" "));
    url.searchParams.set("response_type", "code");
    url.searchParams.set("client_id", this.options.clientId!);
    url.searchParams.set("state", state);
    url.searchParams.set("redirect_uri", this.options.redirectUri!);
    return { authorizationUrl: url.toString() };
  }

  async completeAuthorization(input: {
    state?: string;
    code?: string;
    error?: string;
    errorDescription?: string;
  }) {
    if (!input.state) {
      return this.frontendRedirect(null, "error", "Estado de autorização ausente.");
    }
    const state = await this.consumeState(input.state);
    if (!state || state.expiresAt <= new Date()) {
      return this.frontendRedirect(null, "error", "A autorização expirou. Inicie novamente pela MODO.");
    }
    if (input.error || !input.code) {
      return this.frontendRedirect(
        state.contentRequestId,
        "error",
        input.errorDescription || input.error || "Autorização não concluída.",
      );
    }

    try {
      const token = await this.exchangeToken(new URLSearchParams({
        grant_type: "authorization_code",
        code_verifier: state.codeVerifier,
        code: input.code,
        redirect_uri: this.options.redirectUri!,
      }));
      if (!token.access_token || !token.refresh_token) {
        throw new CanvaError("CANVA_TOKEN_MISSING", 502, "O Canva não devolveu os tokens esperados.");
      }
      const now = new Date();
      await this.saveConnection({
        accountId: state.accountId,
        encryptedAccessToken: this.encrypt(token.access_token),
        encryptedRefreshToken: this.encrypt(token.refresh_token),
        tokenExpiresAt: new Date(Date.now() + Number(token.expires_in || 14_400) * 1000),
        scopes: (token.scope || this.scopes.join(" ")).split(/\s+/).filter(Boolean),
        connectedAt: now,
        updatedAt: now,
      });
      return this.frontendRedirect(state.contentRequestId, "connected");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Não foi possível conectar o Canva.";
      return this.frontendRedirect(state.contentRequestId, "error", message);
    }
  }

  async disconnect(accountId: string) {
    const connection = await this.getConnection(accountId);
    if (connection && this.configured) {
      const token = this.decrypt(connection.encryptedRefreshToken);
      await fetch(`${CANVA_API}/oauth/revoke`, {
        method: "POST",
        headers: {
          Authorization: this.basicAuthorization,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({ token }),
        signal: AbortSignal.timeout(15_000),
      }).catch(() => undefined);
    }
    this.connections.delete(accountId);
    if (this.pool) {
      await this.pool.query("DELETE FROM modo_canva_connections WHERE account_id=$1", [accountId]);
    }
    return { disconnected: true };
  }

  async getDesign(accountId: string, contentRequestId: string): Promise<CanvaDesign | null> {
    const record = await this.loadDesign(accountId, contentRequestId);
    if (!record) return null;
    const age = Date.now() - new Date(record.updatedAt).getTime();
    if (age < DESIGN_LINK_REFRESH_DAYS * 24 * 60 * 60 * 1000 || !this.configured) return record;
    try {
      return await this.refreshDesignLinks(accountId, record);
    } catch {
      return record;
    }
  }

  async createApprovedDesign(input: {
    accountId: string;
    contentRequestId: string;
    title: string;
    assetName: string;
    mimeType: string;
    data: Buffer;
    width: number;
    height: number;
  }): Promise<CanvaDesign> {
    this.requireConfigured();
    const existing = await this.getDesign(input.accountId, input.contentRequestId);
    if (existing) return existing;
    const connection = await this.getConnection(input.accountId);
    if (!connection) {
      throw new CanvaError("CANVA_NOT_CONNECTED", 409, "Conecte sua conta Canva antes de criar o design.");
    }

    const assetId = await this.uploadAsset(
      input.accountId,
      input.assetName.slice(0, 50),
      input.data,
    );
    const response = await this.canvaFetch(input.accountId, `${CANVA_API}/designs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "type_and_asset",
        design_type: { type: "custom", width: input.width, height: input.height },
        asset_id: assetId,
        title: input.title.slice(0, 255),
      }),
      signal: AbortSignal.timeout(30_000),
    });
    const payload = (await response.json().catch(() => ({}))) as DesignPayload;
    const design = payload.design;
    if (!response.ok || !design?.id || !design.urls?.edit_url || !design.urls?.view_url) {
      throw new CanvaError(
        "CANVA_DESIGN_FAILED",
        response.status === 401 ? 401 : 502,
        payload.message || "O Canva não criou o design aprovado.",
      );
    }

    const now = new Date().toISOString();
    const record: CanvaDesign = {
      provider: "canva",
      contentRequestId: input.contentRequestId,
      designId: design.id,
      assetId,
      editUrl: design.urls.edit_url,
      viewUrl: design.urls.view_url,
      createdAt: now,
      updatedAt: now,
    };
    await this.saveDesign(input.accountId, record);
    return record;
  }

  private async uploadAsset(accountId: string, name: string, data: Buffer) {
    const response = await this.canvaFetch(accountId, `${CANVA_API}/asset-uploads`, {
      method: "POST",
      headers: {
        "Content-Type": "application/octet-stream",
        "Asset-Upload-Metadata": JSON.stringify({
          name_base64: Buffer.from(name || "Criativo MODO", "utf8").toString("base64"),
        }),
      },
      body: data,
      signal: AbortSignal.timeout(30_000),
    });
    const payload = (await response.json().catch(() => ({}))) as UploadJobPayload;
    if (!response.ok || !payload.job?.id) {
      throw new CanvaError(
        "CANVA_ASSET_UPLOAD_FAILED",
        response.status === 401 ? 401 : 502,
        payload.message || payload.job?.error?.message || "O Canva não iniciou o envio da imagem.",
      );
    }
    if (payload.job.status === "success" && payload.job.asset?.id) return payload.job.asset.id;
    const jobId = payload.job.id;
    for (let attempt = 0; attempt < 35; attempt += 1) {
      await delay(700);
      const statusResponse = await this.canvaFetch(
        accountId,
        `${CANVA_API}/asset-uploads/${encodeURIComponent(jobId)}`,
        { method: "GET", signal: AbortSignal.timeout(15_000) },
      );
      const statusPayload = (await statusResponse.json().catch(() => ({}))) as UploadJobPayload;
      if (!statusResponse.ok) {
        throw new CanvaError(
          "CANVA_ASSET_STATUS_FAILED",
          statusResponse.status === 401 ? 401 : 502,
          statusPayload.message || "Não foi possível acompanhar o envio da imagem ao Canva.",
        );
      }
      if (statusPayload.job?.status === "success" && statusPayload.job.asset?.id) {
        return statusPayload.job.asset.id;
      }
      if (statusPayload.job?.status === "failed") {
        throw new CanvaError(
          "CANVA_ASSET_PROCESSING_FAILED",
          502,
          statusPayload.job.error?.message || "O Canva não processou a imagem aprovada.",
        );
      }
    }
    throw new CanvaError("CANVA_ASSET_TIMEOUT", 504, "O Canva demorou demais para processar a imagem. Tente novamente.");
  }

  private async refreshDesignLinks(accountId: string, current: CanvaDesign) {
    const response = await this.canvaFetch(
      accountId,
      `${CANVA_API}/designs/${encodeURIComponent(current.designId)}`,
      { method: "GET", signal: AbortSignal.timeout(15_000) },
    );
    const payload = (await response.json().catch(() => ({}))) as DesignPayload;
    if (!response.ok || !payload.design?.urls?.edit_url || !payload.design.urls.view_url) return current;
    const updated = {
      ...current,
      editUrl: payload.design.urls.edit_url,
      viewUrl: payload.design.urls.view_url,
      updatedAt: new Date().toISOString(),
    };
    await this.saveDesign(accountId, updated);
    return updated;
  }

  private async canvaFetch(accountId: string, url: string, init: RequestInit) {
    let token = await this.getAccessToken(accountId);
    let response = await this.fetchWithToken(url, init, token);
    if (response.status === 401) {
      token = await this.getAccessToken(accountId, true);
      response = await this.fetchWithToken(url, init, token);
    }
    return response;
  }

  private fetchWithToken(url: string, init: RequestInit, token: string) {
    const headers = new Headers(init.headers);
    headers.set("Authorization", `Bearer ${token}`);
    return fetch(url, { ...init, headers });
  }

  private async getAccessToken(accountId: string, forceRefresh = false) {
    const connection = await this.getConnection(accountId);
    if (!connection) {
      throw new CanvaError("CANVA_NOT_CONNECTED", 409, "Conecte novamente sua conta Canva.");
    }
    if (!forceRefresh && connection.tokenExpiresAt.getTime() > Date.now() + 120_000) {
      return this.decrypt(connection.encryptedAccessToken);
    }
    const active = this.refreshing.get(accountId);
    if (active) return active;
    const refresh = this.refreshConnection(connection).finally(() => this.refreshing.delete(accountId));
    this.refreshing.set(accountId, refresh);
    return refresh;
  }

  private async refreshConnection(connection: Connection) {
    const token = await this.exchangeToken(new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: this.decrypt(connection.encryptedRefreshToken),
    }));
    if (!token.access_token || !token.refresh_token) {
      throw new CanvaError("CANVA_REFRESH_FAILED", 401, "A autorização do Canva expirou. Conecte novamente.");
    }
    const updated: Connection = {
      ...connection,
      encryptedAccessToken: this.encrypt(token.access_token),
      encryptedRefreshToken: this.encrypt(token.refresh_token),
      tokenExpiresAt: new Date(Date.now() + Number(token.expires_in || 14_400) * 1000),
      scopes: (token.scope || connection.scopes.join(" ")).split(/\s+/).filter(Boolean),
      updatedAt: new Date(),
    };
    await this.saveConnection(updated);
    return token.access_token;
  }

  private async exchangeToken(body: URLSearchParams): Promise<TokenResponse> {
    const response = await fetch(`${CANVA_API}/oauth/token`, {
      method: "POST",
      headers: {
        Authorization: this.basicAuthorization,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body,
      signal: AbortSignal.timeout(20_000),
    });
    const payload = (await response.json().catch(() => ({}))) as TokenResponse;
    if (!response.ok) {
      throw new CanvaError(
        "CANVA_TOKEN_EXCHANGE_FAILED",
        response.status === 401 ? 401 : 502,
        payload.message || "O Canva recusou a autorização.",
      );
    }
    return payload;
  }

  private get basicAuthorization() {
    return `Basic ${Buffer.from(`${this.options.clientId}:${this.options.clientSecret}`).toString("base64")}`;
  }

  private get scopes() {
    return (this.options.scopes || "asset:read asset:write design:content:write design:meta:read")
      .split(/[ ,]+/)
      .map((item) => item.trim())
      .filter(Boolean);
  }

  private requireConfigured() {
    if (!this.configured) {
      throw new CanvaError(
        "CANVA_NOT_CONFIGURED",
        503,
        "A integração Canva ainda não foi configurada pela MODO.",
      );
    }
  }

  private frontendRedirect(contentRequestId: string | null, status: "connected" | "error", message?: string) {
    const base = (this.options.webUrl || "http://localhost:5173").replace(/\/$/, "");
    const url = new URL("/app/content", base);
    if (contentRequestId) url.searchParams.set("open", contentRequestId);
    url.searchParams.set("canva", status);
    if (message) url.searchParams.set("canvaMessage", message.slice(0, 500));
    return url.toString();
  }

  private encrypt(value: string) {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.encryptionKey, iv);
    const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
    return [
      iv.toString("base64url"),
      cipher.getAuthTag().toString("base64url"),
      encrypted.toString("base64url"),
    ].join(".");
  }

  private decrypt(value: string) {
    const [ivValue, tagValue, dataValue] = value.split(".");
    if (!ivValue || !tagValue || !dataValue) {
      throw new CanvaError("CANVA_INVALID_TOKEN", 500, "Credencial Canva inválida.");
    }
    const decipher = createDecipheriv(
      "aes-256-gcm",
      this.encryptionKey,
      Buffer.from(ivValue, "base64url"),
    );
    decipher.setAuthTag(Buffer.from(tagValue, "base64url"));
    return Buffer.concat([
      decipher.update(Buffer.from(dataValue, "base64url")),
      decipher.final(),
    ]).toString("utf8");
  }

  private get encryptionKey() {
    return createHash("sha256").update(this.options.encryptionSecret || "disabled").digest();
  }

  private async saveState(record: OAuthState) {
    this.states.set(record.state, record);
    if (this.pool) {
      await this.pool.query(
        `INSERT INTO modo_canva_oauth_states(
          state,account_id,content_request_id,encrypted_code_verifier,expires_at
        ) VALUES($1,$2,$3,$4,$5)`,
        [
          record.state,
          record.accountId,
          record.contentRequestId,
          this.encrypt(record.codeVerifier),
          record.expiresAt,
        ],
      );
    }
  }

  private async consumeState(state: string): Promise<OAuthState | null> {
    const memory = this.states.get(state);
    this.states.delete(state);
    if (this.pool) {
      const result = await this.pool.query<{
        state: string;
        account_id: string;
        content_request_id: string | null;
        encrypted_code_verifier: string;
        expires_at: Date;
      }>(
        `DELETE FROM modo_canva_oauth_states WHERE state=$1
         RETURNING state,account_id,content_request_id,encrypted_code_verifier,expires_at`,
        [state],
      );
      const row = result.rows[0];
      if (row) {
        return {
          state: row.state,
          accountId: row.account_id,
          contentRequestId: row.content_request_id,
          codeVerifier: this.decrypt(row.encrypted_code_verifier),
          expiresAt: row.expires_at,
        };
      }
    }
    return memory || null;
  }

  private async saveConnection(connection: Connection) {
    this.connections.set(connection.accountId, connection);
    if (this.pool) {
      await this.pool.query(
        `INSERT INTO modo_canva_connections(
          account_id,encrypted_access_token,encrypted_refresh_token,token_expires_at,
          scopes,connected_at,updated_at
        ) VALUES($1,$2,$3,$4,$5,$6,$7)
        ON CONFLICT(account_id) DO UPDATE SET
          encrypted_access_token=EXCLUDED.encrypted_access_token,
          encrypted_refresh_token=EXCLUDED.encrypted_refresh_token,
          token_expires_at=EXCLUDED.token_expires_at,
          scopes=EXCLUDED.scopes,
          updated_at=NOW()`,
        [
          connection.accountId,
          connection.encryptedAccessToken,
          connection.encryptedRefreshToken,
          connection.tokenExpiresAt,
          connection.scopes,
          connection.connectedAt,
          connection.updatedAt,
        ],
      );
    }
  }

  private async getConnection(accountId: string): Promise<Connection | null> {
    if (this.pool) {
      const result = await this.pool.query<ConnectionRow>(
        `SELECT account_id,encrypted_access_token,encrypted_refresh_token,
                token_expires_at,scopes,connected_at,updated_at
         FROM modo_canva_connections WHERE account_id=$1 LIMIT 1`,
        [accountId],
      );
      const row = result.rows[0];
      if (row) {
        return {
          accountId: row.account_id,
          encryptedAccessToken: row.encrypted_access_token,
          encryptedRefreshToken: row.encrypted_refresh_token,
          tokenExpiresAt: row.token_expires_at,
          scopes: row.scopes,
          connectedAt: row.connected_at,
          updatedAt: row.updated_at,
        };
      }
    }
    return this.connections.get(accountId) || null;
  }

  private designKey(accountId: string, contentRequestId: string) {
    return `${accountId}:${contentRequestId}`;
  }

  private async loadDesign(accountId: string, contentRequestId: string): Promise<CanvaDesign | null> {
    if (this.pool) {
      const result = await this.pool.query<DesignRow>(
        `SELECT account_id,content_request_id,design_id,asset_id,edit_url,view_url,
                links_refreshed_at,created_at,updated_at
         FROM modo_canva_designs WHERE account_id=$1 AND content_request_id=$2 LIMIT 1`,
        [accountId, contentRequestId],
      );
      const row = result.rows[0];
      if (row) {
        return {
          provider: "canva",
          contentRequestId: row.content_request_id,
          designId: row.design_id,
          assetId: row.asset_id,
          editUrl: row.edit_url,
          viewUrl: row.view_url,
          createdAt: row.created_at.toISOString(),
          updatedAt: row.links_refreshed_at.toISOString(),
        };
      }
    }
    return this.designs.get(this.designKey(accountId, contentRequestId)) || null;
  }

  private async saveDesign(accountId: string, design: CanvaDesign) {
    this.designs.set(this.designKey(accountId, design.contentRequestId), design);
    if (this.pool) {
      await this.pool.query(
        `INSERT INTO modo_canva_designs(
          account_id,content_request_id,design_id,asset_id,edit_url,view_url,links_refreshed_at
        ) VALUES($1,$2,$3,$4,$5,$6,NOW())
        ON CONFLICT(account_id,content_request_id) DO UPDATE SET
          design_id=EXCLUDED.design_id,asset_id=EXCLUDED.asset_id,
          edit_url=EXCLUDED.edit_url,view_url=EXCLUDED.view_url,
          links_refreshed_at=NOW(),updated_at=NOW()`,
        [
          accountId,
          design.contentRequestId,
          design.designId,
          design.assetId,
          design.editUrl,
          design.viewUrl,
        ],
      );
    }
  }
}
