import { createCipheriv, createHash, randomBytes, randomUUID } from "node:crypto";
import pg, { type Pool } from "pg";

const { Pool: PgPool } = pg;
const INSTAGRAM_AUTH_URL = "https://www.instagram.com/oauth/authorize";
const INSTAGRAM_TOKEN_URL = "https://api.instagram.com/oauth/access_token";
const DEFAULT_TOKEN_SECONDS = 60 * 24 * 60 * 60;

type Json = Record<string, unknown>;

interface Options {
  databaseUrl?: string;
  databaseSsl?: boolean;
  clientId?: string;
  clientSecret?: string;
  redirectUri?: string;
  encryptionSecret?: string;
  scopes?: string;
  graphBaseUrl?: string;
  apiVersion?: string;
}

interface OAuthContext {
  organizationId: string;
  brandId: string;
}

interface TokenPayload extends Json {
  access_token?: string;
  user_id?: string | number;
  expires_in?: number;
  permissions?: string[];
  error_message?: string;
  error?: { message?: string };
}

interface IdentityPayload extends Json {
  id?: string;
  username?: string;
  profile_picture_url?: string;
}

export class NativeInstagramOAuthError extends Error {
  constructor(public readonly code: string, public readonly statusCode: number, message: string) {
    super(message);
    this.name = "NativeInstagramOAuthError";
  }
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function providerMessage(payload: TokenPayload, fallback: string) {
  return stringValue(payload.error?.message) || stringValue(payload.error_message) || fallback;
}

function statusCodeForProvider(status: number) {
  if (status === 400) return 422;
  if (status === 401 || status === 403) return 409;
  if (status === 429) return 429;
  return 502;
}

export class NativeInstagramOAuthService {
  private readonly pool?: Pool;

  constructor(private readonly options: Options) {
    if (options.databaseUrl) {
      this.pool = new PgPool({
        connectionString: options.databaseUrl,
        ssl: options.databaseSsl ? { rejectUnauthorized: false } : undefined,
        max: 2,
      });
    }
  }

  get configured() {
    return Boolean(
      this.pool &&
      this.options.clientId &&
      this.options.clientSecret &&
      this.options.redirectUri &&
      this.options.encryptionSecret,
    );
  }

  get scopes() {
    return (
      this.options.scopes ||
      "instagram_business_basic,instagram_business_content_publish,instagram_business_manage_insights,instagram_business_manage_comments"
    )
      .split(/[\s,]+/)
      .map((scope) => scope.trim())
      .filter(Boolean);
  }

  get graphBaseUrl() {
    return (this.options.graphBaseUrl || "https://graph.instagram.com").replace(/\/$/, "");
  }

  get apiVersion() {
    const version = stringValue(this.options.apiVersion) || "v25.0";
    return version.startsWith("v") ? version : `v${version}`;
  }

  async close() {
    await this.pool?.end();
  }

  async createAuthorizationUrl(organizationId: string, brandId: string) {
    this.requireConfigured();
    const state = `${randomUUID()}${randomBytes(18).toString("hex")}`;
    await this.pool!.query(
      `INSERT INTO modo_native_social_oauth_states(state,organization_id,brand_id,provider,expires_at)
       VALUES($1,$2,$3,'instagram',NOW()+INTERVAL '15 minutes')`,
      [state, organizationId, brandId],
    );

    const url = new URL(INSTAGRAM_AUTH_URL);
    url.searchParams.set("client_id", this.options.clientId!);
    url.searchParams.set("redirect_uri", this.options.redirectUri!);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", this.scopes.join(","));
    url.searchParams.set("state", state);
    url.searchParams.set("enable_fb_login", "0");
    url.searchParams.set("force_authentication", "1");
    return { authorizationUrl: url.toString() };
  }

  async completeAuthorization(input: { state?: string; code?: string; error?: string; errorDescription?: string }) {
    this.requireConfigured();
    if (!input.state || !input.code || input.error) {
      throw new NativeInstagramOAuthError(
        "INSTAGRAM_OAUTH_FAILED",
        400,
        input.errorDescription || input.error || "A autorização do Instagram não foi concluída.",
      );
    }
    const context = await this.consumeState(input.state);
    const short = await this.exchangeCode(input.code.replace(/#_$/, ""));
    const shortToken = stringValue(short.access_token);
    if (!shortToken) {
      throw new NativeInstagramOAuthError(
        "INSTAGRAM_SHORT_TOKEN_MISSING",
        502,
        "O Instagram não retornou o token temporário esperado.",
      );
    }

    const long = await this.exchangeLongLived(shortToken);
    const accessToken = stringValue(long.access_token);
    if (!accessToken) {
      throw new NativeInstagramOAuthError(
        "INSTAGRAM_LONG_TOKEN_MISSING",
        502,
        "O Instagram não retornou o token de longa duração esperado.",
      );
    }

    const identity = await this.fetchIdentity(accessToken);
    const providerAccountId = stringValue(identity.id) || String(short.user_id || "").trim();
    const username = stringValue(identity.username);
    if (!providerAccountId || !username) {
      throw new NativeInstagramOAuthError(
        "INSTAGRAM_IDENTITY_INCOMPLETE",
        502,
        "O Instagram não retornou ID e username da conta profissional.",
      );
    }

    const tokenExpiresAt = new Date(Date.now() + Number(long.expires_in || DEFAULT_TOKEN_SECONDS) * 1000);
    const scopes = Array.isArray(short.permissions) && short.permissions.length ? short.permissions : this.scopes;
    const id = randomUUID();
    const result = await this.pool!.query(
      `INSERT INTO modo_native_social_connections(
        id,organization_id,brand_id,provider,provider_account_id,display_name,username,
        profile_picture_url,encrypted_access_token,token_expires_at,scopes,metadata
      ) VALUES($1,$2,$3,'instagram',$4,$5,$6,$7,$8,$9,$10,$11)
      ON CONFLICT(organization_id,brand_id,provider,provider_account_id) DO UPDATE SET
        display_name=EXCLUDED.display_name,
        username=EXCLUDED.username,
        profile_picture_url=EXCLUDED.profile_picture_url,
        encrypted_access_token=EXCLUDED.encrypted_access_token,
        token_expires_at=EXCLUDED.token_expires_at,
        scopes=EXCLUDED.scopes,
        metadata=EXCLUDED.metadata,
        updated_at=NOW()
      RETURNING id`,
      [
        id,
        context.organizationId,
        context.brandId,
        providerAccountId,
        `@${username}`,
        username,
        stringValue(identity.profile_picture_url) || null,
        this.encrypt(accessToken),
        tokenExpiresAt,
        scopes,
        { source: "publisher_v2_instagram_oauth", connectedAt: new Date().toISOString() },
      ],
    );

    return {
      organizationId: context.organizationId,
      brandId: context.brandId,
      connectionId: String(result.rows[0]?.id || id),
      providerAccountId,
      username,
      scopes,
      expiresAt: tokenExpiresAt.toISOString(),
    };
  }

  private requireConfigured() {
    if (!this.configured) {
      throw new NativeInstagramOAuthError(
        "INSTAGRAM_V2_NOT_CONFIGURED",
        503,
        "O Instagram do Publisher V2 ainda não está configurado no ambiente.",
      );
    }
  }

  private async consumeState(state: string): Promise<OAuthContext> {
    const result = await this.pool!.query<{ organization_id: string; brand_id: string; expires_at: Date }>(
      `DELETE FROM modo_native_social_oauth_states
       WHERE state=$1 AND provider='instagram'
       RETURNING organization_id,brand_id,expires_at`,
      [state],
    );
    const row = result.rows[0];
    if (!row || row.expires_at <= new Date()) {
      throw new NativeInstagramOAuthError(
        "INSTAGRAM_OAUTH_STATE_INVALID",
        400,
        "A autorização do Instagram expirou ou já foi utilizada.",
      );
    }
    return { organizationId: row.organization_id, brandId: row.brand_id };
  }

  private async exchangeCode(code: string): Promise<TokenPayload> {
    const response = await fetch(INSTAGRAM_TOKEN_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: this.options.clientId!,
        client_secret: this.options.clientSecret!,
        grant_type: "authorization_code",
        redirect_uri: this.options.redirectUri!,
        code,
      }),
      signal: AbortSignal.timeout(20_000),
    });
    const payload = (await response.json().catch(() => ({}))) as TokenPayload;
    if (!response.ok || !payload.access_token) {
      throw new NativeInstagramOAuthError(
        "INSTAGRAM_CODE_EXCHANGE_FAILED",
        statusCodeForProvider(response.status),
        providerMessage(payload, "Não foi possível trocar o código de autorização do Instagram."),
      );
    }
    return payload;
  }

  private async exchangeLongLived(shortToken: string): Promise<TokenPayload> {
    const url = new URL(`${this.graphBaseUrl}/access_token`);
    url.searchParams.set("grant_type", "ig_exchange_token");
    url.searchParams.set("client_secret", this.options.clientSecret!);
    url.searchParams.set("access_token", shortToken);
    const response = await fetch(url, { signal: AbortSignal.timeout(20_000) });
    const payload = (await response.json().catch(() => ({}))) as TokenPayload;
    if (!response.ok || !payload.access_token) {
      throw new NativeInstagramOAuthError(
        "INSTAGRAM_LONG_TOKEN_EXCHANGE_FAILED",
        statusCodeForProvider(response.status),
        providerMessage(payload, "Não foi possível criar o token de longa duração do Instagram."),
      );
    }
    return payload;
  }

  private async fetchIdentity(accessToken: string): Promise<IdentityPayload> {
    const detailed = new URL(`${this.graphBaseUrl}/${this.apiVersion}/me`);
    detailed.searchParams.set("fields", "id,username,profile_picture_url");
    detailed.searchParams.set("access_token", accessToken);
    const detailedResponse = await fetch(detailed, { signal: AbortSignal.timeout(20_000) });
    const detailedPayload = (await detailedResponse.json().catch(() => ({}))) as IdentityPayload;
    if (detailedResponse.ok && detailedPayload.id && detailedPayload.username) return detailedPayload;

    const fallback = new URL(`${this.graphBaseUrl}/${this.apiVersion}/me`);
    fallback.searchParams.set("fields", "id,username");
    fallback.searchParams.set("access_token", accessToken);
    const response = await fetch(fallback, { signal: AbortSignal.timeout(20_000) });
    const payload = (await response.json().catch(() => ({}))) as IdentityPayload & TokenPayload;
    if (!response.ok || !payload.id || !payload.username) {
      throw new NativeInstagramOAuthError(
        "INSTAGRAM_IDENTITY_FAILED",
        statusCodeForProvider(response.status),
        providerMessage(payload, "Não foi possível identificar a conta profissional do Instagram."),
      );
    }
    return payload;
  }

  private key() {
    return createHash("sha256").update(this.options.encryptionSecret!).digest();
  }

  private encrypt(value: string) {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key(), iv);
    const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
    const tag = cipher.getAuthTag();
    return [iv, tag, encrypted].map((part) => part.toString("base64url")).join(".");
  }
}
