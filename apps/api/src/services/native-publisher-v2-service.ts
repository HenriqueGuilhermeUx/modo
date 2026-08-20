import type { ContentRequest } from "@modo/contracts/content";
import type {
  NativeAnalyticsSnapshot,
  NativeBrandInsight,
  NativeCalendarItem,
  NativeConnection,
  NativePublication,
  NativePublisherProvider,
} from "@modo/contracts/native-publisher";
import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from "node:crypto";
import pg, { type Pool } from "pg";

const { Pool: PgPool } = pg;

type Json = Record<string, unknown>;

interface Options {
  databaseUrl?: string;
  databaseSsl?: boolean;
  publicWebUrl?: string;
  instagramEncryptionSecret?: string;
  instagramGraphBaseUrl?: string;
  instagramApiVersion?: string;
  facebookAppId?: string;
  facebookAppSecret?: string;
  facebookRedirectUri?: string;
  facebookApiVersion?: string;
  threadsAppId?: string;
  threadsAppSecret?: string;
  threadsRedirectUri?: string;
  threadsScopes?: string;
  linkedinEncryptionSecret?: string;
  linkedinApiVersion?: string;
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

interface PublicationRow {
  id: string;
  organization_id: string;
  brand_id: string;
  content_request_id: string;
  provider: NativePublisherProvider;
  connection_id: string;
  status: NativePublication["status"];
  scheduled_for: Date | null;
  published_at: Date | null;
  provider_post_id: string | null;
  permalink: string | null;
  attempt_count: number;
  max_attempts: number;
  next_attempt_at: Date | null;
  last_error: string | null;
  idempotency_key: string;
  quality_score: number;
  created_at: Date;
  updated_at: Date;
}

interface AnalyticsRow {
  id: string;
  publication_id: string;
  provider: NativePublisherProvider;
  metrics: Record<string, number>;
  score: number;
  learning_signal: NativeAnalyticsSnapshot["learningSignal"];
  collected_at: Date;
}

export class NativePublisherV2Error extends Error {
  constructor(public readonly code: string, public readonly statusCode: number, message: string) {
    super(message);
    this.name = "NativePublisherV2Error";
  }
}

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function metricValue(value: unknown): number {
  const number = Number(value ?? 0);
  return Number.isFinite(number) ? Math.max(0, number) : 0;
}

function mapConnection(row: ConnectionRow): NativeConnection {
  const expired = Boolean(row.token_expires_at && row.token_expires_at <= new Date());
  const scopes = row.scopes || [];
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
    scopes,
    expiresAt: row.token_expires_at?.toISOString() ?? null,
    connected: !expired,
    canPublish: !expired,
    canReadInsights: insightScopes[row.provider].length === 0 || insightScopes[row.provider].some((scope) => scopes.includes(scope)),
    metadata: row.metadata || {},
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

function mapPublication(row: PublicationRow): NativePublication {
  return {
    id: row.id,
    organizationId: row.organization_id,
    brandId: row.brand_id,
    contentRequestId: row.content_request_id,
    provider: row.provider,
    connectionId: row.connection_id,
    status: row.status,
    scheduledFor: row.scheduled_for?.toISOString() ?? null,
    publishedAt: row.published_at?.toISOString() ?? null,
    providerPostId: row.provider_post_id,
    permalink: row.permalink,
    attemptCount: Number(row.attempt_count || 0),
    maxAttempts: Number(row.max_attempts || 4),
    nextAttemptAt: row.next_attempt_at?.toISOString() ?? null,
    lastError: row.last_error,
    idempotencyKey: row.idempotency_key,
    qualityScore: Number(row.quality_score || 0),
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

function mapAnalytics(row: AnalyticsRow): NativeAnalyticsSnapshot {
  return {
    id: row.id,
    publicationId: row.publication_id,
    provider: row.provider,
    metrics: row.metrics || {},
    score: Number(row.score || 0),
    learningSignal: row.learning_signal,
    collectedAt: row.collected_at.toISOString(),
  };
}

export class NativePublisherV2Service {
  private readonly pool?: Pool;
  private scheduler?: ReturnType<typeof setInterval>;

  constructor(private readonly options: Options) {
    if (options.databaseUrl) {
      this.pool = new PgPool({
        connectionString: options.databaseUrl,
        ssl: options.databaseSsl ? { rejectUnauthorized: false } : undefined,
        max: 4,
      });
    }
  }

  get storage() {
    return this.pool ? "postgres" : "memory";
  }

  get providers() {
    return {
      instagram: Boolean(this.options.instagramEncryptionSecret),
      facebook: Boolean(this.options.facebookAppId && this.options.facebookAppSecret && this.options.facebookRedirectUri),
      threads: Boolean(this.options.threadsAppId && this.options.threadsAppSecret && this.options.threadsRedirectUri),
      linkedin: Boolean(this.options.linkedinEncryptionSecret),
    };
  }

  async initialize() {
    if (!this.pool) return;
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS modo_native_social_oauth_states (
        state TEXT PRIMARY KEY,
        organization_id TEXT NOT NULL REFERENCES modo_organizations(id) ON DELETE CASCADE,
        brand_id TEXT NOT NULL REFERENCES modo_brands(id) ON DELETE CASCADE,
        provider TEXT NOT NULL,
        expires_at TIMESTAMPTZ NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS modo_native_social_connections (
        id UUID PRIMARY KEY,
        organization_id TEXT NOT NULL REFERENCES modo_organizations(id) ON DELETE CASCADE,
        brand_id TEXT NOT NULL REFERENCES modo_brands(id) ON DELETE CASCADE,
        provider TEXT NOT NULL,
        provider_account_id TEXT NOT NULL,
        display_name TEXT NOT NULL,
        username TEXT,
        profile_picture_url TEXT,
        encrypted_access_token TEXT NOT NULL,
        token_expires_at TIMESTAMPTZ,
        scopes TEXT[] NOT NULL DEFAULT '{}',
        metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE(organization_id,brand_id,provider,provider_account_id)
      );
      CREATE INDEX IF NOT EXISTS modo_native_social_connections_brand_idx
        ON modo_native_social_connections(organization_id,brand_id,provider,updated_at DESC);

      CREATE TABLE IF NOT EXISTS modo_native_social_publications (
        id UUID PRIMARY KEY,
        organization_id TEXT NOT NULL REFERENCES modo_organizations(id) ON DELETE CASCADE,
        brand_id TEXT NOT NULL REFERENCES modo_brands(id) ON DELETE CASCADE,
        content_request_id TEXT NOT NULL REFERENCES modo_content_requests(id) ON DELETE CASCADE,
        provider TEXT NOT NULL,
        connection_id UUID NOT NULL REFERENCES modo_native_social_connections(id) ON DELETE CASCADE,
        status TEXT NOT NULL,
        scheduled_for TIMESTAMPTZ,
        published_at TIMESTAMPTZ,
        provider_post_id TEXT,
        permalink TEXT,
        attempt_count INTEGER NOT NULL DEFAULT 0,
        max_attempts INTEGER NOT NULL DEFAULT 4,
        next_attempt_at TIMESTAMPTZ,
        last_error TEXT,
        idempotency_key TEXT NOT NULL,
        quality_score INTEGER NOT NULL DEFAULT 0,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE(organization_id,idempotency_key)
      );
      CREATE INDEX IF NOT EXISTS modo_native_social_publications_due_idx
        ON modo_native_social_publications(status,scheduled_for,next_attempt_at);
      CREATE INDEX IF NOT EXISTS modo_native_social_publications_brand_idx
        ON modo_native_social_publications(organization_id,brand_id,created_at DESC);

      CREATE TABLE IF NOT EXISTS modo_native_social_analytics (
        id UUID PRIMARY KEY,
        publication_id UUID NOT NULL REFERENCES modo_native_social_publications(id) ON DELETE CASCADE,
        provider TEXT NOT NULL,
        metrics JSONB NOT NULL DEFAULT '{}'::jsonb,
        score INTEGER NOT NULL DEFAULT 0,
        learning_signal TEXT NOT NULL DEFAULT 'neutral',
        collected_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS modo_native_social_analytics_publication_idx
        ON modo_native_social_analytics(publication_id,collected_at DESC);

      DELETE FROM modo_native_social_oauth_states WHERE expires_at < NOW();
    `);

    this.scheduler = setInterval(() => {
      void this.processDue().catch(() => undefined);
      void this.refreshRecentAnalytics().catch(() => undefined);
    }, 60_000);
    this.scheduler.unref?.();
  }

  async close() {
    if (this.scheduler) clearInterval(this.scheduler);
    await this.pool?.end();
  }

  private requirePool() {
    if (!this.pool) throw new NativePublisherV2Error("PUBLISHER_STORAGE_REQUIRED", 503, "O Publisher V2 exige PostgreSQL.");
    return this.pool;
  }

  private key(secret?: string) {
    if (!secret) throw new NativePublisherV2Error("PUBLISHER_ENCRYPTION_SECRET_MISSING", 503, "Segredo de criptografia não configurado.");
    return createHash("sha256").update(secret).digest();
  }

  private encrypt(value: string, secret?: string) {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key(secret), iv);
    const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
    const tag = cipher.getAuthTag();
    return [iv, tag, encrypted].map((part) => part.toString("base64url")).join(".");
  }

  private decrypt(value: string, secret?: string) {
    const [iv, tag, encrypted] = value.split(".");
    if (!iv || !tag || !encrypted) throw new NativePublisherV2Error("PUBLISHER_TOKEN_INVALID", 500, "Token social armazenado inválido.");
    const decipher = createDecipheriv("aes-256-gcm", this.key(secret), Buffer.from(iv, "base64url"));
    decipher.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([decipher.update(Buffer.from(encrypted, "base64url")), decipher.final()]).toString("utf8");
  }

  async listConnections(organizationId: string, brandId?: string) {
    const pool = this.requirePool();
    const values: unknown[] = [organizationId];
    let filter = "organization_id=$1";
    if (brandId) {
      values.push(brandId);
      filter += ` AND brand_id=$${values.length}`;
    }
    const result = await pool.query<ConnectionRow>(
      `SELECT * FROM modo_native_social_connections WHERE ${filter} ORDER BY provider,updated_at DESC`,
      values,
    );
    return result.rows.map(mapConnection);
  }

  async importLegacyInstagram(organizationId: string, brandId: string) {
    const pool = this.requirePool();
    const result = await pool.query<any>(
      `SELECT instagram_user_id,instagram_username,profile_picture_url,access_token_encrypted,
              token_expires_at,scopes
       FROM modo_instagram_connections WHERE account_id=$1 LIMIT 1`,
      [organizationId],
    );
    const row = result.rows[0];
    if (!row) throw new NativePublisherV2Error("INSTAGRAM_NOT_CONNECTED", 409, "Conecte o Instagram antes de vinculá-lo à marca.");
    return this.upsertConnection({
      organizationId,
      brandId,
      provider: "instagram",
      providerAccountId: row.instagram_user_id,
      displayName: `@${row.instagram_username}`,
      username: row.instagram_username,
      profilePictureUrl: row.profile_picture_url,
      encryptedAccessToken: row.access_token_encrypted,
      tokenExpiresAt: row.token_expires_at,
      scopes: row.scopes || [],
      metadata: { source: "instagram_business_login" },
    });
  }

  async importLegacyLinkedIn(organizationId: string, brandId: string) {
    const pool = this.requirePool();
    const result = await pool.query<any>(
      `SELECT author_urn,display_name,encrypted_access_token,token_expires_at,scopes,author_type
       FROM modo_linkedin_connections WHERE account_id=$1 LIMIT 1`,
      [organizationId],
    );
    const row = result.rows[0];
    if (!row) throw new NativePublisherV2Error("LINKEDIN_NOT_CONNECTED", 409, "Conecte o LinkedIn antes de vinculá-lo à marca.");
    return this.upsertConnection({
      organizationId,
      brandId,
      provider: "linkedin",
      providerAccountId: row.author_urn,
      displayName: row.display_name,
      username: null,
      profilePictureUrl: null,
      encryptedAccessToken: row.encrypted_access_token,
      tokenExpiresAt: row.token_expires_at,
      scopes: row.scopes || [],
      metadata: { source: "linkedin_oauth", authorType: row.author_type },
    });
  }

  private async upsertConnection(input: {
    organizationId: string;
    brandId: string;
    provider: NativePublisherProvider;
    providerAccountId: string;
    displayName: string;
    username: string | null;
    profilePictureUrl: string | null;
    encryptedAccessToken: string;
    tokenExpiresAt: Date | null;
    scopes: string[];
    metadata?: Json;
  }) {
    const pool = this.requirePool();
    const id = randomUUID();
    const result = await pool.query<ConnectionRow>(
      `INSERT INTO modo_native_social_connections(
        id,organization_id,brand_id,provider,provider_account_id,display_name,username,
        profile_picture_url,encrypted_access_token,token_expires_at,scopes,metadata
      ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
      ON CONFLICT(organization_id,brand_id,provider,provider_account_id) DO UPDATE SET
        display_name=EXCLUDED.display_name,username=EXCLUDED.username,
        profile_picture_url=EXCLUDED.profile_picture_url,
        encrypted_access_token=EXCLUDED.encrypted_access_token,
        token_expires_at=EXCLUDED.token_expires_at,scopes=EXCLUDED.scopes,
        metadata=EXCLUDED.metadata,updated_at=NOW()
      RETURNING *`,
      [
        id,input.organizationId,input.brandId,input.provider,input.providerAccountId,input.displayName,
        input.username,input.profilePictureUrl,input.encryptedAccessToken,input.tokenExpiresAt,
        input.scopes,input.metadata || {},
      ],
    );
    return mapConnection(result.rows[0]);
  }

  private async saveOAuthState(organizationId: string, brandId: string, provider: NativePublisherProvider) {
    const pool = this.requirePool();
    const state = `${randomUUID()}${randomBytes(18).toString("hex")}`;
    await pool.query(
      `INSERT INTO modo_native_social_oauth_states(state,organization_id,brand_id,provider,expires_at)
       VALUES($1,$2,$3,$4,NOW()+INTERVAL '15 minutes')`,
      [state,organizationId,brandId,provider],
    );
    return state;
  }

  private async consumeOAuthState(state: string, provider: NativePublisherProvider) {
    const pool = this.requirePool();
    const result = await pool.query<{ organization_id: string; brand_id: string; expires_at: Date }>(
      `DELETE FROM modo_native_social_oauth_states
       WHERE state=$1 AND provider=$2 RETURNING organization_id,brand_id,expires_at`,
      [state,provider],
    );
    const row = result.rows[0];
    if (!row || row.expires_at <= new Date()) {
      throw new NativePublisherV2Error("OAUTH_STATE_INVALID", 400, "Autorização expirada ou já utilizada.");
    }
    return { organizationId: row.organization_id, brandId: row.brand_id };
  }

  async createFacebookAuthorizationUrl(organizationId: string, brandId: string) {
    if (!this.providers.facebook) throw new NativePublisherV2Error("FACEBOOK_NOT_CONFIGURED", 503, "Facebook Pages ainda não foi configurado no ambiente.");
    const state = await this.saveOAuthState(organizationId, brandId, "facebook");
    const version = this.options.facebookApiVersion || "v23.0";
    const url = new URL(`https://www.facebook.com/${version}/dialog/oauth`);
    url.searchParams.set("client_id", this.options.facebookAppId!);
    url.searchParams.set("redirect_uri", this.options.facebookRedirectUri!);
    url.searchParams.set("state", state);
    url.searchParams.set("scope", "pages_show_list,pages_read_engagement,pages_manage_posts,read_insights");
    return { authorizationUrl: url.toString() };
  }

  async completeFacebookAuthorization(input: { state?: string; code?: string; error?: string }) {
    if (!input.state || !input.code || input.error) throw new NativePublisherV2Error("FACEBOOK_OAUTH_FAILED", 400, input.error || "Autorização Facebook não concluída.");
    const context = await this.consumeOAuthState(input.state, "facebook");
    const version = this.options.facebookApiVersion || "v23.0";
    const tokenUrl = new URL(`https://graph.facebook.com/${version}/oauth/access_token`);
    tokenUrl.searchParams.set("client_id", this.options.facebookAppId!);
    tokenUrl.searchParams.set("client_secret", this.options.facebookAppSecret!);
    tokenUrl.searchParams.set("redirect_uri", this.options.facebookRedirectUri!);
    tokenUrl.searchParams.set("code", input.code);
    const tokenResponse = await fetch(tokenUrl, { signal: AbortSignal.timeout(20_000) });
    const tokenPayload = await tokenResponse.json() as any;
    if (!tokenResponse.ok || !tokenPayload.access_token) throw new NativePublisherV2Error("FACEBOOK_TOKEN_FAILED", 502, text(tokenPayload.error?.message) || "Facebook não retornou o token esperado.");

    const pagesUrl = new URL(`https://graph.facebook.com/${version}/me/accounts`);
    pagesUrl.searchParams.set("fields", "id,name,access_token,picture{url}");
    pagesUrl.searchParams.set("access_token", tokenPayload.access_token);
    const pagesResponse = await fetch(pagesUrl, { signal: AbortSignal.timeout(20_000) });
    const pagesPayload = await pagesResponse.json() as any;
    if (!pagesResponse.ok) throw new NativePublisherV2Error("FACEBOOK_PAGES_FAILED", 502, text(pagesPayload.error?.message) || "Não foi possível listar as Páginas do Facebook.");
    const pages = Array.isArray(pagesPayload.data) ? pagesPayload.data : [];
    if (!pages.length) throw new NativePublisherV2Error("FACEBOOK_PAGE_NOT_FOUND", 409, "Nenhuma Página administrável foi encontrada nesta conta.");
    const saved: NativeConnection[] = [];
    for (const page of pages) {
      if (!page.id || !page.access_token) continue;
      saved.push(await this.upsertConnection({
        organizationId: context.organizationId,
        brandId: context.brandId,
        provider: "facebook",
        providerAccountId: String(page.id),
        displayName: String(page.name || "Facebook Page"),
        username: null,
        profilePictureUrl: page.picture?.data?.url || null,
        encryptedAccessToken: this.encrypt(String(page.access_token), this.options.facebookAppSecret),
        tokenExpiresAt: null,
        scopes: ["pages_show_list","pages_read_engagement","pages_manage_posts","read_insights"],
        metadata: { source: "facebook_login" },
      }));
    }
    return saved;
  }

  get threadsScopes() {
    return (this.options.threadsScopes || "threads_basic,threads_content_publish,threads_manage_insights")
      .split(/[\s,]+/).map((item) => item.trim()).filter(Boolean);
  }

  async createThreadsAuthorizationUrl(organizationId: string, brandId: string) {
    if (!this.providers.threads) throw new NativePublisherV2Error("THREADS_NOT_CONFIGURED", 503, "Threads ainda não foi configurado no ambiente.");
    const state = await this.saveOAuthState(organizationId, brandId, "threads");
    const url = new URL("https://threads.net/oauth/authorize");
    url.searchParams.set("client_id", this.options.threadsAppId!);
    url.searchParams.set("redirect_uri", this.options.threadsRedirectUri!);
    url.searchParams.set("scope", this.threadsScopes.join(","));
    url.searchParams.set("response_type", "code");
    url.searchParams.set("state", state);
    return { authorizationUrl: url.toString() };
  }

  async completeThreadsAuthorization(input: { state?: string; code?: string; error?: string }) {
    if (!input.state || !input.code || input.error) throw new NativePublisherV2Error("THREADS_OAUTH_FAILED", 400, input.error || "Autorização Threads não concluída.");
    const context = await this.consumeOAuthState(input.state, "threads");
    const tokenUrl = new URL("https://graph.threads.net/oauth/access_token");
    tokenUrl.searchParams.set("client_id", this.options.threadsAppId!);
    tokenUrl.searchParams.set("client_secret", this.options.threadsAppSecret!);
    tokenUrl.searchParams.set("grant_type", "authorization_code");
    tokenUrl.searchParams.set("redirect_uri", this.options.threadsRedirectUri!);
    tokenUrl.searchParams.set("code", input.code);
    const shortResponse = await fetch(tokenUrl, { method: "POST", signal: AbortSignal.timeout(20_000) });
    const short = await shortResponse.json() as any;
    if (!shortResponse.ok || !short.access_token) throw new NativePublisherV2Error("THREADS_TOKEN_FAILED", 502, "Threads não retornou o token temporário.");

    const longUrl = new URL("https://graph.threads.net/access_token");
    longUrl.searchParams.set("grant_type", "th_exchange_token");
    longUrl.searchParams.set("client_secret", this.options.threadsAppSecret!);
    longUrl.searchParams.set("access_token", short.access_token);
    const longResponse = await fetch(longUrl, { headers: { authorization: `Bearer ${short.access_token}` }, signal: AbortSignal.timeout(20_000) });
    const long = await longResponse.json() as any;
    const accessToken = long.access_token || short.access_token;
    const userId = String(short.user_id || "me");

    const profileUrl = new URL("https://graph.threads.net/me");
    profileUrl.searchParams.set("fields", "id,username,threads_profile_picture_url");
    profileUrl.searchParams.set("access_token", accessToken);
    const profileResponse = await fetch(profileUrl, { signal: AbortSignal.timeout(20_000) });
    const profile = await profileResponse.json() as any;
    if (!profileResponse.ok) throw new NativePublisherV2Error("THREADS_PROFILE_FAILED", 502, "Não foi possível identificar o perfil Threads.");
    return this.upsertConnection({
      organizationId: context.organizationId,
      brandId: context.brandId,
      provider: "threads",
      providerAccountId: String(profile.id || userId),
      displayName: profile.username ? `@${profile.username}` : "Threads",
      username: profile.username || null,
      profilePictureUrl: profile.threads_profile_picture_url || null,
      encryptedAccessToken: this.encrypt(accessToken, this.options.threadsAppSecret),
      tokenExpiresAt: new Date(Date.now() + Number(long.expires_in || 5_184_000) * 1000),
      scopes: this.threadsScopes,
      metadata: { source: "threads_oauth" },
    });
  }

  async createPublication(input: {
    organizationId: string;
    brandId: string;
    content: ContentRequest;
    provider: NativePublisherProvider;
    mode: "now" | "schedule" | "draft";
    scheduledFor?: string;
    idempotencyKey?: string;
    qualityScore: number;
    imageUrl?: string | null;
  }) {
    const pool = this.requirePool();
    const connection = await this.primaryConnection(input.organizationId, input.brandId, input.provider);
    if (!connection) throw new NativePublisherV2Error("SOCIAL_CONNECTION_NOT_FOUND", 409, `Conecte ${input.provider} para esta marca antes de publicar.`);
    const scheduledFor = input.mode === "schedule" ? new Date(input.scheduledFor || "") : null;
    if (input.mode === "schedule" && (!scheduledFor || Number.isNaN(scheduledFor.getTime()) || scheduledFor <= new Date())) {
      throw new NativePublisherV2Error("INVALID_SCHEDULE", 400, "Informe uma data futura válida para o agendamento.");
    }
    const idempotencyKey = input.idempotencyKey || `${input.content.id}:${input.provider}:${input.mode}:${scheduledFor?.toISOString() || "now"}`;
    const id = randomUUID();
    const status = input.mode === "draft" ? "draft" : input.mode === "schedule" ? "scheduled" : "publishing";
    const result = await pool.query<PublicationRow>(
      `INSERT INTO modo_native_social_publications(
        id,organization_id,brand_id,content_request_id,provider,connection_id,status,scheduled_for,
        idempotency_key,quality_score
      ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
      ON CONFLICT(organization_id,idempotency_key) DO UPDATE SET updated_at=NOW()
      RETURNING *`,
      [id,input.organizationId,input.brandId,input.content.id,input.provider,connection.id,status,scheduledFor,idempotencyKey,input.qualityScore],
    );
    let publication = mapPublication(result.rows[0]);
    if (input.mode === "now" && publication.status !== "published") {
      publication = await this.publish(publication, input.content, input.imageUrl || null);
    }
    return publication;
  }

  async listPublications(organizationId: string, brandId?: string) {
    const pool = this.requirePool();
    const values: unknown[] = [organizationId];
    let filter = "organization_id=$1";
    if (brandId) { values.push(brandId); filter += ` AND brand_id=$${values.length}`; }
    const result = await pool.query<PublicationRow>(`SELECT * FROM modo_native_social_publications WHERE ${filter} ORDER BY created_at DESC LIMIT 200`, values);
    return result.rows.map(mapPublication);
  }

  async calendar(organizationId: string, brandId: string, from: Date, to: Date): Promise<NativeCalendarItem[]> {
    const pool = this.requirePool();
    const result = await pool.query<any>(
      `SELECT p.*,c.output FROM modo_native_social_publications p
       JOIN modo_content_requests c ON c.id=p.content_request_id
       WHERE p.organization_id=$1 AND p.brand_id=$2
         AND COALESCE(p.scheduled_for,p.published_at,p.created_at) BETWEEN $3 AND $4
       ORDER BY COALESCE(p.scheduled_for,p.published_at,p.created_at) ASC`,
      [organizationId,brandId,from,to],
    );
    return result.rows.map((row: any) => ({
      publicationId: row.id,
      contentRequestId: row.content_request_id,
      provider: row.provider,
      status: row.status,
      scheduledFor: row.scheduled_for?.toISOString() ?? null,
      publishedAt: row.published_at?.toISOString() ?? null,
      title: text(row.output?.title) || text(row.output?.hook) || "Conteúdo MODO",
    }));
  }

  async cancelPublication(organizationId: string, publicationId: string) {
    const pool = this.requirePool();
    const result = await pool.query<PublicationRow>(
      `UPDATE modo_native_social_publications SET status='cancelled',next_attempt_at=NULL,updated_at=NOW()
       WHERE id=$1 AND organization_id=$2 AND status IN ('draft','scheduled','retrying','failed') RETURNING *`,
      [publicationId,organizationId],
    );
    if (!result.rows[0]) throw new NativePublisherV2Error("PUBLICATION_NOT_CANCELLABLE", 409, "Esta publicação não pode mais ser cancelada.");
    return mapPublication(result.rows[0]);
  }

  async retryPublication(organizationId: string, publicationId: string) {
    const pool = this.requirePool();
    const result = await pool.query<PublicationRow>(
      `UPDATE modo_native_social_publications SET status='retrying',next_attempt_at=NOW(),last_error=NULL,updated_at=NOW()
       WHERE id=$1 AND organization_id=$2 AND status='failed' RETURNING *`,
      [publicationId,organizationId],
    );
    if (!result.rows[0]) throw new NativePublisherV2Error("PUBLICATION_NOT_RETRYABLE", 409, "Somente publicações com falha podem ser reenviadas.");
    return mapPublication(result.rows[0]);
  }

  async refreshAnalytics(organizationId: string, publicationId: string) {
    const pool = this.requirePool();
    const publicationResult = await pool.query<PublicationRow>(
      `SELECT * FROM modo_native_social_publications WHERE id=$1 AND organization_id=$2 LIMIT 1`,
      [publicationId,organizationId],
    );
    const publication = publicationResult.rows[0] ? mapPublication(publicationResult.rows[0]) : null;
    if (!publication || publication.status !== "published" || !publication.providerPostId) throw new NativePublisherV2Error("PUBLICATION_NOT_PUBLISHED", 409, "A publicação ainda não possui métricas disponíveis.");
    const connection = await this.connectionById(publication.connectionId);
    if (!connection) throw new NativePublisherV2Error("SOCIAL_CONNECTION_NOT_FOUND", 409, "Conexão social não encontrada.");
    const metrics = await this.fetchMetrics(publication, connection);
    const score = this.performanceScore(metrics);
    const signal: NativeAnalyticsSnapshot["learningSignal"] = score >= 70 ? "performed_well" : score <= 35 ? "performed_poorly" : "neutral";
    const id = randomUUID();
    const saved = await pool.query<AnalyticsRow>(
      `INSERT INTO modo_native_social_analytics(id,publication_id,provider,metrics,score,learning_signal)
       VALUES($1,$2,$3,$4,$5,$6) RETURNING *`,
      [id,publication.id,publication.provider,metrics,score,signal],
    );
    return mapAnalytics(saved.rows[0]);
  }

  async analyticsForPublication(organizationId: string, publicationId: string) {
    const pool = this.requirePool();
    const allowed = await pool.query(`SELECT 1 FROM modo_native_social_publications WHERE id=$1 AND organization_id=$2`, [publicationId,organizationId]);
    if (!allowed.rowCount) throw new NativePublisherV2Error("PUBLICATION_NOT_FOUND", 404, "Publicação não encontrada.");
    const result = await pool.query<AnalyticsRow>(`SELECT * FROM modo_native_social_analytics WHERE publication_id=$1 ORDER BY collected_at DESC LIMIT 100`, [publicationId]);
    return result.rows.map(mapAnalytics);
  }

  async brandInsight(organizationId: string, brandId: string, periodDays = 30): Promise<NativeBrandInsight> {
    const pool = this.requirePool();
    const publication = await pool.query<any>(
      `SELECT
        COUNT(*) FILTER(WHERE status='published')::int AS published_count,
        COUNT(*) FILTER(WHERE status='scheduled')::int AS scheduled_count,
        COUNT(*) FILTER(WHERE status='failed')::int AS failed_count,
        COALESCE(AVG(quality_score),0)::float AS quality_score
       FROM modo_native_social_publications
       WHERE organization_id=$1 AND brand_id=$2 AND created_at >= NOW()-($3::text||' days')::interval`,
      [organizationId,brandId,periodDays],
    );
    const analytics = await pool.query<any>(
      `SELECT p.provider,a.publication_id,a.score,a.metrics
       FROM modo_native_social_analytics a
       JOIN modo_native_social_publications p ON p.id=a.publication_id
       WHERE p.organization_id=$1 AND p.brand_id=$2 AND a.collected_at >= NOW()-($3::text||' days')::interval
       ORDER BY a.collected_at DESC`,
      [organizationId,brandId,periodDays],
    );
    const latestByPublication = new Map<string, any>();
    for (const row of analytics.rows) if (!latestByPublication.has(row.publication_id)) latestByPublication.set(row.publication_id,row);
    const snapshots = [...latestByPublication.values()];
    const avgPerformance = snapshots.length ? snapshots.reduce((sum,row)=>sum+Number(row.score||0),0)/snapshots.length : 0;
    const providerCounts = new Map<NativePublisherProvider, number>();
    for (const row of snapshots) providerCounts.set(row.provider,(providerCounts.get(row.provider)||0)+1);
    const topProvider = [...providerCounts.entries()].sort((a,b)=>b[1]-a[1])[0]?.[0] ?? null;
    const top = snapshots.sort((a,b)=>Number(b.score)-Number(a.score))[0] || null;
    const stats = publication.rows[0] || {};
    let recommendation = "Publique conteúdo aprovado com consistência para a MODO formar uma base de aprendizado.";
    if (Number(stats.failed_count) > 0) recommendation = "Há falhas de distribuição recentes. Corrija as conexões antes de aumentar a cadência.";
    else if (avgPerformance >= 70) recommendation = "A performance está forte. Replique os temas e formatos vencedores sem copiar literalmente as peças.";
    else if (snapshots.length >= 3 && avgPerformance < 40) recommendation = "A performance está abaixo do esperado. Revise gancho, CTA e adequação de canal antes da próxima sequência.";
    return {
      brandId,
      periodDays,
      publishedCount: Number(stats.published_count || 0),
      scheduledCount: Number(stats.scheduled_count || 0),
      failedCount: Number(stats.failed_count || 0),
      averageQualityScore: Math.round(Number(stats.quality_score || 0)),
      averagePerformanceScore: Math.round(avgPerformance),
      topProvider,
      topPublicationId: top?.publication_id || null,
      recommendation,
      generatedAt: new Date().toISOString(),
    };
  }

  private async primaryConnection(organizationId: string, brandId: string, provider: NativePublisherProvider) {
    const pool = this.requirePool();
    const result = await pool.query<ConnectionRow>(
      `SELECT * FROM modo_native_social_connections
       WHERE organization_id=$1 AND brand_id=$2 AND provider=$3
         AND (token_expires_at IS NULL OR token_expires_at>NOW())
       ORDER BY updated_at DESC LIMIT 1`,
      [organizationId,brandId,provider],
    );
    return result.rows[0] || null;
  }

  private async connectionById(id: string) {
    const pool = this.requirePool();
    const result = await pool.query<ConnectionRow>(`SELECT * FROM modo_native_social_connections WHERE id=$1 LIMIT 1`, [id]);
    return result.rows[0] || null;
  }

  private secretFor(provider: NativePublisherProvider) {
    if (provider === "instagram") return this.options.instagramEncryptionSecret;
    if (provider === "facebook") return this.options.facebookAppSecret;
    if (provider === "threads") return this.options.threadsAppSecret;
    return this.options.linkedinEncryptionSecret;
  }

  private async publish(publication: NativePublication, content: ContentRequest, imageUrl: string | null) {
    const connection = await this.connectionById(publication.connectionId);
    if (!connection) throw new NativePublisherV2Error("SOCIAL_CONNECTION_NOT_FOUND", 409, "Conexão social não encontrada.");
    try {
      const token = this.decrypt(connection.encrypted_access_token, this.secretFor(connection.provider));
      const caption = this.caption(content);
      let result: { postId: string; permalink: string | null };
      if (publication.provider === "instagram") result = await this.publishInstagram(connection, token, caption, imageUrl);
      else if (publication.provider === "facebook") result = await this.publishFacebook(connection, token, caption, imageUrl);
      else if (publication.provider === "threads") result = await this.publishThreads(connection, token, caption, imageUrl);
      else result = await this.publishLinkedIn(connection, token, caption);
      const pool = this.requirePool();
      const updated = await pool.query<PublicationRow>(
        `UPDATE modo_native_social_publications SET status='published',published_at=NOW(),provider_post_id=$2,
         permalink=$3,last_error=NULL,next_attempt_at=NULL,attempt_count=attempt_count+1,updated_at=NOW()
         WHERE id=$1 RETURNING *`,
        [publication.id,result.postId,result.permalink],
      );
      return mapPublication(updated.rows[0]);
    } catch (error) {
      const message = error instanceof Error ? error.message.slice(0,700) : "Falha de publicação no provider.";
      return this.markFailure(publication.id, message);
    }
  }

  private caption(content: ContentRequest) {
    const output = content.output;
    if (!output) return content.brief.slice(0,2200);
    const parts = [output.hook,output.caption,output.cta,(output.hashtags || []).join(" ")]
      .map((part)=>text(part)).filter(Boolean);
    return [...new Set(parts)].join("\n\n").slice(0,4500);
  }

  private async publishInstagram(connection: ConnectionRow, token: string, caption: string, imageUrl: string | null) {
    if (!imageUrl) throw new NativePublisherV2Error("INSTAGRAM_MEDIA_REQUIRED", 409, "Instagram exige imagem pronta neste fluxo.");
    const base = (this.options.instagramGraphBaseUrl || "https://graph.instagram.com").replace(/\/$/,"");
    const version = (this.options.instagramApiVersion || "v21.0").replace(/^([^v])/,"v$1");
    const media = await this.formPost(`${base}/${version}/${encodeURIComponent(connection.provider_account_id)}/media`, { image_url:imageUrl, caption, access_token:token });
    const creationId = text(media.id);
    if (!creationId) throw new Error("Instagram não retornou creation_id.");
    const published = await this.formPost(`${base}/${version}/${encodeURIComponent(connection.provider_account_id)}/media_publish`, { creation_id:creationId, access_token:token });
    const postId = text(published.id);
    if (!postId) throw new Error("Instagram não retornou post_id.");
    const infoUrl = new URL(`${base}/${version}/${encodeURIComponent(postId)}`);
    infoUrl.searchParams.set("fields","permalink"); infoUrl.searchParams.set("access_token",token);
    const info = await fetch(infoUrl,{signal:AbortSignal.timeout(15000)}).then((r)=>r.json()).catch(()=>({})) as any;
    return { postId, permalink: text(info.permalink) || null };
  }

  private async publishFacebook(connection: ConnectionRow, token: string, caption: string, imageUrl: string | null) {
    const version = this.options.facebookApiVersion || "v23.0";
    const base = `https://graph.facebook.com/${version}/${encodeURIComponent(connection.provider_account_id)}`;
    const payload = imageUrl
      ? await this.formPost(`${base}/photos`, { url:imageUrl,caption,access_token:token,published:"true" })
      : await this.formPost(`${base}/feed`, { message:caption,access_token:token });
    const postId = text(payload.post_id) || text(payload.id);
    if (!postId) throw new Error("Facebook não retornou o ID da publicação.");
    return { postId, permalink: null };
  }

  private async publishThreads(_connection: ConnectionRow, token: string, caption: string, imageUrl: string | null) {
    const createUrl = new URL("https://graph.threads.net/me/threads");
    createUrl.searchParams.set("text",caption.slice(0,500));
    createUrl.searchParams.set("media_type",imageUrl ? "IMAGE" : "TEXT");
    if (imageUrl) createUrl.searchParams.set("image_url",imageUrl);
    createUrl.searchParams.set("access_token",token);
    const createdResponse = await fetch(createUrl,{method:"POST",signal:AbortSignal.timeout(30000)});
    const created = await createdResponse.json() as any;
    if (!createdResponse.ok || !created.id) throw new Error(text(created.error?.message) || "Threads não criou o container.");
    const publishUrl = new URL("https://graph.threads.net/me/threads_publish");
    publishUrl.searchParams.set("creation_id",String(created.id)); publishUrl.searchParams.set("access_token",token);
    const publishedResponse = await fetch(publishUrl,{method:"POST",signal:AbortSignal.timeout(30000)});
    const published = await publishedResponse.json() as any;
    const postId = text(published.id);
    if (!publishedResponse.ok || !postId) throw new Error(text(published.error?.message) || "Threads não concluiu a publicação.");
    const infoUrl = new URL(`https://graph.threads.net/${encodeURIComponent(postId)}`);
    infoUrl.searchParams.set("fields","permalink"); infoUrl.searchParams.set("access_token",token);
    const info = await fetch(infoUrl,{signal:AbortSignal.timeout(15000)}).then((r)=>r.json()).catch(()=>({})) as any;
    return { postId, permalink:text(info.permalink)||null };
  }

  private async publishLinkedIn(connection: ConnectionRow, token: string, caption: string) {
    const response = await fetch("https://api.linkedin.com/rest/posts",{
      method:"POST",
      headers:{
        authorization:`Bearer ${token}`,
        "content-type":"application/json",
        "x-restli-protocol-version":"2.0.0",
        "linkedin-version":this.options.linkedinApiVersion || "202606",
      },
      body:JSON.stringify({author:connection.provider_account_id,commentary:caption.slice(0,3000),visibility:"PUBLIC",distribution:{feedDistribution:"MAIN_FEED",targetEntities:[],thirdPartyDistributionChannels:[]},lifecycleState:"PUBLISHED",isReshareDisabledByAuthor:false}),
      signal:AbortSignal.timeout(30000),
    });
    if (!response.ok) throw new Error(`LinkedIn rejeitou a publicação (${response.status}).`);
    const postId = response.headers.get("x-restli-id") || response.headers.get("x-linkedin-id") || randomUUID();
    return { postId, permalink:null };
  }

  private async formPost(url: string, values: Record<string,string>) {
    const response = await fetch(url,{method:"POST",headers:{"content-type":"application/x-www-form-urlencoded"},body:new URLSearchParams(values),signal:AbortSignal.timeout(30000)});
    const payload = await response.json().catch(()=>({})) as any;
    if (!response.ok) throw new Error(text(payload.error?.message)||`Provider rejeitou a operação (${response.status}).`);
    return payload;
  }

  private async markFailure(publicationId: string, message: string) {
    const pool = this.requirePool();
    const current = await pool.query<PublicationRow>(`SELECT * FROM modo_native_social_publications WHERE id=$1 LIMIT 1`,[publicationId]);
    const row = current.rows[0];
    if (!row) throw new NativePublisherV2Error("PUBLICATION_NOT_FOUND",404,"Publicação não encontrada.");
    const attempts = Number(row.attempt_count||0)+1;
    const canRetry = attempts < Number(row.max_attempts||4);
    const delayMinutes = Math.min(60,2**attempts);
    const updated = await pool.query<PublicationRow>(
      `UPDATE modo_native_social_publications SET
       status=$2,attempt_count=$3,next_attempt_at=${canRetry ? `NOW()+($4::text||' minutes')::interval` : "NULL"},
       last_error=$5,updated_at=NOW() WHERE id=$1 RETURNING *`,
      canRetry ? [publicationId,"retrying",attempts,delayMinutes,message] : [publicationId,"failed",attempts,message,message],
    );
    return mapPublication(updated.rows[0]);
  }

  private async processDue() {
    if (!this.pool) return;
    const due = await this.pool.query<any>(
      `SELECT p.*,c.*,
        p.id AS publication_id,p.organization_id AS publication_org,p.brand_id AS publication_brand,
        p.content_request_id AS publication_content_id,p.provider AS publication_provider
       FROM modo_native_social_publications p
       JOIN modo_content_requests c ON c.id=p.content_request_id
       WHERE (p.status='scheduled' AND p.scheduled_for<=NOW())
          OR (p.status='retrying' AND p.next_attempt_at<=NOW())
       ORDER BY COALESCE(p.next_attempt_at,p.scheduled_for) ASC LIMIT 10`,
    );
    for (const raw of due.rows) {
      await this.pool.query(`UPDATE modo_native_social_publications SET status='publishing',updated_at=NOW() WHERE id=$1 AND status IN ('scheduled','retrying')`,[raw.publication_id]);
      const publicationResult = await this.pool.query<PublicationRow>(`SELECT * FROM modo_native_social_publications WHERE id=$1`,[raw.publication_id]);
      const publication = mapPublication(publicationResult.rows[0]);
      const content: ContentRequest = {
        id:raw.publication_content_id,organizationId:raw.organization_id,brandId:raw.brand_id,
        contentType:raw.content_type,objective:raw.objective,brief:raw.brief,channel:raw.channel,status:raw.status,
        creditsCharged:raw.credits_charged,revisionCount:raw.revision_count,maxRevisions:raw.max_revisions,
        revisionInstructions:raw.revision_instructions,output:raw.output,error:raw.error,providerRunId:raw.provider_run_id,
        approvedAt:raw.approved_at?.toISOString?.() ?? raw.approved_at ?? null,createdAt:raw.created_at.toISOString(),updatedAt:raw.updated_at.toISOString(),
      } as ContentRequest;
      const imageUrl = text(content.output?.imageUrl) || null;
      await this.publish(publication,content,imageUrl).catch(()=>undefined);
    }
  }

  private async fetchMetrics(publication: NativePublication, connection: ConnectionRow): Promise<Record<string,number>> {
    const token = this.decrypt(connection.encrypted_access_token,this.secretFor(connection.provider));
    if (publication.provider === "instagram") {
      const base=(this.options.instagramGraphBaseUrl||"https://graph.instagram.com").replace(/\/$/,"");
      const version=this.options.instagramApiVersion||"v21.0";
      const url=new URL(`${base}/${version}/${encodeURIComponent(publication.providerPostId!)}/insights`);
      url.searchParams.set("metric","views,reach,likes,comments,shares,saved"); url.searchParams.set("access_token",token);
      const response=await fetch(url,{signal:AbortSignal.timeout(20000)}); const payload=await response.json().catch(()=>({})) as any;
      if (!response.ok) return {};
      return this.insightArray(payload.data);
    }
    if (publication.provider === "threads") {
      const url=new URL(`https://graph.threads.net/${encodeURIComponent(publication.providerPostId!)}/insights`);
      url.searchParams.set("metric","views,likes,replies,reposts,quotes,shares"); url.searchParams.set("access_token",token);
      const response=await fetch(url,{signal:AbortSignal.timeout(20000)}); const payload=await response.json().catch(()=>({})) as any;
      return response.ok ? this.insightArray(payload.data) : {};
    }
    if (publication.provider === "facebook") {
      const version=this.options.facebookApiVersion||"v23.0";
      const url=new URL(`https://graph.facebook.com/${version}/${encodeURIComponent(publication.providerPostId!)}`);
      url.searchParams.set("fields","shares,likes.summary(true),comments.summary(true)"); url.searchParams.set("access_token",token);
      const response=await fetch(url,{signal:AbortSignal.timeout(20000)}); const payload=await response.json().catch(()=>({})) as any;
      if (!response.ok) return {};
      return {shares:metricValue(payload.shares?.count),likes:metricValue(payload.likes?.summary?.total_count),comments:metricValue(payload.comments?.summary?.total_count)};
    }
    const url=`https://api.linkedin.com/rest/socialActions/${encodeURIComponent(publication.providerPostId!)}`;
    const response=await fetch(url,{headers:{authorization:`Bearer ${token}`,"x-restli-protocol-version":"2.0.0","linkedin-version":this.options.linkedinApiVersion||"202606"},signal:AbortSignal.timeout(20000)});
    const payload=await response.json().catch(()=>({})) as any;
    return response.ok ? {likes:metricValue(payload.likesSummary?.totalLikes),comments:metricValue(payload.commentsSummary?.totalFirstLevelComments)} : {};
  }

  private insightArray(data: unknown) {
    const metrics: Record<string,number> = {};
    for (const item of Array.isArray(data)?data:[]) {
      const value = item?.values?.[0]?.value ?? item?.total_value?.value ?? item?.value ?? 0;
      metrics[String(item?.name||"metric")]=metricValue(value);
    }
    return metrics;
  }

  private performanceScore(metrics: Record<string,number>) {
    const views=metricValue(metrics.views||metrics.impressions||metrics.reach);
    const interactions=metricValue(metrics.likes)+metricValue(metrics.comments)*3+metricValue(metrics.shares)*4+metricValue(metrics.saved)*4+metricValue(metrics.reposts)*4+metricValue(metrics.quotes)*4+metricValue(metrics.replies)*3;
    if (!views && !interactions) return 0;
    const engagement=views>0 ? interactions/views : interactions/20;
    return Math.max(0,Math.min(100,Math.round(30*Math.min(1,Math.log10(views+1)/4)+70*Math.min(1,engagement/0.08))));
  }

  private async refreshRecentAnalytics() {
    if (!this.pool) return;
    const result=await this.pool.query<{id:string;organization_id:string}>(
      `SELECT id,organization_id FROM modo_native_social_publications
       WHERE status='published' AND published_at>=NOW()-INTERVAL '30 days'
       ORDER BY published_at DESC LIMIT 20`,
    );
    for (const row of result.rows) {
      const latest=await this.pool.query<{collected_at:Date}>(`SELECT collected_at FROM modo_native_social_analytics WHERE publication_id=$1 ORDER BY collected_at DESC LIMIT 1`,[row.id]);
      if (latest.rows[0] && Date.now()-latest.rows[0].collected_at.getTime()<6*60*60*1000) continue;
      await this.refreshAnalytics(row.organization_id,row.id).catch(()=>undefined);
    }
  }
}
