import type {
  MetaConnectionStatus,
  MetaMedia,
  MetaMetric,
  MetaOverview,
  MetaProfile,
} from "@modo/contracts/meta";
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  randomUUID,
} from "node:crypto";
import pg, { type Pool } from "pg";

const { Pool: PgPool } = pg;

interface MetaServiceOptions {
  clientId?: string;
  clientSecret?: string;
  redirectUri?: string;
  encryptionSecret?: string;
  scopes?: string;
  apiVersion?: string;
  webUrl?: string;
  databaseUrl?: string;
  databaseSsl?: boolean;
}

interface OAuthState {
  state: string;
  accountId: string;
  expiresAt: Date;
}

interface Connection {
  accountId: string;
  instagramUserId: string;
  username: string;
  displayName: string;
  accountType: string;
  encryptedAccessToken: string;
  tokenExpiresAt: Date;
  scopes: string[];
}

interface ConnectionRow {
  account_id: string;
  instagram_user_id: string;
  username: string;
  display_name: string;
  account_type: string;
  encrypted_access_token: string;
  token_expires_at: Date;
  scopes: string[];
}

interface TokenResponse {
  access_token?: string;
  user_id?: string | number;
  expires_in?: number;
  permissions?: string[];
  error_type?: string;
  code?: number;
  error_message?: string;
  error?: {
    message?: string;
    type?: string;
    code?: number;
  };
}

type JsonRecord = Record<string, unknown>;

function stringValue(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function numberValue(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) return Number(value);
  return null;
}

function nullableString(value: unknown) {
  const normalized = stringValue(value);
  return normalized || null;
}

function nullableUrl(value: unknown) {
  const normalized = stringValue(value);
  if (!normalized) return null;
  try {
    const url = new URL(normalized);
    return ["http:", "https:"].includes(url.protocol) ? url.toString() : null;
  } catch {
    return null;
  }
}

function providerMessage(payload: TokenResponse | JsonRecord, fallback: string) {
  const nested = (payload as TokenResponse).error?.message;
  return nested || stringValue((payload as TokenResponse).error_message) || fallback;
}

export class MetaError extends Error {
  constructor(
    public readonly code: string,
    public readonly statusCode: number,
    message: string,
  ) {
    super(message);
    this.name = "MetaError";
  }
}

export class MetaService {
  private readonly pool?: Pool;
  private readonly states = new Map<string, OAuthState>();
  private readonly connections = new Map<string, Connection>();

  constructor(private readonly options: MetaServiceOptions) {
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

  get storage(): "postgres" | "memory" {
    return this.pool ? "postgres" : "memory";
  }

  get scopes() {
    return (this.options.scopes || "instagram_business_basic instagram_business_manage_insights")
      .split(/[\s,]+/)
      .map((scope) => scope.trim())
      .filter(Boolean);
  }

  get apiVersion() {
    const value = stringValue(this.options.apiVersion) || "v25.0";
    return value.startsWith("v") ? value : `v${value}`;
  }

  async initialize() {
    if (!this.pool) return;
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS modo_meta_oauth_states (
        state TEXT PRIMARY KEY,
        account_id TEXT NOT NULL REFERENCES modo_organizations(id) ON DELETE CASCADE,
        expires_at TIMESTAMPTZ NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS modo_meta_connections (
        account_id TEXT PRIMARY KEY REFERENCES modo_organizations(id) ON DELETE CASCADE,
        instagram_user_id TEXT NOT NULL,
        username TEXT NOT NULL,
        display_name TEXT NOT NULL DEFAULT '',
        account_type TEXT NOT NULL DEFAULT '',
        encrypted_access_token TEXT NOT NULL,
        token_expires_at TIMESTAMPTZ NOT NULL,
        scopes TEXT[] NOT NULL DEFAULT '{}',
        connected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
  }

  async close() {
    await this.pool?.end();
  }

  async getStatus(accountId: string): Promise<MetaConnectionStatus> {
    const connection = await this.getConnection(accountId);
    if (!this.configured) {
      return {
        provider: "instagram",
        integrationConfigured: false,
        connected: false,
        instagramUserId: null,
        username: null,
        displayName: null,
        accountType: null,
        expiresAt: null,
        scopes: this.scopes,
        canReadProfile: false,
        canReadInsights: false,
        readOnly: true,
        message: "O Meta Connect está preparado e aguarda as credenciais do aplicativo Instagram no Render.",
      };
    }

    if (!connection) {
      return {
        provider: "instagram",
        integrationConfigured: true,
        connected: false,
        instagramUserId: null,
        username: null,
        displayName: null,
        accountType: null,
        expiresAt: null,
        scopes: this.scopes,
        canReadProfile: false,
        canReadInsights: false,
        readOnly: true,
        message: "Conecte uma conta profissional do Instagram para importar perfil e indicadores. A MODO não publica nem altera nada neste modo.",
      };
    }

    const expired = connection.tokenExpiresAt <= new Date();
    const canReadInsights = connection.scopes.includes("instagram_business_manage_insights");
    return {
      provider: "instagram",
      integrationConfigured: true,
      connected: !expired,
      instagramUserId: connection.instagramUserId,
      username: connection.username,
      displayName: connection.displayName || connection.username,
      accountType: connection.accountType || null,
      expiresAt: connection.tokenExpiresAt.toISOString(),
      scopes: connection.scopes,
      canReadProfile: !expired,
      canReadInsights: !expired && canReadInsights,
      readOnly: true,
      message: expired
        ? "A autorização do Instagram expirou. Reconecte a conta para atualizar os indicadores."
        : `Instagram @${connection.username} conectado em modo somente leitura.`,
    };
  }

  async createAuthorizationUrl(accountId: string) {
    this.requireConfigured();
    const state = `${randomUUID()}${randomBytes(18).toString("hex")}`;
    await this.saveState({
      state,
      accountId,
      expiresAt: new Date(Date.now() + 15 * 60_000),
    });

    const url = new URL("https://www.instagram.com/oauth/authorize");
    url.searchParams.set("client_id", this.options.clientId!);
    url.searchParams.set("redirect_uri", this.options.redirectUri!);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", this.scopes.join(","));
    url.searchParams.set("state", state);
    url.searchParams.set("enable_fb_login", "0");
    url.searchParams.set("force_authentication", "1");
    return { authorizationUrl: url.toString() };
  }

  async completeAuthorization(input: {
    state?: string;
    code?: string;
    error?: string;
    errorDescription?: string;
  }) {
    const fallback = this.frontendRedirect(
      "error",
      input.errorDescription || input.error || "A autorização do Instagram não foi concluída.",
    );
    if (!input.state) return fallback;

    const state = await this.consumeState(input.state);
    if (!state || state.expiresAt <= new Date()) {
      return this.frontendRedirect("error", "A autorização expirou. Inicie novamente pela MODO.");
    }
    if (input.error || !input.code) return fallback;

    try {
      const shortLived = await this.exchangeCode(input.code.replace(/#_$/, ""));
      if (!shortLived.access_token) {
        throw new MetaError(
          "META_TOKEN_NOT_RECEIVED",
          502,
          providerMessage(shortLived, "O Instagram não retornou um token de acesso."),
        );
      }

      const longLived = await this.exchangeLongLivedToken(shortLived.access_token);
      const accessToken = longLived.access_token || shortLived.access_token;
      const profile = await this.fetchProfile(accessToken);
      const instagramUserId = profile.id || String(shortLived.user_id || "");
      if (!instagramUserId || !profile.username) {
        throw new MetaError(
          "META_PROFILE_INCOMPLETE",
          502,
          "O Instagram não retornou o identificador e o nome de usuário da conta profissional.",
        );
      }

      await this.saveConnection({
        accountId: state.accountId,
        instagramUserId,
        username: profile.username,
        displayName: profile.name || profile.username,
        accountType: profile.accountType || "",
        encryptedAccessToken: this.encrypt(accessToken),
        tokenExpiresAt: new Date(
          Date.now() + Number(longLived.expires_in || shortLived.expires_in || 5_184_000) * 1000,
        ),
        scopes: shortLived.permissions?.length ? shortLived.permissions : this.scopes,
      });
      return this.frontendRedirect("connected");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Não foi possível concluir a conexão com o Instagram.";
      return this.frontendRedirect("error", message);
    }
  }

  async disconnect(accountId: string) {
    this.connections.delete(accountId);
    if (this.pool) {
      await this.pool.query("DELETE FROM modo_meta_connections WHERE account_id=$1", [accountId]);
    }
    return { disconnected: true };
  }

  async getOverview(accountId: string): Promise<MetaOverview> {
    const connection = await this.getConnection(accountId);
    if (!this.configured || !connection) {
      throw new MetaError(
        "META_NOT_CONNECTED",
        409,
        "Conecte uma conta profissional do Instagram para carregar os indicadores.",
      );
    }
    if (connection.tokenExpiresAt <= new Date()) {
      throw new MetaError(
        "META_TOKEN_EXPIRED",
        409,
        "A autorização do Instagram expirou. Reconecte a conta para continuar.",
      );
    }

    const token = this.decrypt(connection.encryptedAccessToken);
    const profile = await this.fetchProfile(token);
    const warnings: string[] = [];
    let metrics: MetaMetric[] = [];
    let recentMedia: MetaMedia[] = [];

    try {
      metrics = await this.fetchInsights(token);
    } catch (error) {
      warnings.push(
        error instanceof Error
          ? `Indicadores indisponíveis: ${error.message}`
          : "Os indicadores da conta não puderam ser carregados.",
      );
    }

    try {
      recentMedia = await this.fetchRecentMedia(token);
    } catch (error) {
      warnings.push(
        error instanceof Error
          ? `Mídias recentes indisponíveis: ${error.message}`
          : "As mídias recentes não puderam ser carregadas.",
      );
    }

    return {
      profile,
      metrics,
      recentMedia,
      warnings,
      collectedAt: new Date().toISOString(),
    };
  }

  private requireConfigured() {
    if (!this.configured) {
      throw new MetaError(
        "META_NOT_CONFIGURED",
        503,
        "O Meta Connect ainda não foi configurado no ambiente da MODO.",
      );
    }
  }

  private async exchangeCode(code: string): Promise<TokenResponse> {
    const body = new URLSearchParams({
      client_id: this.options.clientId!,
      client_secret: this.options.clientSecret!,
      grant_type: "authorization_code",
      redirect_uri: this.options.redirectUri!,
      code,
    });
    const response = await fetch("https://api.instagram.com/oauth/access_token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
      signal: AbortSignal.timeout(20_000),
    });
    const payload = (await response.json().catch(() => ({}))) as TokenResponse;
    if (!response.ok || !payload.access_token) {
      throw new MetaError(
        "META_TOKEN_EXCHANGE_FAILED",
        502,
        providerMessage(payload, `O Instagram respondeu ${response.status} ao trocar o código.`),
      );
    }
    return payload;
  }

  private async exchangeLongLivedToken(shortLivedToken: string): Promise<TokenResponse> {
    const params = {
      grant_type: "ig_exchange_token",
      client_secret: this.options.clientSecret!,
      access_token: shortLivedToken,
    };
    const body = new URLSearchParams(params);
    const post = await fetch("https://graph.instagram.com/access_token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
      signal: AbortSignal.timeout(20_000),
    });
    const postPayload = (await post.json().catch(() => ({}))) as TokenResponse;
    if (post.ok && postPayload.access_token) return postPayload;

    const fallback = new URL("https://graph.instagram.com/access_token");
    Object.entries(params).forEach(([key, value]) => fallback.searchParams.set(key, value));
    const get = await fetch(fallback, { signal: AbortSignal.timeout(20_000) });
    const getPayload = (await get.json().catch(() => ({}))) as TokenResponse;
    if (get.ok && getPayload.access_token) return getPayload;

    throw new MetaError(
      "META_LONG_TOKEN_EXCHANGE_FAILED",
      502,
      providerMessage(
        getPayload,
        providerMessage(postPayload, "Não foi possível criar uma autorização de longa duração."),
      ),
    );
  }

  private async fetchProfile(token: string): Promise<MetaProfile> {
    const url = new URL(`https://graph.instagram.com/${this.apiVersion}/me`);
    url.searchParams.set(
      "fields",
      "id,user_id,username,name,account_type,profile_picture_url,followers_count,follows_count,media_count,biography,website",
    );
    url.searchParams.set("access_token", token);
    const payload = await this.fetchRecord(url, "Não foi possível carregar o perfil do Instagram.");
    const id = stringValue(payload.id) || String(payload.user_id || "");
    const username = stringValue(payload.username);
    if (!id || !username) {
      throw new MetaError(
        "META_PROFILE_INVALID",
        502,
        "O Instagram retornou um perfil incompleto. Confirme que a conta é profissional.",
      );
    }
    return {
      id,
      username,
      name: nullableString(payload.name),
      accountType: nullableString(payload.account_type),
      profilePictureUrl: nullableUrl(payload.profile_picture_url),
      followersCount: numberValue(payload.followers_count),
      followsCount: numberValue(payload.follows_count),
      mediaCount: numberValue(payload.media_count),
      biography: nullableString(payload.biography),
      website: nullableString(payload.website),
    };
  }

  private async fetchInsights(token: string): Promise<MetaMetric[]> {
    const url = new URL(`https://graph.instagram.com/${this.apiVersion}/me/insights`);
    url.searchParams.set("metric", "reach,profile_views,accounts_engaged,total_interactions");
    url.searchParams.set("period", "day");
    url.searchParams.set("access_token", token);
    const payload = await this.fetchRecord(url, "Não foi possível carregar os insights do Instagram.");
    const data = Array.isArray(payload.data) ? payload.data : [];
    return data.flatMap((raw): MetaMetric[] => {
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) return [];
      const item = raw as JsonRecord;
      const values = Array.isArray(item.values) ? item.values : [];
      const last = values.at(-1);
      const lastRecord = last && typeof last === "object" && !Array.isArray(last)
        ? last as JsonRecord
        : {};
      const totalValue = item.total_value && typeof item.total_value === "object" && !Array.isArray(item.total_value)
        ? item.total_value as JsonRecord
        : {};
      return [{
        name: stringValue(item.name) || "metric",
        title: stringValue(item.title) || stringValue(item.name) || "Indicador",
        value: numberValue(totalValue.value ?? lastRecord.value),
        period: nullableString(item.period),
        endTime: nullableString(lastRecord.end_time),
      }];
    });
  }

  private async fetchRecentMedia(token: string): Promise<MetaMedia[]> {
    const url = new URL(`https://graph.instagram.com/${this.apiVersion}/me/media`);
    url.searchParams.set(
      "fields",
      "id,caption,media_type,media_url,thumbnail_url,permalink,timestamp,like_count,comments_count",
    );
    url.searchParams.set("limit", "12");
    url.searchParams.set("access_token", token);
    const payload = await this.fetchRecord(url, "Não foi possível carregar as mídias recentes.");
    const data = Array.isArray(payload.data) ? payload.data : [];
    return data.flatMap((raw): MetaMedia[] => {
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) return [];
      const item = raw as JsonRecord;
      const id = stringValue(item.id);
      if (!id) return [];
      return [{
        id,
        caption: nullableString(item.caption),
        mediaType: stringValue(item.media_type) || "MEDIA",
        mediaUrl: nullableUrl(item.media_url),
        thumbnailUrl: nullableUrl(item.thumbnail_url),
        permalink: nullableUrl(item.permalink),
        timestamp: nullableString(item.timestamp),
        likeCount: numberValue(item.like_count),
        commentsCount: numberValue(item.comments_count),
      }];
    });
  }

  private async fetchRecord(url: URL, fallback: string): Promise<JsonRecord> {
    const response = await fetch(url, { signal: AbortSignal.timeout(20_000) });
    const payload = (await response.json().catch(() => ({}))) as JsonRecord;
    if (!response.ok) {
      throw new MetaError(
        "META_API_ERROR",
        response.status === 401 ? 409 : 502,
        providerMessage(payload, fallback),
      );
    }
    return payload;
  }

  private frontendRedirect(status: "connected" | "error", message?: string) {
    const target = new URL("/app/meta", this.options.webUrl || "http://localhost:5173");
    target.searchParams.set("meta", status);
    if (message) target.searchParams.set("message", message.slice(0, 400));
    return target.toString();
  }

  private key() {
    if (!this.options.encryptionSecret) {
      throw new MetaError("META_ENCRYPTION_NOT_CONFIGURED", 503, "A proteção dos tokens Meta não foi configurada.");
    }
    return createHash("sha256").update(this.options.encryptionSecret).digest();
  }

  private encrypt(value: string) {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key(), iv);
    const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
    const tag = cipher.getAuthTag();
    return [iv, tag, encrypted].map((item) => item.toString("base64url")).join(".");
  }

  private decrypt(value: string) {
    const [ivValue, tagValue, encryptedValue] = value.split(".");
    if (!ivValue || !tagValue || !encryptedValue) {
      throw new MetaError("META_TOKEN_INVALID", 500, "O token armazenado do Instagram é inválido.");
    }
    const decipher = createDecipheriv(
      "aes-256-gcm",
      this.key(),
      Buffer.from(ivValue, "base64url"),
    );
    decipher.setAuthTag(Buffer.from(tagValue, "base64url"));
    return Buffer.concat([
      decipher.update(Buffer.from(encryptedValue, "base64url")),
      decipher.final(),
    ]).toString("utf8");
  }

  private async saveState(state: OAuthState) {
    this.states.set(state.state, state);
    if (this.pool) {
      await this.pool.query(
        `INSERT INTO modo_meta_oauth_states(state,account_id,expires_at)
         VALUES($1,$2,$3)
         ON CONFLICT(state) DO UPDATE SET account_id=EXCLUDED.account_id,expires_at=EXCLUDED.expires_at`,
        [state.state, state.accountId, state.expiresAt],
      );
    }
  }

  private async consumeState(state: string): Promise<OAuthState | null> {
    if (this.pool) {
      const result = await this.pool.query<{ state: string; account_id: string; expires_at: Date }>(
        "DELETE FROM modo_meta_oauth_states WHERE state=$1 RETURNING state,account_id,expires_at",
        [state],
      );
      const row = result.rows[0];
      return row ? { state: row.state, accountId: row.account_id, expiresAt: row.expires_at } : null;
    }
    const current = this.states.get(state) ?? null;
    this.states.delete(state);
    return current;
  }

  private async saveConnection(connection: Connection) {
    this.connections.set(connection.accountId, connection);
    if (this.pool) {
      await this.pool.query(
        `INSERT INTO modo_meta_connections(
          account_id,instagram_user_id,username,display_name,account_type,
          encrypted_access_token,token_expires_at,scopes
        ) VALUES($1,$2,$3,$4,$5,$6,$7,$8)
        ON CONFLICT(account_id) DO UPDATE SET
          instagram_user_id=EXCLUDED.instagram_user_id,
          username=EXCLUDED.username,
          display_name=EXCLUDED.display_name,
          account_type=EXCLUDED.account_type,
          encrypted_access_token=EXCLUDED.encrypted_access_token,
          token_expires_at=EXCLUDED.token_expires_at,
          scopes=EXCLUDED.scopes,
          updated_at=NOW()`,
        [
          connection.accountId,
          connection.instagramUserId,
          connection.username,
          connection.displayName,
          connection.accountType,
          connection.encryptedAccessToken,
          connection.tokenExpiresAt,
          connection.scopes,
        ],
      );
    }
  }

  private async getConnection(accountId: string): Promise<Connection | null> {
    if (this.pool) {
      const result = await this.pool.query<ConnectionRow>(
        `SELECT account_id,instagram_user_id,username,display_name,account_type,
                encrypted_access_token,token_expires_at,scopes
         FROM modo_meta_connections WHERE account_id=$1 LIMIT 1`,
        [accountId],
      );
      const row = result.rows[0];
      return row ? {
        accountId: row.account_id,
        instagramUserId: row.instagram_user_id,
        username: row.username,
        displayName: row.display_name,
        accountType: row.account_type,
        encryptedAccessToken: row.encrypted_access_token,
        tokenExpiresAt: row.token_expires_at,
        scopes: row.scopes || [],
      } : null;
    }
    return this.connections.get(accountId) ?? null;
  }
}
