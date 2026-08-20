import type { NativeConnection, NativePublisherProvider } from "@modo/contracts/native-publisher";
import { createCipheriv, createHash, randomBytes, randomUUID } from "node:crypto";
import pg, { type Pool } from "pg";
import { NativePublisherV2Error } from "./native-publisher-v2-service.js";

const { Pool: PgPool } = pg;
const DEFAULT_INSTAGRAM_TOKEN_SECONDS = 60 * 24 * 60 * 60;

type Json = Record<string, unknown>;

interface Options {
  databaseUrl?: string;
  databaseSsl?: boolean;
  instagramClientId?: string;
  instagramClientSecret?: string;
  instagramRedirectUri?: string;
  instagramEncryptionSecret?: string;
  instagramScopes?: string;
  instagramGraphBaseUrl?: string;
  instagramApiVersion?: string;
  linkedinClientId?: string;
  linkedinClientSecret?: string;
  linkedinRedirectUri?: string;
  linkedinEncryptionSecret?: string;
  linkedinScopes?: string;
}

interface ConnectionRow {
  id: string;
  organization_id: string;
  brand_id: string;
  provider: NativePublisherProvider;
  provider_account_id: string;
  display_name: string;
  username: string | null;
  profile_picture_url: string | null;
  encrypted_access_token: string;
  token_expires_at: Date | null;
  scopes: string[];
  metadata: Json;
  created_at: Date;
  updated_at: Date;
}

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function mapConnection(row: ConnectionRow): NativeConnection {
  const expired = Boolean(row.token_expires_at && row.token_expires_at <= new Date());
  const insightScopes: Record<NativePublisherProvider, string[]> = {
    instagram: ["instagram_business_manage_insights"],
    facebook: ["read_insights", "pages_read_engagement"],
    threads: ["threads_manage_insights"],
    linkedin: [],
  };
  return {
    id: row.id,
    provider: row.provider,
    brandId: row.brand_id,
    providerAccountId: row.provider_account_id,
    displayName: row.display_name,
    username: row.username,
    profilePictureUrl: row.profile_picture_url,
    scopes: row.scopes || [],
    expiresAt: row.token_expires_at?.toISOString() ?? null,
    connected: !expired,
    canPublish: !expired,
    canReadInsights:
      insightScopes[row.provider].length === 0 ||
      insightScopes[row.provider].some((scope) => (row.scopes || []).includes(scope)),
    metadata: row.metadata || {},
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

export class NativePublisherDirectOAuthService {
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
    return {
      instagram: Boolean(
        this.options.instagramClientId &&
        this.options.instagramClientSecret &&
        this.options.instagramRedirectUri &&
        this.options.instagramEncryptionSecret,
      ),
      linkedin: Boolean(
        this.options.linkedinClientId &&
        this.options.linkedinClientSecret &&
        this.options.linkedinRedirectUri &&
        this.options.linkedinEncryptionSecret,
      ),
    };
  }

  get instagramScopes() {
    return (
      this.options.instagramScopes ||
      "instagram_business_basic,instagram_business_content_publish,instagram_business_manage_insights"
    )
      .split(/[\s,]+/)
      .map((scope) => scope.trim())
      .filter(Boolean);
  }

  get linkedinScopes() {
    const configured = (this.options.linkedinScopes || "openid profile w_member_social")
      .split(/[\s,]+/)
      .map((scope) => scope.trim())
      .filter(Boolean);
    const required = ["openid", "profile", "w_member_social"];
    return [...new Set([...configured.filter((scope) => scope !== "r_liteprofile"), ...required])];
  }

  async close() {
    await this.pool?.end();
  }

  private requirePool() {
    if (!this.pool) {
      throw new NativePublisherV2Error(
        "PUBLISHER_STORAGE_REQUIRED",
        503,
        "O Publisher V2 exige PostgreSQL para conexões sociais.",
      );
    }
    return this.pool;
  }

  private key(secret?: string) {
    if (!secret) {
      throw new NativePublisherV2Error(
        "PUBLISHER_ENCRYPTION_SECRET_MISSING",
        503,
        "Segredo de criptografia do canal não configurado.",
      );
    }
    return createHash("sha256").update(secret).digest();
  }

  private encrypt(value: string, secret?: string) {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key(secret), iv);
    const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
    const tag = cipher.getAuthTag();
    return [iv, tag, encrypted].map((part) => part.toString("base64url")).join(".");
  }

  private async saveState(organizationId: string, brandId: string, provider: "instagram" | "linkedin") {
    const state = `${randomUUID()}${randomBytes(18).toString("hex")}`;
    await this.requirePool().query(
      `INSERT INTO modo_native_social_oauth_states(state,organization_id,brand_id,provider,expires_at)
       VALUES($1,$2,$3,$4,NOW()+INTERVAL '15 minutes')`,
      [state, organizationId, brandId, provider],
    );
    return state;
  }

  private async consumeState(state: string, provider: "instagram" | "linkedin") {
    const result = await this.requirePool().query<{
      organization_id: string;
      brand_id: string;
      expires_at: Date;
    }>(
      `DELETE FROM modo_native_social_oauth_states
       WHERE state=$1 AND provider=$2
       RETURNING organization_id,brand_id,expires_at`,
      [state, provider],
    );
    const row = result.rows[0];
    if (!row || row.expires_at <= new Date()) {
      throw new NativePublisherV2Error(
        "OAUTH_STATE_INVALID",
        400,
        "A autorização expirou ou já foi utilizada. Inicie novamente pela MODO.",
      );
    }
    return { organizationId: row.organization_id, brandId: row.brand_id };
  }

  private async upsertConnection(input: {
    organizationId: string;
    brandId: string;
    provider: "instagram" | "linkedin";
    providerAccountId: string;
    displayName: string;
    username: string | null;
    profilePictureUrl: string | null;
    encryptedAccessToken: string;
    tokenExpiresAt: Date | null;
    scopes: string[];
    metadata: Json;
  }) {
    const result = await this.requirePool().query<ConnectionRow>(
      `INSERT INTO modo_native_social_connections(
        id,organization_id,brand_id,provider,provider_account_id,display_name,username,
        profile_picture_url,encrypted_access_token,token_expires_at,scopes,metadata
       ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       ON CONFLICT(organization_id,brand_id,provider,provider_account_id) DO UPDATE SET
         display_name=EXCLUDED.display_name,
         username=EXCLUDED.username,
         profile_picture_url=EXCLUDED.profile_picture_url,
         encrypted_access_token=EXCLUDED.encrypted_access_token,
         token_expires_at=EXCLUDED.token_expires_at,
         scopes=EXCLUDED.scopes,
         metadata=EXCLUDED.metadata,
         updated_at=NOW()
       RETURNING *`,
      [
        randomUUID(),
        input.organizationId,
        input.brandId,
        input.provider,
        input.providerAccountId,
        input.displayName,
        input.username,
        input.profilePictureUrl,
        input.encryptedAccessToken,
        input.tokenExpiresAt,
        input.scopes,
        input.metadata,
      ],
    );
    return mapConnection(result.rows[0]);
  }

  async createInstagramAuthorizationUrl(organizationId: string, brandId: string) {
    if (!this.configured.instagram) {
      throw new NativePublisherV2Error(
        "INSTAGRAM_NOT_CONFIGURED",
        503,
        "Instagram ainda não foi configurado para o Publisher V2.",
      );
    }
    const state = await this.saveState(organizationId, brandId, "instagram");
    const url = new URL("https://www.instagram.com/oauth/authorize");
    url.searchParams.set("client_id", this.options.instagramClientId!);
    url.searchParams.set("redirect_uri", this.options.instagramRedirectUri!);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", this.instagramScopes.join(","));
    url.searchParams.set("state", state);
    url.searchParams.set("enable_fb_login", "0");
    url.searchParams.set("force_authentication", "1");
    return { authorizationUrl: url.toString() };
  }

  async completeInstagramAuthorization(input: {
    state?: string;
    code?: string;
    error?: string;
    errorDescription?: string;
  }) {
    if (!input.state || !input.code || input.error) {
      throw new NativePublisherV2Error(
        "INSTAGRAM_OAUTH_FAILED",
        400,
        input.errorDescription || input.error || "A autorização do Instagram não foi concluída.",
      );
    }
    const context = await this.consumeState(input.state, "instagram");
    const shortResponse = await fetch("https://api.instagram.com/oauth/access_token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: this.options.instagramClientId!,
        client_secret: this.options.instagramClientSecret!,
        grant_type: "authorization_code",
        redirect_uri: this.options.instagramRedirectUri!,
        code: input.code.replace(/#_$/, ""),
      }),
      signal: AbortSignal.timeout(20_000),
    });
    const short = (await shortResponse.json().catch(() => ({}))) as Json;
    const shortToken = text(short.access_token);
    if (!shortResponse.ok || !shortToken) {
      throw new NativePublisherV2Error(
        "INSTAGRAM_TOKEN_FAILED",
        502,
        text((short.error as Json | undefined)?.message) ||
          text(short.error_message) ||
          "Instagram não retornou o token temporário.",
      );
    }

    const graphBase = (this.options.instagramGraphBaseUrl || "https://graph.instagram.com").replace(/\/$/, "");
    const longUrl = new URL(`${graphBase}/access_token`);
    longUrl.searchParams.set("grant_type", "ig_exchange_token");
    longUrl.searchParams.set("client_secret", this.options.instagramClientSecret!);
    longUrl.searchParams.set("access_token", shortToken);
    const longResponse = await fetch(longUrl, { signal: AbortSignal.timeout(20_000) });
    const long = (await longResponse.json().catch(() => ({}))) as Json;
    const accessToken = text(long.access_token) || shortToken;
    if (!longResponse.ok && !accessToken) {
      throw new NativePublisherV2Error(
        "INSTAGRAM_LONG_TOKEN_FAILED",
        502,
        "Não foi possível criar o token de longa duração do Instagram.",
      );
    }

    const rawVersion = text(this.options.instagramApiVersion) || "v21.0";
    const version = rawVersion.startsWith("v") ? rawVersion : `v${rawVersion}`;
    const profileUrl = new URL(`${graphBase}/${version}/me`);
    profileUrl.searchParams.set("fields", "id,username,profile_picture_url");
    profileUrl.searchParams.set("access_token", accessToken);
    let profileResponse = await fetch(profileUrl, { signal: AbortSignal.timeout(20_000) });
    let profile = (await profileResponse.json().catch(() => ({}))) as Json;
    if (!profileResponse.ok || !text(profile.id) || !text(profile.username)) {
      profileUrl.searchParams.set("fields", "id,username");
      profileResponse = await fetch(profileUrl, { signal: AbortSignal.timeout(20_000) });
      profile = (await profileResponse.json().catch(() => ({}))) as Json;
    }
    const providerAccountId = text(profile.id);
    const username = text(profile.username);
    if (!profileResponse.ok || !providerAccountId || !username) {
      throw new NativePublisherV2Error(
        "INSTAGRAM_PROFILE_FAILED",
        502,
        "Não foi possível identificar a conta profissional do Instagram.",
      );
    }

    const expiresIn = Number(long.expires_in || DEFAULT_INSTAGRAM_TOKEN_SECONDS);
    return this.upsertConnection({
      organizationId: context.organizationId,
      brandId: context.brandId,
      provider: "instagram",
      providerAccountId,
      displayName: `@${username}`,
      username,
      profilePictureUrl: text(profile.profile_picture_url) || null,
      encryptedAccessToken: this.encrypt(accessToken, this.options.instagramEncryptionSecret),
      tokenExpiresAt: new Date(Date.now() + (Number.isFinite(expiresIn) ? expiresIn : DEFAULT_INSTAGRAM_TOKEN_SECONDS) * 1000),
      scopes: this.instagramScopes,
      metadata: { source: "publisher_v2_instagram_login" },
    });
  }

  async createLinkedInAuthorizationUrl(organizationId: string, brandId: string) {
    if (!this.configured.linkedin) {
      throw new NativePublisherV2Error(
        "LINKEDIN_NOT_CONFIGURED",
        503,
        "LinkedIn ainda não foi configurado para o Publisher V2.",
      );
    }
    const state = await this.saveState(organizationId, brandId, "linkedin");
    const url = new URL("https://www.linkedin.com/oauth/v2/authorization");
    url.searchParams.set("response_type", "code");
    url.searchParams.set("client_id", this.options.linkedinClientId!);
    url.searchParams.set("redirect_uri", this.options.linkedinRedirectUri!);
    url.searchParams.set("state", state);
    url.searchParams.set("scope", this.linkedinScopes.join(" "));
    return { authorizationUrl: url.toString() };
  }

  async completeLinkedInAuthorization(input: {
    state?: string;
    code?: string;
    error?: string;
    errorDescription?: string;
  }) {
    if (!input.state || !input.code || input.error) {
      throw new NativePublisherV2Error(
        "LINKEDIN_OAUTH_FAILED",
        400,
        input.errorDescription || input.error || "A autorização do LinkedIn não foi concluída.",
      );
    }
    const context = await this.consumeState(input.state, "linkedin");
    const tokenResponse = await fetch("https://www.linkedin.com/oauth/v2/accessToken", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code: input.code,
        redirect_uri: this.options.linkedinRedirectUri!,
        client_id: this.options.linkedinClientId!,
        client_secret: this.options.linkedinClientSecret!,
      }),
      signal: AbortSignal.timeout(20_000),
    });
    const token = (await tokenResponse.json().catch(() => ({}))) as Json;
    const accessToken = text(token.access_token);
    if (!tokenResponse.ok || !accessToken) {
      throw new NativePublisherV2Error(
        "LINKEDIN_TOKEN_FAILED",
        502,
        text(token.error_description) || "LinkedIn não retornou o token esperado.",
      );
    }

    const profileResponse = await fetch("https://api.linkedin.com/v2/userinfo", {
      headers: { authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(20_000),
    });
    const profile = (await profileResponse.json().catch(() => ({}))) as Json;
    const subject = text(profile.sub);
    if (!profileResponse.ok || !subject) {
      throw new NativePublisherV2Error(
        "LINKEDIN_PROFILE_FAILED",
        502,
        "Não foi possível identificar o perfil autorizado do LinkedIn.",
      );
    }

    const expiresIn = Number(token.expires_in || 5_184_000);
    const scopes = text(token.scope)
      ? text(token.scope).split(/\s+/).filter(Boolean)
      : this.linkedinScopes;
    return this.upsertConnection({
      organizationId: context.organizationId,
      brandId: context.brandId,
      provider: "linkedin",
      providerAccountId: `urn:li:person:${subject}`,
      displayName: text(profile.name) || "Perfil LinkedIn",
      username: null,
      profilePictureUrl: text(profile.picture) || null,
      encryptedAccessToken: this.encrypt(accessToken, this.options.linkedinEncryptionSecret),
      tokenExpiresAt: new Date(Date.now() + (Number.isFinite(expiresIn) ? expiresIn : 5_184_000) * 1000),
      scopes,
      metadata: { source: "publisher_v2_linkedin_oidc", authorType: "member" },
    });
  }
}
