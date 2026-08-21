import { createCipheriv, createHash, randomBytes, randomUUID } from "node:crypto";
import pg, { type Pool } from "pg";

const { Pool: PgPool } = pg;

type Json = Record<string, unknown>;

interface Options {
  databaseUrl?: string;
  databaseSsl?: boolean;
  clientId?: string;
  clientSecret?: string;
  redirectUri?: string;
  scopes?: string;
  encryptionSecret?: string;
}

interface OAuthContext {
  organizationId: string;
  brandId: string;
}

interface TokenPayload extends Json {
  access_token?: string;
  expires_in?: number;
  scope?: string;
  error?: string;
  error_description?: string;
}

interface ProfilePayload extends Json {
  id?: string;
  localizedFirstName?: string;
  localizedLastName?: string;
  localizedHeadline?: string;
  profilePicture?: {
    displayImage?: string;
    "displayImage~"?: { elements?: Array<{ identifiers?: Array<{ identifier?: string }> }> };
  };
  message?: string;
}

export class NativeLinkedInOAuthError extends Error {
  constructor(public readonly code: string, public readonly statusCode: number, message: string) {
    super(message);
    this.name = "NativeLinkedInOAuthError";
  }
}

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

export class NativeLinkedInOAuthService {
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
    return (this.options.scopes || "r_liteprofile w_member_social")
      .split(/[\s,]+/)
      .map((scope) => scope.trim())
      .filter(Boolean);
  }

  async close() {
    await this.pool?.end();
  }

  async createAuthorizationUrl(organizationId: string, brandId: string) {
    this.requireConfigured();
    const state = `${randomUUID()}${randomBytes(18).toString("hex")}`;
    await this.pool!.query(
      `INSERT INTO modo_native_social_oauth_states(state,organization_id,brand_id,provider,expires_at)
       VALUES($1,$2,$3,'linkedin',NOW()+INTERVAL '15 minutes')`,
      [state, organizationId, brandId],
    );

    const url = new URL("https://www.linkedin.com/oauth/v2/authorization");
    url.searchParams.set("response_type", "code");
    url.searchParams.set("client_id", this.options.clientId!);
    url.searchParams.set("redirect_uri", this.options.redirectUri!);
    url.searchParams.set("state", state);
    url.searchParams.set("scope", this.scopes.join(" "));
    return { authorizationUrl: url.toString() };
  }

  async completeAuthorization(input: { state?: string; code?: string; error?: string; errorDescription?: string }) {
    this.requireConfigured();
    if (!input.state || input.error || !input.code) {
      throw new NativeLinkedInOAuthError(
        "LINKEDIN_OAUTH_FAILED",
        400,
        input.errorDescription || input.error || "A autorização do LinkedIn não foi concluída.",
      );
    }

    const context = await this.consumeState(input.state);
    const token = await this.exchangeCode(input.code);
    const accessToken = text(token.access_token);
    if (!accessToken) {
      throw new NativeLinkedInOAuthError("LINKEDIN_TOKEN_MISSING", 502, "O LinkedIn não retornou o token esperado.");
    }

    const profile = await this.fetchProfile(accessToken);
    const profileId = text(profile.id);
    if (!profileId) {
      throw new NativeLinkedInOAuthError("LINKEDIN_PROFILE_INCOMPLETE", 502, "O LinkedIn não retornou o identificador do perfil.");
    }

    const displayName = [text(profile.localizedFirstName), text(profile.localizedLastName)].filter(Boolean).join(" ") || "Perfil LinkedIn";
    const scopes = text(token.scope) ? text(token.scope).split(/[\s,]+/).filter(Boolean) : this.scopes;
    const tokenExpiresAt = new Date(Date.now() + Number(token.expires_in || 5_184_000) * 1000);
    const id = randomUUID();
    const result = await this.pool!.query<{ id: string }>(
      `INSERT INTO modo_native_social_connections(
        id,organization_id,brand_id,provider,provider_account_id,display_name,username,
        profile_picture_url,encrypted_access_token,token_expires_at,scopes,metadata
      ) VALUES($1,$2,$3,'linkedin',$4,$5,NULL,NULL,$6,$7,$8,$9)
      ON CONFLICT(organization_id,brand_id,provider,provider_account_id) DO UPDATE SET
        display_name=EXCLUDED.display_name,
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
        `urn:li:person:${profileId}`,
        displayName,
        this.encrypt(accessToken),
        tokenExpiresAt,
        scopes,
        { source: "publisher_v2_linkedin_oauth", authorType: "member", connectedAt: new Date().toISOString() },
      ],
    );

    return {
      organizationId: context.organizationId,
      brandId: context.brandId,
      connectionId: result.rows[0]?.id || id,
      displayName,
      scopes,
      expiresAt: tokenExpiresAt.toISOString(),
    };
  }

  private requireConfigured() {
    if (!this.configured) {
      throw new NativeLinkedInOAuthError(
        "LINKEDIN_V2_NOT_CONFIGURED",
        503,
        "O LinkedIn do Publisher ainda não está configurado no ambiente.",
      );
    }
  }

  private async consumeState(state: string): Promise<OAuthContext> {
    const result = await this.pool!.query<{ organization_id: string; brand_id: string; expires_at: Date }>(
      `DELETE FROM modo_native_social_oauth_states
       WHERE state=$1 AND provider='linkedin'
       RETURNING organization_id,brand_id,expires_at`,
      [state],
    );
    const row = result.rows[0];
    if (!row || row.expires_at <= new Date()) {
      throw new NativeLinkedInOAuthError("LINKEDIN_OAUTH_STATE_INVALID", 400, "A autorização do LinkedIn expirou ou já foi utilizada.");
    }
    return { organizationId: row.organization_id, brandId: row.brand_id };
  }

  private async exchangeCode(code: string): Promise<TokenPayload> {
    const response = await fetch("https://www.linkedin.com/oauth/v2/accessToken", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        client_id: this.options.clientId!,
        client_secret: this.options.clientSecret!,
        redirect_uri: this.options.redirectUri!,
      }),
      signal: AbortSignal.timeout(20_000),
    });
    const payload = await response.json().catch(() => ({})) as TokenPayload;
    if (!response.ok || !payload.access_token) {
      throw new NativeLinkedInOAuthError(
        "LINKEDIN_TOKEN_EXCHANGE_FAILED",
        response.status === 429 ? 429 : 502,
        text(payload.error_description) || text(payload.error) || "Não foi possível obter o token do LinkedIn.",
      );
    }
    return payload;
  }

  private async fetchProfile(token: string): Promise<ProfilePayload> {
    const response = await fetch("https://api.linkedin.com/v2/me", {
      headers: {
        authorization: `Bearer ${token}`,
        "x-restli-protocol-version": "2.0.0",
      },
      signal: AbortSignal.timeout(20_000),
    });
    const payload = await response.json().catch(() => ({})) as ProfilePayload;
    if (!response.ok || !payload.id) {
      throw new NativeLinkedInOAuthError(
        "LINKEDIN_PROFILE_FAILED",
        502,
        text(payload.message) || "Não foi possível identificar o perfil conectado no LinkedIn.",
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
