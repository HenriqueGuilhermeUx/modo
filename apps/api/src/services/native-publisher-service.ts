import type { ContentRequest } from "@modo/contracts/content";
import type { CreativeProfile } from "@modo/contracts/creative-intelligence";
import type {
  NativeAnalyticsSummary,
  NativeConnection,
  NativePublication,
  NativeScheduleRequest,
  NativeSocialPlatform,
} from "@modo/contracts/native-publisher";
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  randomUUID,
} from "node:crypto";
import pg, { type Pool } from "pg";
import type { ContentAssetService } from "./content-asset-service.js";
import type { ContentService } from "./content-service.js";
import { CreativeIntelligenceService } from "./creative-intelligence-service.js";
import { DistributionQualityService } from "./distribution-quality-service.js";

const { Pool: PgPool } = pg;
const MAX_ATTEMPTS = 4;
const WORKER_INTERVAL_MS = 30_000;
const ANALYTICS_REFRESH_MS = 6 * 60 * 60_000;

type JsonRecord = Record<string, unknown>;
type Fetcher = (input: string, init?: RequestInit) => Promise<Response>;

interface Options {
  databaseUrl?: string;
  databaseSsl?: boolean;
  content: ContentService;
  assets: ContentAssetService;
  encryptionSecret?: string;
  instagramGraphBaseUrl?: string;
  instagramApiVersion?: string;
  facebookAppId?: string;
  facebookAppSecret?: string;
  facebookRedirectUri?: string;
  facebookScopes?: string;
  facebookApiVersion?: string;
  threadsClientId?: string;
  threadsClientSecret?: string;
  threadsRedirectUri?: string;
  threadsScopes?: string;
  threadsGraphBaseUrl?: string;
  threadsApiVersion?: string;
  linkedinConfigured?: boolean;
  fetcher?: Fetcher;
  webUrl?: string;
}

interface ConnectionRow {
  id: string;
  account_id: string;
  brand_id: string | null;
  brand_key: string;
  platform: NativeSocialPlatform;
  external_account_id: string;
  display_name: string;
  picture_url: string | null;
  access_token_encrypted: string;
  token_expires_at: Date | null;
  scopes: string[];
  metadata: JsonRecord;
  connected_at: Date;
  updated_at: Date;
}

interface PublicationRow {
  id: string;
  account_id: string;
  brand_id: string;
  content_request_id: string;
  platform: NativeSocialPlatform;
  status: NativePublication["status"];
  scheduled_for: Date;
  next_attempt_at: Date;
  published_at: Date | null;
  external_post_id: string | null;
  release_url: string | null;
  attempts: number;
  last_error: string | null;
  idempotency_key: string;
  metadata: JsonRecord;
  created_at: Date;
  updated_at: Date;
}

interface OAuthStateRow {
  state: string;
  account_id: string;
  brand_id: string;
  platform: "facebook" | "threads";
  expires_at: Date;
}

interface FacebookCandidateRow {
  selection_id: string;
  account_id: string;
  brand_id: string;
  page_id: string;
  page_name: string;
  picture_url: string | null;
  access_token_encrypted: string;
  expires_at: Date;
}

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function numberValue(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function brandKey(brandId: string | null | undefined) {
  return brandId || "__organization__";
}

function apiVersion(value: string | undefined, fallback: string) {
  const normalized = text(value) || fallback;
  return normalized.startsWith("v") ? normalized : `v${normalized}`;
}

function safeUrl(value: unknown) {
  const candidate = text(value);
  if (!candidate) return null;
  try {
    const parsed = new URL(candidate);
    return ["http:", "https:"].includes(parsed.protocol) ? parsed.toString() : null;
  } catch {
    return null;
  }
}

function mapPublication(row: PublicationRow): NativePublication {
  return {
    id: row.id,
    contentRequestId: row.content_request_id,
    brandId: row.brand_id,
    platform: row.platform,
    status: row.status,
    scheduledFor: row.scheduled_for.toISOString(),
    publishedAt: row.published_at?.toISOString() ?? null,
    externalPostId: row.external_post_id,
    releaseUrl: safeUrl(row.release_url),
    attempts: Number(row.attempts || 0),
    lastError: row.last_error,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

function composeCaption(request: ContentRequest) {
  const output = request.output;
  if (!output) return "";
  const hashtags = output.hashtags
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => (item.startsWith("#") ? item : `#${item.replace(/^#+/, "")}`))
    .join(" ");
  return [output.hook, output.caption, output.cta, hashtags]
    .map((item) => item.trim())
    .filter(Boolean)
    .filter((item, index, items) => items.indexOf(item) === index)
    .join("\n\n")
    .slice(0, 5000);
}

function retryDelay(attempts: number) {
  const minutes = Math.min(60, Math.max(2, 2 ** Math.max(1, attempts)));
  return minutes * 60_000;
}

function normalizeMetrics(metrics: Array<{ key: string; value: number }>) {
  const normalized: Record<string, number> = {};
  for (const metric of metrics) {
    normalized[metric.key] = Math.max(normalized[metric.key] || 0, metric.value);
  }
  return normalized;
}

function scoreMetrics(normalized: Record<string, number>) {
  const exposure = normalized.reach || normalized.views || normalized.impressions || 0;
  const engagementPoints =
    (normalized.likes || normalized.reactions || 0) +
    (normalized.comments || normalized.replies || 0) * 2 +
    (normalized.shares || normalized.reposts || 0) * 3 +
    (normalized.saves || normalized.quotes || 0) * 3 +
    (normalized.clicks || 0) * 2;
  const engagementRate = exposure > 0 ? (engagementPoints / exposure) * 100 : null;
  const score = Math.max(
    0,
    Math.min(
      100,
      Math.round(engagementRate === null ? Math.min(100, engagementPoints) : engagementRate * 10),
    ),
  );
  return {
    score,
    engagementRate,
    learningSignal: score >= 60
      ? ("performed_well" as const)
      : score <= 25
        ? ("performed_poorly" as const)
        : ("neutral" as const),
  };
}

export class NativePublisherError extends Error {
  constructor(
    public readonly code: string,
    public readonly statusCode: number,
    message: string,
  ) {
    super(message);
    this.name = "NativePublisherError";
  }
}

export class NativePublisherService {
  private readonly pool?: Pool;
  private readonly fetcher: Fetcher;
  private readonly quality = new DistributionQualityService();
  private readonly creative: CreativeIntelligenceService;
  private worker?: ReturnType<typeof setInterval>;
  private lastAnalyticsSweep = 0;

  constructor(private readonly options: Options) {
    this.fetcher = options.fetcher ?? ((input, init) => fetch(input, init));
    if (options.databaseUrl) {
      this.pool = new PgPool({
        connectionString: options.databaseUrl,
        ssl: options.databaseSsl ? { rejectUnauthorized: false } : undefined,
        max: 4,
      });
    }
    this.creative = new CreativeIntelligenceService({
      databaseUrl: options.databaseUrl,
      databaseSsl: options.databaseSsl,
    });
  }

  get storage(): "postgres" | "memory" {
    return this.pool ? "postgres" : "memory";
  }

  get facebookConfigured() {
    return Boolean(
      this.options.facebookAppId &&
      this.options.facebookAppSecret &&
      this.options.facebookRedirectUri &&
      this.options.encryptionSecret,
    );
  }

  get threadsConfigured() {
    return Boolean(
      this.options.threadsClientId &&
      this.options.threadsClientSecret &&
      this.options.threadsRedirectUri &&
      this.options.encryptionSecret,
    );
  }

  async initialize() {
    await this.creative.initialize();
    if (!this.pool) return;
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS modo_native_social_connections (
        id TEXT PRIMARY KEY,
        account_id TEXT NOT NULL REFERENCES modo_organizations(id) ON DELETE CASCADE,
        brand_id TEXT REFERENCES modo_brands(id) ON DELETE CASCADE,
        brand_key TEXT NOT NULL,
        platform TEXT NOT NULL,
        external_account_id TEXT NOT NULL,
        display_name TEXT NOT NULL,
        picture_url TEXT,
        access_token_encrypted TEXT NOT NULL,
        token_expires_at TIMESTAMPTZ,
        scopes TEXT[] NOT NULL DEFAULT '{}',
        metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
        connected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE(account_id,platform,brand_key),
        UNIQUE(platform,external_account_id)
      );
      CREATE INDEX IF NOT EXISTS modo_native_social_connections_account_idx
        ON modo_native_social_connections(account_id,brand_id,platform);

      CREATE TABLE IF NOT EXISTS modo_native_social_oauth_states (
        state TEXT PRIMARY KEY,
        account_id TEXT NOT NULL REFERENCES modo_organizations(id) ON DELETE CASCADE,
        brand_id TEXT NOT NULL REFERENCES modo_brands(id) ON DELETE CASCADE,
        platform TEXT NOT NULL,
        expires_at TIMESTAMPTZ NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS modo_native_facebook_page_candidates (
        selection_id TEXT NOT NULL,
        account_id TEXT NOT NULL REFERENCES modo_organizations(id) ON DELETE CASCADE,
        brand_id TEXT NOT NULL REFERENCES modo_brands(id) ON DELETE CASCADE,
        page_id TEXT NOT NULL,
        page_name TEXT NOT NULL,
        picture_url TEXT,
        access_token_encrypted TEXT NOT NULL,
        expires_at TIMESTAMPTZ NOT NULL,
        PRIMARY KEY(selection_id,page_id)
      );

      CREATE TABLE IF NOT EXISTS modo_native_publications (
        id TEXT PRIMARY KEY,
        account_id TEXT NOT NULL REFERENCES modo_organizations(id) ON DELETE CASCADE,
        brand_id TEXT NOT NULL REFERENCES modo_brands(id) ON DELETE CASCADE,
        content_request_id TEXT NOT NULL REFERENCES modo_content_requests(id) ON DELETE CASCADE,
        platform TEXT NOT NULL,
        status TEXT NOT NULL,
        scheduled_for TIMESTAMPTZ NOT NULL,
        next_attempt_at TIMESTAMPTZ NOT NULL,
        published_at TIMESTAMPTZ,
        external_post_id TEXT,
        release_url TEXT,
        attempts INTEGER NOT NULL DEFAULT 0,
        last_error TEXT,
        idempotency_key TEXT NOT NULL,
        metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE(account_id,idempotency_key)
      );
      CREATE INDEX IF NOT EXISTS modo_native_publications_due_idx
        ON modo_native_publications(status,next_attempt_at,scheduled_for);
      CREATE INDEX IF NOT EXISTS modo_native_publications_brand_idx
        ON modo_native_publications(account_id,brand_id,scheduled_for DESC);

      CREATE TABLE IF NOT EXISTS modo_native_analytics_snapshots (
        id TEXT PRIMARY KEY,
        account_id TEXT NOT NULL REFERENCES modo_organizations(id) ON DELETE CASCADE,
        brand_id TEXT NOT NULL REFERENCES modo_brands(id) ON DELETE CASCADE,
        publication_id TEXT NOT NULL REFERENCES modo_native_publications(id) ON DELETE CASCADE,
        platform TEXT NOT NULL,
        score NUMERIC NOT NULL,
        engagement_rate NUMERIC,
        learning_signal TEXT NOT NULL,
        metrics JSONB NOT NULL DEFAULT '[]'::jsonb,
        normalized JSONB NOT NULL DEFAULT '{}'::jsonb,
        collected_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS modo_native_analytics_recent_idx
        ON modo_native_analytics_snapshots(publication_id,collected_at DESC);

      DELETE FROM modo_native_social_oauth_states WHERE expires_at < NOW();
      DELETE FROM modo_native_facebook_page_candidates WHERE expires_at < NOW();
    `);

    await this.installInstagramArchiveBridge();

    this.worker = setInterval(() => {
      void this.tick().catch(() => undefined);
    }, WORKER_INTERVAL_MS);
    this.worker.unref?.();
  }

  async close() {
    if (this.worker) clearInterval(this.worker);
    await Promise.all([this.pool?.end(), this.creative.close()]);
  }

  async listConnections(accountId: string, brandId?: string): Promise<NativeConnection[]> {
    const rows = await this.readConnections(accountId, brandId);
    const byPlatform = new Map(rows.map((row) => [row.platform, row]));
    const now = new Date();
    const platforms: NativeSocialPlatform[] = ["instagram", "facebook", "threads", "linkedin"];
    return Promise.all(platforms.map(async (platform) => {
      if (platform === "linkedin") return this.linkedinConnection(accountId, brandId);
      const row = byPlatform.get(platform);
      const configured = platform === "instagram"
        ? Boolean(this.options.encryptionSecret)
        : platform === "facebook"
          ? this.facebookConfigured
          : this.threadsConfigured;
      if (!row) {
        return {
          platform,
          brandId: brandId || null,
          externalAccountId: null,
          displayName: null,
          pictureUrl: null,
          connected: false,
          configured,
          canPublish: false,
          expiresAt: null,
          scopes: [],
          message: configured
            ? `Conecte ${platform === "facebook" ? "uma Página do Facebook" : platform === "threads" ? "o Threads" : "o Instagram"} desta marca.`
            : `O conector ${platform} ainda aguarda configuração do aplicativo.`,
        } satisfies NativeConnection;
      }
      const expired = Boolean(row.token_expires_at && row.token_expires_at <= now);
      return {
        platform,
        brandId: row.brand_id,
        externalAccountId: row.external_account_id,
        displayName: row.display_name,
        pictureUrl: safeUrl(row.picture_url),
        connected: !expired,
        configured,
        canPublish: configured && !expired,
        expiresAt: row.token_expires_at?.toISOString() ?? null,
        scopes: row.scopes || [],
        message: expired
          ? `A autorização de ${row.display_name} expirou. Reconecte o canal.`
          : `${row.display_name} conectado à marca.`,
      } satisfies NativeConnection;
    }));
  }

  async createMetaAuthorizationUrl(
    accountId: string,
    brandId: string,
    platform: "facebook" | "threads",
  ) {
    if (platform === "facebook" && !this.facebookConfigured) {
      throw new NativePublisherError("FACEBOOK_NOT_CONFIGURED", 503, "Configure o aplicativo Meta/Facebook antes de conectar Páginas.");
    }
    if (platform === "threads" && !this.threadsConfigured) {
      throw new NativePublisherError("THREADS_NOT_CONFIGURED", 503, "Configure o aplicativo Threads antes de conectar a conta.");
    }
    const state = randomBytes(32).toString("base64url");
    await this.saveOAuthState({ accountId, brandId, platform, state });
    if (platform === "facebook") {
      const url = new URL(`https://www.facebook.com/${apiVersion(this.options.facebookApiVersion, "v21.0")}/dialog/oauth`);
      url.searchParams.set("client_id", this.options.facebookAppId!);
      url.searchParams.set("redirect_uri", this.options.facebookRedirectUri!);
      url.searchParams.set("response_type", "code");
      url.searchParams.set("state", state);
      url.searchParams.set("scope", this.facebookScopes.join(","));
      return { authorizationUrl: url.toString() };
    }
    const url = new URL("https://threads.net/oauth/authorize");
    url.searchParams.set("client_id", this.options.threadsClientId!);
    url.searchParams.set("redirect_uri", this.options.threadsRedirectUri!);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("state", state);
    url.searchParams.set("scope", this.threadsScopes.join(","));
    return { authorizationUrl: url.toString() };
  }

  async completeThreadsAuthorization(input: { state?: string; code?: string; error?: string }) {
    const state = await this.consumeOAuthState(input.state, "threads");
    if (input.error || !input.code) {
      return this.integrationRedirect("threads", "error", state.brand_id, input.error || "Autorização cancelada.");
    }
    const tokenResponse = await this.fetcher("https://graph.threads.net/oauth/access_token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: this.options.threadsClientId!,
        client_secret: this.options.threadsClientSecret!,
        grant_type: "authorization_code",
        redirect_uri: this.options.threadsRedirectUri!,
        code: input.code.replace(/#_$/, ""),
      }),
      signal: AbortSignal.timeout(20_000),
    });
    const shortToken = await tokenResponse.json().catch(() => ({})) as JsonRecord;
    if (!tokenResponse.ok || !text(shortToken.access_token)) {
      throw new NativePublisherError("THREADS_TOKEN_FAILED", 422, text(shortToken.error_message) || "O Threads não retornou o token esperado.");
    }

    let accessToken = text(shortToken.access_token);
    let expiresIn = numberValue(shortToken.expires_in) || 3600;
    const longUrl = new URL("https://graph.threads.net/access_token");
    longUrl.searchParams.set("grant_type", "th_exchange_token");
    longUrl.searchParams.set("client_secret", this.options.threadsClientSecret!);
    longUrl.searchParams.set("access_token", accessToken);
    const longResponse = await this.fetcher(longUrl.toString(), { signal: AbortSignal.timeout(20_000) });
    const longPayload = await longResponse.json().catch(() => ({})) as JsonRecord;
    if (longResponse.ok && text(longPayload.access_token)) {
      accessToken = text(longPayload.access_token);
      expiresIn = numberValue(longPayload.expires_in) || 60 * 24 * 60 * 60;
    }

    const identityUrl = new URL(`${this.threadsGraphBase}/${this.threadsVersion}/me`);
    identityUrl.searchParams.set("fields", "id,username,threads_profile_picture_url");
    identityUrl.searchParams.set("access_token", accessToken);
    const identityResponse = await this.fetcher(identityUrl.toString(), { signal: AbortSignal.timeout(20_000) });
    const identity = await identityResponse.json().catch(() => ({})) as JsonRecord;
    if (!identityResponse.ok || !text(identity.id)) {
      throw new NativePublisherError("THREADS_IDENTITY_FAILED", 422, "Não foi possível identificar a conta do Threads.");
    }
    await this.upsertConnection({
      accountId: state.account_id,
      brandId: state.brand_id,
      platform: "threads",
      externalAccountId: text(identity.id),
      displayName: text(identity.username) ? `@${text(identity.username)}` : "Threads",
      pictureUrl: safeUrl(identity.threads_profile_picture_url),
      accessToken,
      tokenExpiresAt: new Date(Date.now() + expiresIn * 1000),
      scopes: this.threadsScopes,
      metadata: {},
    });
    return this.integrationRedirect("threads", "connected", state.brand_id);
  }

  async completeFacebookAuthorization(input: { state?: string; code?: string; error?: string }) {
    const state = await this.consumeOAuthState(input.state, "facebook");
    if (input.error || !input.code) {
      return this.integrationRedirect("facebook", "error", state.brand_id, input.error || "Autorização cancelada.");
    }
    const tokenUrl = new URL(`https://graph.facebook.com/${apiVersion(this.options.facebookApiVersion, "v21.0")}/oauth/access_token`);
    tokenUrl.searchParams.set("client_id", this.options.facebookAppId!);
    tokenUrl.searchParams.set("client_secret", this.options.facebookAppSecret!);
    tokenUrl.searchParams.set("redirect_uri", this.options.facebookRedirectUri!);
    tokenUrl.searchParams.set("code", input.code);
    const tokenResponse = await this.fetcher(tokenUrl.toString(), { signal: AbortSignal.timeout(20_000) });
    const tokenPayload = await tokenResponse.json().catch(() => ({})) as JsonRecord;
    const userToken = text(tokenPayload.access_token);
    if (!tokenResponse.ok || !userToken) {
      throw new NativePublisherError("FACEBOOK_TOKEN_FAILED", 422, "A Meta não retornou o token de acesso esperado.");
    }

    const pagesUrl = new URL(`https://graph.facebook.com/${apiVersion(this.options.facebookApiVersion, "v21.0")}/me/accounts`);
    pagesUrl.searchParams.set("fields", "id,name,access_token,picture{url}");
    pagesUrl.searchParams.set("limit", "100");
    pagesUrl.searchParams.set("access_token", userToken);
    const pagesResponse = await this.fetcher(pagesUrl.toString(), { signal: AbortSignal.timeout(20_000) });
    const pagesPayload = await pagesResponse.json().catch(() => ({})) as JsonRecord;
    const pages = Array.isArray(pagesPayload.data) ? pagesPayload.data as JsonRecord[] : [];
    const valid = pages.filter((page) => text(page.id) && text(page.access_token));
    if (!pagesResponse.ok || !valid.length) {
      throw new NativePublisherError("FACEBOOK_PAGES_MISSING", 409, "Nenhuma Página administrada foi disponibilizada pela Meta para esta conta.");
    }

    if (valid.length === 1) {
      const page = valid[0];
      const picture = page.picture && typeof page.picture === "object"
        ? safeUrl(((page.picture as JsonRecord).data as JsonRecord | undefined)?.url)
        : null;
      await this.upsertConnection({
        accountId: state.account_id,
        brandId: state.brand_id,
        platform: "facebook",
        externalAccountId: text(page.id),
        displayName: text(page.name) || "Página do Facebook",
        pictureUrl: picture,
        accessToken: text(page.access_token),
        tokenExpiresAt: null,
        scopes: this.facebookScopes,
        metadata: {},
      });
      return this.integrationRedirect("facebook", "connected", state.brand_id);
    }

    const selectionId = randomUUID();
    await this.saveFacebookCandidates(selectionId, state.account_id, state.brand_id, valid);
    return this.integrationRedirect("facebook", "select", state.brand_id, undefined, selectionId);
  }

  async listFacebookCandidates(accountId: string, selectionId: string) {
    if (!this.pool) return [];
    const result = await this.pool.query<FacebookCandidateRow>(
      `SELECT * FROM modo_native_facebook_page_candidates
       WHERE account_id=$1 AND selection_id=$2 AND expires_at>NOW()
       ORDER BY page_name`,
      [accountId, selectionId],
    );
    return result.rows.map((row) => ({
      id: row.page_id,
      name: row.page_name,
      pictureUrl: safeUrl(row.picture_url),
    }));
  }

  async selectFacebookPage(accountId: string, selectionId: string, pageId: string) {
    if (!this.pool) throw new NativePublisherError("DATABASE_REQUIRED", 503, "A seleção de Página exige armazenamento persistente.");
    const result = await this.pool.query<FacebookCandidateRow>(
      `DELETE FROM modo_native_facebook_page_candidates
       WHERE account_id=$1 AND selection_id=$2
       RETURNING *`,
      [accountId, selectionId],
    );
    const selected = result.rows.find((row) => row.page_id === pageId);
    if (!selected) throw new NativePublisherError("FACEBOOK_PAGE_NOT_FOUND", 404, "A Página escolhida não pertence a esta autorização.");
    await this.upsertConnectionEncrypted({
      accountId,
      brandId: selected.brand_id,
      platform: "facebook",
      externalAccountId: selected.page_id,
      displayName: selected.page_name,
      pictureUrl: selected.picture_url,
      encryptedToken: selected.access_token_encrypted,
      tokenExpiresAt: null,
      scopes: this.facebookScopes,
      metadata: {},
    });
    return { connected: true, brandId: selected.brand_id, pageId: selected.page_id, name: selected.page_name };
  }

  async disconnect(accountId: string, brandId: string, platform: NativeSocialPlatform) {
    if (platform === "linkedin") {
      if (this.pool) await this.pool.query("DELETE FROM modo_linkedin_connections WHERE account_id=$1", [accountId]);
      return { disconnected: true };
    }
    if (!this.pool) return { disconnected: true };
    await this.pool.query(
      "DELETE FROM modo_native_social_connections WHERE account_id=$1 AND platform=$2 AND brand_key=$3",
      [accountId, platform, brandKey(brandId)],
    );
    if (platform === "instagram") {
      await this.pool.query(
        "DELETE FROM modo_instagram_connections WHERE account_id=$1 AND brand_id=$2",
        [accountId, brandId],
      );
    }
    return { disconnected: true };
  }

  async qualityReport(accountId: string, request: ContentRequest) {
    const profile = await this.creative.getProfile(accountId, request.brandId);
    return this.quality.evaluate(request, profile);
  }

  async schedule(accountId: string, input: NativeScheduleRequest) {
    const request = await this.options.content.getForOrganization(input.contentRequestId, accountId);
    if (request.status !== "approved" || !request.output) {
      throw new NativePublisherError("CONTENT_NOT_APPROVED", 409, "A peça precisa estar aprovada antes de publicar ou agendar.");
    }
    const quality = await this.qualityReport(accountId, request);
    if (!quality.publishAllowed) {
      throw new NativePublisherError("QUALITY_GATE_BLOCKED", 409, quality.blockers[0] || "O Quality Gate bloqueou esta peça.");
    }
    const scheduledFor = input.mode === "now" ? new Date() : new Date(input.scheduledFor!);
    if (!Number.isFinite(scheduledFor.getTime()) || (input.mode === "schedule" && scheduledFor.getTime() < Date.now() + 30_000)) {
      throw new NativePublisherError("INVALID_SCHEDULE", 400, "Escolha um horário futuro válido para o agendamento.");
    }
    const connection = (await this.listConnections(accountId, request.brandId)).find((item) => item.platform === input.platform);
    if (!connection?.connected || !connection.canPublish) {
      throw new NativePublisherError("CHANNEL_NOT_CONNECTED", 409, `Conecte ${input.platform} à marca antes de publicar.`);
    }
    if (!this.pool) throw new NativePublisherError("DATABASE_REQUIRED", 503, "O agendamento exige PostgreSQL.");

    const idempotencyKey = createHash("sha256")
      .update(`${request.id}:${request.brandId}:${input.platform}:${scheduledFor.toISOString()}`)
      .digest("hex");
    const id = randomUUID();
    const result = await this.pool.query<PublicationRow>(
      `INSERT INTO modo_native_publications(
        id,account_id,brand_id,content_request_id,platform,status,scheduled_for,next_attempt_at,
        idempotency_key,metadata
      ) VALUES($1,$2,$3,$4,$5,'scheduled',$6,$6,$7,$8::jsonb)
      ON CONFLICT(account_id,idempotency_key) DO UPDATE SET updated_at=NOW()
      RETURNING *`,
      [
        id,
        accountId,
        request.brandId,
        request.id,
        input.platform,
        scheduledFor,
        idempotencyKey,
        JSON.stringify({ qualityScore: quality.score, qualityStatus: quality.status }),
      ],
    );
    const publication = mapPublication(result.rows[0]);

    if (input.platform === "linkedin") {
      await this.ensureLinkedInShadow(publication, accountId);
    } else if (input.mode === "now") {
      await this.processPublication(publication.id).catch(() => undefined);
    }
    return {
      publication: input.mode === "now" ? await this.getPublication(accountId, publication.id) : publication,
      quality,
    };
  }

  async listPublications(
    accountId: string,
    filters: { brandId?: string; from?: Date; to?: Date } = {},
  ): Promise<NativePublication[]> {
    if (!this.pool) return [];
    const params: unknown[] = [accountId];
    const clauses = ["account_id=$1"];
    if (filters.brandId) {
      params.push(filters.brandId);
      clauses.push(`brand_id=$${params.length}`);
    }
    if (filters.from) {
      params.push(filters.from);
      clauses.push(`scheduled_for >= $${params.length}`);
    }
    if (filters.to) {
      params.push(filters.to);
      clauses.push(`scheduled_for <= $${params.length}`);
    }
    const result = await this.pool.query<PublicationRow>(
      `SELECT * FROM modo_native_publications
       WHERE ${clauses.join(" AND ")}
       ORDER BY scheduled_for ASC,created_at DESC
       LIMIT 500`,
      params,
    );
    return result.rows.map(mapPublication);
  }

  async getPublication(accountId: string, id: string) {
    if (!this.pool) throw new NativePublisherError("PUBLICATION_NOT_FOUND", 404, "Publicação não encontrada.");
    const result = await this.pool.query<PublicationRow>(
      "SELECT * FROM modo_native_publications WHERE account_id=$1 AND id=$2 LIMIT 1",
      [accountId, id],
    );
    if (!result.rowCount) throw new NativePublisherError("PUBLICATION_NOT_FOUND", 404, "Publicação não encontrada.");
    return mapPublication(result.rows[0]);
  }

  async cancel(accountId: string, id: string) {
    if (!this.pool) return { cancelled: false };
    const result = await this.pool.query<PublicationRow>(
      `UPDATE modo_native_publications SET status='cancelled',updated_at=NOW()
       WHERE account_id=$1 AND id=$2 AND status IN ('scheduled','retrying') RETURNING *`,
      [accountId, id],
    );
    if (!result.rowCount) throw new NativePublisherError("PUBLICATION_NOT_CANCELLABLE", 409, "Esta publicação não pode mais ser cancelada.");
    if (result.rows[0].platform === "linkedin") {
      await this.pool.query(
        `UPDATE modo_linkedin_publications SET status='failed',error='Cancelado na MODO',updated_at=NOW()
         WHERE account_id=$1 AND id=$2 AND status='scheduled'`,
        [accountId, id],
      );
    }
    return { cancelled: true, publication: mapPublication(result.rows[0]) };
  }

  async retry(accountId: string, id: string) {
    if (!this.pool) throw new NativePublisherError("PUBLICATION_NOT_FOUND", 404, "Publicação não encontrada.");
    const result = await this.pool.query<PublicationRow>(
      `UPDATE modo_native_publications
       SET status='retrying',next_attempt_at=NOW(),last_error=NULL,updated_at=NOW()
       WHERE account_id=$1 AND id=$2 AND status='failed' RETURNING *`,
      [accountId, id],
    );
    if (!result.rowCount) throw new NativePublisherError("PUBLICATION_NOT_RETRYABLE", 409, "Somente uma publicação com falha pode ser reenviada.");
    return mapPublication(result.rows[0]);
  }

  async refreshAnalytics(accountId: string, publicationId: string): Promise<NativeAnalyticsSummary> {
    const publication = await this.getPublication(accountId, publicationId);
    if (publication.status !== "published" || !publication.externalPostId) {
      throw new NativePublisherError("PUBLICATION_NOT_PUBLISHED", 409, "Analytics só ficam disponíveis depois da publicação.");
    }
    const metrics = await this.fetchAnalytics(accountId, publication);
    const normalized = normalizeMetrics(metrics);
    const score = scoreMetrics(normalized);
    const summary: NativeAnalyticsSummary = {
      publicationId: publication.id,
      platform: publication.platform,
      score: score.score,
      engagementRate: score.engagementRate,
      metrics: metrics.map((metric) => ({ key: metric.key, label: metric.label, value: metric.value })),
      normalized,
      learningSignal: score.learningSignal,
      collectedAt: new Date().toISOString(),
    };
    if (this.pool) {
      await this.pool.query(
        `INSERT INTO modo_native_analytics_snapshots(
          id,account_id,brand_id,publication_id,platform,score,engagement_rate,
          learning_signal,metrics,normalized,collected_at
        ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10::jsonb,$11)`,
        [
          randomUUID(),
          accountId,
          publication.brandId,
          publication.id,
          publication.platform,
          summary.score,
          summary.engagementRate,
          summary.learningSignal,
          JSON.stringify(summary.metrics),
          JSON.stringify(summary.normalized),
          summary.collectedAt,
        ],
      );
    }
    await this.recordPerformanceSignal(accountId, publication, summary);
    return summary;
  }

  async brandInsights(accountId: string, brandId: string) {
    if (!this.pool) return { samples: 0, averageScore: 0, bestScore: 0, signal: "insufficient_data" as const };
    const result = await this.pool.query<{ samples: number; average_score: number; best_score: number }>(
      `SELECT COUNT(*)::int samples,
              COALESCE(AVG(score),0)::float average_score,
              COALESCE(MAX(score),0)::float best_score
       FROM (
         SELECT DISTINCT ON (publication_id) publication_id,score
         FROM modo_native_analytics_snapshots
         WHERE account_id=$1 AND brand_id=$2
         ORDER BY publication_id,collected_at DESC
       ) latest`,
      [accountId, brandId],
    );
    const row = result.rows[0];
    const samples = Number(row?.samples || 0);
    const averageScore = Math.round(Number(row?.average_score || 0));
    const bestScore = Math.round(Number(row?.best_score || 0));
    return {
      samples,
      averageScore,
      bestScore,
      signal: samples < 3
        ? ("insufficient_data" as const)
        : averageScore >= 60
          ? ("strong" as const)
          : averageScore <= 25
            ? ("weak" as const)
            : ("learning" as const),
    };
  }

  private async tick() {
    await this.syncLinkedInPublications();
    await this.processDuePublications();
    if (Date.now() - this.lastAnalyticsSweep >= ANALYTICS_REFRESH_MS) {
      this.lastAnalyticsSweep = Date.now();
      await this.refreshDueAnalytics();
    }
  }

  private async processDuePublications() {
    if (!this.pool) return;
    const claimed = await this.pool.query<PublicationRow>(
      `WITH candidates AS (
         SELECT id FROM modo_native_publications
         WHERE platform <> 'linkedin'
           AND status IN ('scheduled','retrying')
           AND scheduled_for <= NOW()
           AND next_attempt_at <= NOW()
         ORDER BY next_attempt_at ASC
         LIMIT 10
         FOR UPDATE SKIP LOCKED
       )
       UPDATE modo_native_publications p
       SET status='publishing',attempts=p.attempts+1,updated_at=NOW()
       FROM candidates c
       WHERE p.id=c.id
       RETURNING p.*`,
    );
    for (const row of claimed.rows) {
      await this.executeClaimed(row).catch(() => undefined);
    }
  }

  private async processPublication(id: string) {
    if (!this.pool) return;
    const result = await this.pool.query<PublicationRow>(
      `UPDATE modo_native_publications
       SET status='publishing',attempts=attempts+1,updated_at=NOW()
       WHERE id=$1 AND status IN ('scheduled','retrying') AND scheduled_for<=NOW()
       RETURNING *`,
      [id],
    );
    if (result.rowCount) await this.executeClaimed(result.rows[0]);
  }

  private async executeClaimed(row: PublicationRow) {
    try {
      const request = await this.options.content.getForOrganization(row.content_request_id, row.account_id);
      const quality = await this.qualityReport(row.account_id, request);
      if (!quality.publishAllowed) {
        throw new NativePublisherError("QUALITY_GATE_BLOCKED", 409, quality.blockers[0] || "Quality Gate bloqueou a peça.");
      }
      const connection = await this.requireConnection(row.account_id, row.brand_id, row.platform);
      const imageUrl = request.output?.imageUrl
        ? await this.options.assets.getPublicUrlForRequest(row.account_id, request.id, request.output.imageUrl)
        : null;
      const caption = composeCaption(request);
      const result = row.platform === "instagram"
        ? await this.publishInstagram(connection, imageUrl, caption)
        : row.platform === "facebook"
          ? await this.publishFacebook(connection, imageUrl, caption)
          : await this.publishThreads(connection, imageUrl, caption);
      await this.markPublished(row, result.externalPostId, result.releaseUrl);
      await this.recordPublishedSignal(row.account_id, request, row.id, quality.score);
    } catch (error) {
      await this.markFailure(row, error);
    }
  }

  private async publishInstagram(connection: ConnectionRow, imageUrl: string | null, caption: string) {
    if (!imageUrl) throw new NativePublisherError("INSTAGRAM_MEDIA_REQUIRED", 409, "Instagram exige uma imagem pronta nesta versão do Publisher.");
    const accessToken = await this.refreshInstagramToken(connection);
    const creation = await this.graphFormPost(
      `${this.instagramGraphBase}/${this.instagramVersion}/${encodeURIComponent(connection.external_account_id)}/media`,
      { image_url: imageUrl, caption: caption.slice(0, 2200), access_token: accessToken },
    );
    const creationId = text(creation.id);
    if (!creationId) throw new NativePublisherError("INSTAGRAM_CREATION_FAILED", 502, "O Instagram não criou o contêiner da publicação.");
    await this.waitInstagramContainer(creationId, accessToken);
    const published = await this.graphFormPost(
      `${this.instagramGraphBase}/${this.instagramVersion}/${encodeURIComponent(connection.external_account_id)}/media_publish`,
      { creation_id: creationId, access_token: accessToken },
    );
    const postId = text(published.id);
    if (!postId) throw new NativePublisherError("INSTAGRAM_PUBLISH_FAILED", 502, "O Instagram não confirmou a publicação.");
    const detailUrl = new URL(`${this.instagramGraphBase}/${this.instagramVersion}/${encodeURIComponent(postId)}`);
    detailUrl.searchParams.set("fields", "id,permalink");
    detailUrl.searchParams.set("access_token", accessToken);
    const detail = await this.fetcher(detailUrl.toString(), { signal: AbortSignal.timeout(15_000) });
    const detailPayload = await detail.json().catch(() => ({})) as JsonRecord;
    return { externalPostId: postId, releaseUrl: safeUrl(detailPayload.permalink) };
  }

  private async publishFacebook(connection: ConnectionRow, imageUrl: string | null, caption: string) {
    const accessToken = this.decrypt(connection.access_token_encrypted);
    const endpoint = imageUrl
      ? `https://graph.facebook.com/${apiVersion(this.options.facebookApiVersion, "v21.0")}/${encodeURIComponent(connection.external_account_id)}/photos`
      : `https://graph.facebook.com/${apiVersion(this.options.facebookApiVersion, "v21.0")}/${encodeURIComponent(connection.external_account_id)}/feed`;
    const values: Record<string, string> = imageUrl
      ? { url: imageUrl, caption: caption.slice(0, 5000), access_token: accessToken }
      : { message: caption.slice(0, 5000), access_token: accessToken };
    const payload = await this.graphFormPost(endpoint, values);
    const postId = text(payload.post_id) || text(payload.id);
    if (!postId) throw new NativePublisherError("FACEBOOK_PUBLISH_FAILED", 502, "O Facebook não confirmou a publicação.");
    return {
      externalPostId: postId,
      releaseUrl: `https://www.facebook.com/${encodeURIComponent(postId.replace("_", "/posts/"))}`,
    };
  }

  private async publishThreads(connection: ConnectionRow, imageUrl: string | null, caption: string) {
    const accessToken = this.decrypt(connection.access_token_encrypted);
    const creation = await this.graphFormPost(
      `${this.threadsGraphBase}/${this.threadsVersion}/${encodeURIComponent(connection.external_account_id)}/threads`,
      {
        media_type: imageUrl ? "IMAGE" : "TEXT",
        text: caption.slice(0, 500),
        ...(imageUrl ? { image_url: imageUrl } : {}),
        access_token: accessToken,
      },
    );
    const creationId = text(creation.id);
    if (!creationId) throw new NativePublisherError("THREADS_CREATION_FAILED", 502, "O Threads não criou o contêiner da publicação.");
    const published = await this.graphFormPost(
      `${this.threadsGraphBase}/${this.threadsVersion}/${encodeURIComponent(connection.external_account_id)}/threads_publish`,
      { creation_id: creationId, access_token: accessToken },
    );
    const postId = text(published.id);
    if (!postId) throw new NativePublisherError("THREADS_PUBLISH_FAILED", 502, "O Threads não confirmou a publicação.");
    return { externalPostId: postId, releaseUrl: null };
  }

  private async markPublished(row: PublicationRow, externalPostId: string, releaseUrl: string | null) {
    await this.pool?.query(
      `UPDATE modo_native_publications
       SET status='published',external_post_id=$2,release_url=$3,published_at=NOW(),last_error=NULL,updated_at=NOW()
       WHERE id=$1`,
      [row.id, externalPostId, releaseUrl],
    );
  }

  private async markFailure(row: PublicationRow, error: unknown) {
    const message = error instanceof Error ? error.message.slice(0, 1000) : "Falha de publicação.";
    const attempts = Number(row.attempts || 1);
    const terminal = attempts >= MAX_ATTEMPTS || error instanceof NativePublisherError && [400, 401, 403, 404, 409, 422].includes(error.statusCode);
    await this.pool?.query(
      `UPDATE modo_native_publications
       SET status=$2,last_error=$3,next_attempt_at=$4,updated_at=NOW()
       WHERE id=$1`,
      [
        row.id,
        terminal ? "failed" : "retrying",
        message,
        new Date(Date.now() + retryDelay(attempts)),
      ],
    );
  }

  private async refreshDueAnalytics() {
    if (!this.pool) return;
    const due = await this.pool.query<{ id: string; account_id: string }>(
      `SELECT p.id,p.account_id
       FROM modo_native_publications p
       WHERE p.status='published'
         AND p.published_at >= NOW() - INTERVAL '60 days'
         AND NOT EXISTS (
           SELECT 1 FROM modo_native_analytics_snapshots s
           WHERE s.publication_id=p.id AND s.collected_at >= NOW() - INTERVAL '6 hours'
         )
       ORDER BY p.published_at DESC
       LIMIT 30`,
    );
    for (const row of due.rows) {
      await this.refreshAnalytics(row.account_id, row.id).catch(() => undefined);
    }
  }

  private async syncLinkedInPublications() {
    if (!this.pool) return;
    await this.pool.query(`
      UPDATE modo_native_publications n
      SET status = CASE
            WHEN l.status='published' THEN 'published'
            WHEN l.status='failed' THEN 'failed'
            ELSE n.status
          END,
          external_post_id=COALESCE(l.post_urn,n.external_post_id),
          published_at=COALESCE(l.published_at,n.published_at),
          last_error=COALESCE(l.error,n.last_error),
          updated_at=NOW()
      FROM modo_linkedin_publications l
      WHERE n.id=l.id
        AND n.platform='linkedin'
        AND n.status IN ('scheduled','publishing','retrying')
        AND l.status IN ('published','failed')
    `);
  }

  private async ensureLinkedInShadow(publication: NativePublication, accountId: string) {
    if (!this.pool) return;
    await this.pool.query(
      `INSERT INTO modo_linkedin_publications(
        id,account_id,content_request_id,status,scheduled_for
      ) VALUES($1,$2,$3,'scheduled',$4)
      ON CONFLICT(account_id,content_request_id) DO UPDATE SET
        id=EXCLUDED.id,status='scheduled',scheduled_for=EXCLUDED.scheduled_for,error=NULL,updated_at=NOW()`,
      [publication.id, accountId, publication.contentRequestId, publication.scheduledFor],
    );
  }

  private async fetchAnalytics(accountId: string, publication: NativePublication) {
    if (publication.platform === "instagram") return this.instagramAnalytics(accountId, publication);
    if (publication.platform === "facebook") return this.facebookAnalytics(accountId, publication);
    if (publication.platform === "threads") return this.threadsAnalytics(accountId, publication);
    return this.linkedinAnalytics(accountId, publication);
  }

  private async instagramAnalytics(accountId: string, publication: NativePublication) {
    const connection = await this.requireConnection(accountId, publication.brandId, "instagram");
    const token = await this.refreshInstagramToken(connection);
    const metrics: Array<{ key: string; label: string; value: number }> = [];
    const basicUrl = new URL(`${this.instagramGraphBase}/${this.instagramVersion}/${encodeURIComponent(publication.externalPostId!)}`);
    basicUrl.searchParams.set("fields", "like_count,comments_count");
    basicUrl.searchParams.set("access_token", token);
    const basicResponse = await this.fetcher(basicUrl.toString(), { signal: AbortSignal.timeout(15_000) });
    const basic = await basicResponse.json().catch(() => ({})) as JsonRecord;
    if (basicResponse.ok) {
      metrics.push({ key: "likes", label: "Curtidas", value: numberValue(basic.like_count) });
      metrics.push({ key: "comments", label: "Comentários", value: numberValue(basic.comments_count) });
    }
    for (const metric of ["reach", "saved", "shares", "views"] as const) {
      const value = await this.instagramInsight(publication.externalPostId!, token, metric).catch(() => 0);
      metrics.push({
        key: metric === "saved" ? "saves" : metric,
        label: metric === "reach" ? "Alcance" : metric === "saved" ? "Salvamentos" : metric === "shares" ? "Compartilhamentos" : "Visualizações",
        value,
      });
    }
    return metrics;
  }

  private async facebookAnalytics(accountId: string, publication: NativePublication) {
    const connection = await this.requireConnection(accountId, publication.brandId, "facebook");
    const token = this.decrypt(connection.access_token_encrypted);
    const url = new URL(`https://graph.facebook.com/${apiVersion(this.options.facebookApiVersion, "v21.0")}/${encodeURIComponent(publication.externalPostId!)}`);
    url.searchParams.set("fields", "shares,comments.limit(0).summary(true),reactions.limit(0).summary(true)");
    url.searchParams.set("access_token", token);
    const response = await this.fetcher(url.toString(), { signal: AbortSignal.timeout(15_000) });
    const payload = await response.json().catch(() => ({})) as JsonRecord;
    const shares = payload.shares && typeof payload.shares === "object" ? numberValue((payload.shares as JsonRecord).count) : 0;
    const comments = payload.comments && typeof payload.comments === "object"
      ? numberValue(((payload.comments as JsonRecord).summary as JsonRecord | undefined)?.total_count)
      : 0;
    const reactions = payload.reactions && typeof payload.reactions === "object"
      ? numberValue(((payload.reactions as JsonRecord).summary as JsonRecord | undefined)?.total_count)
      : 0;
    const impressions = await this.facebookInsight(publication.externalPostId!, token, "post_impressions_unique").catch(() => 0);
    return [
      { key: "impressions", label: "Pessoas alcançadas", value: impressions },
      { key: "reactions", label: "Reações", value: reactions },
      { key: "comments", label: "Comentários", value: comments },
      { key: "shares", label: "Compartilhamentos", value: shares },
    ];
  }

  private async threadsAnalytics(accountId: string, publication: NativePublication) {
    const connection = await this.requireConnection(accountId, publication.brandId, "threads");
    const token = this.decrypt(connection.access_token_encrypted);
    const metrics: Array<{ key: string; label: string; value: number }> = [];
    for (const metric of ["views", "likes", "replies", "reposts", "quotes", "shares"] as const) {
      const value = await this.threadsInsight(publication.externalPostId!, token, metric).catch(() => 0);
      metrics.push({ key: metric, label: metric[0].toUpperCase() + metric.slice(1), value });
    }
    return metrics;
  }

  private async linkedinAnalytics(accountId: string, publication: NativePublication) {
    if (!this.pool) return [];
    const connection = await this.pool.query<{
      encrypted_access_token: string;
    }>("SELECT encrypted_access_token FROM modo_linkedin_connections WHERE account_id=$1 LIMIT 1", [accountId]);
    const encrypted = connection.rows[0]?.encrypted_access_token;
    if (!encrypted) return [];
    let token: string;
    try {
      token = this.decrypt(encrypted);
    } catch {
      return [];
    }
    const encoded = encodeURIComponent(publication.externalPostId!);
    const response = await this.fetcher(`https://api.linkedin.com/rest/socialActions/${encoded}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        "LinkedIn-Version": process.env.LINKEDIN_API_VERSION || "202606",
        "X-Restli-Protocol-Version": "2.0.0",
      },
      signal: AbortSignal.timeout(15_000),
    });
    const payload = await response.json().catch(() => ({})) as JsonRecord;
    if (!response.ok) return [];
    return [
      { key: "likes", label: "Curtidas", value: numberValue(payload.likesSummary && (payload.likesSummary as JsonRecord).totalLikes) },
      { key: "comments", label: "Comentários", value: numberValue(payload.commentsSummary && (payload.commentsSummary as JsonRecord).totalFirstLevelComments) },
    ];
  }

  private async instagramInsight(postId: string, token: string, metric: string) {
    const url = new URL(`${this.instagramGraphBase}/${this.instagramVersion}/${encodeURIComponent(postId)}/insights`);
    url.searchParams.set("metric", metric);
    url.searchParams.set("access_token", token);
    const response = await this.fetcher(url.toString(), { signal: AbortSignal.timeout(15_000) });
    const payload = await response.json().catch(() => ({})) as JsonRecord;
    if (!response.ok) throw new Error("insight unavailable");
    const data = Array.isArray(payload.data) ? payload.data as JsonRecord[] : [];
    const item = data[0] || {};
    const total = item.total_value && typeof item.total_value === "object" ? (item.total_value as JsonRecord).value : undefined;
    const values = Array.isArray(item.values) ? item.values as JsonRecord[] : [];
    return numberValue(total ?? values[0]?.value);
  }

  private async facebookInsight(postId: string, token: string, metric: string) {
    const url = new URL(`https://graph.facebook.com/${apiVersion(this.options.facebookApiVersion, "v21.0")}/${encodeURIComponent(postId)}/insights`);
    url.searchParams.set("metric", metric);
    url.searchParams.set("access_token", token);
    const response = await this.fetcher(url.toString(), { signal: AbortSignal.timeout(15_000) });
    const payload = await response.json().catch(() => ({})) as JsonRecord;
    const data = Array.isArray(payload.data) ? payload.data as JsonRecord[] : [];
    const values = Array.isArray(data[0]?.values) ? data[0].values as JsonRecord[] : [];
    return numberValue(values[0]?.value);
  }

  private async threadsInsight(postId: string, token: string, metric: string) {
    const url = new URL(`${this.threadsGraphBase}/${this.threadsVersion}/${encodeURIComponent(postId)}/insights`);
    url.searchParams.set("metric", metric);
    url.searchParams.set("access_token", token);
    const response = await this.fetcher(url.toString(), { signal: AbortSignal.timeout(15_000) });
    const payload = await response.json().catch(() => ({})) as JsonRecord;
    const data = Array.isArray(payload.data) ? payload.data as JsonRecord[] : [];
    const values = Array.isArray(data[0]?.values) ? data[0].values as JsonRecord[] : [];
    return numberValue((data[0]?.total_value as JsonRecord | undefined)?.value ?? values[0]?.value);
  }

  private async recordPublishedSignal(accountId: string, request: ContentRequest, publicationId: string, qualityScore: number) {
    const exists = await this.feedbackExists(accountId, request.id, "published", `native_publication:${publicationId}`);
    if (exists) return;
    await this.creative.recordFeedback(accountId, request.brandId, {
      contentRequestId: request.id,
      signal: "published",
      score: qualityScore,
      notes: `native_publication:${publicationId}`,
      metrics: { qualityScore },
    });
  }

  private async recordPerformanceSignal(accountId: string, publication: NativePublication, summary: NativeAnalyticsSummary) {
    if (summary.learningSignal === "neutral") return;
    const exists = await this.feedbackExists(
      accountId,
      publication.contentRequestId,
      summary.learningSignal,
      `native_performance:${publication.id}:${summary.learningSignal}`,
    );
    if (exists) return;
    await this.creative.recordFeedback(accountId, publication.brandId, {
      contentRequestId: publication.contentRequestId,
      signal: summary.learningSignal,
      score: summary.score,
      notes: `native_performance:${publication.id}:${summary.learningSignal}`,
      metrics: summary.normalized,
    });
  }

  private async feedbackExists(accountId: string, contentRequestId: string, signal: string, notes: string) {
    if (!this.pool) return false;
    const result = await this.pool.query<{ exists: boolean }>(
      `SELECT EXISTS(
         SELECT 1 FROM modo_creative_feedback
         WHERE account_id=$1 AND content_request_id=$2 AND signal=$3 AND notes=$4
       ) exists`,
      [accountId, contentRequestId, signal, notes],
    );
    return Boolean(result.rows[0]?.exists);
  }

  private async requireConnection(accountId: string, brandId: string, platform: NativeSocialPlatform) {
    if (platform === "linkedin") throw new NativePublisherError("LINKEDIN_EXTERNAL_SCHEDULER", 500, "LinkedIn usa o scheduler dedicado.");
    const rows = await this.readConnections(accountId, brandId);
    const connection = rows.find((row) => row.platform === platform);
    if (!connection) throw new NativePublisherError("CHANNEL_NOT_CONNECTED", 409, `Conecte ${platform} à marca.`);
    if (connection.token_expires_at && connection.token_expires_at <= new Date()) {
      throw new NativePublisherError("CHANNEL_TOKEN_EXPIRED", 409, `A autorização de ${connection.display_name} expirou.`);
    }
    return connection;
  }

  private async readConnections(accountId: string, brandId?: string): Promise<ConnectionRow[]> {
    if (!this.pool) return [];
    const result = await this.pool.query<ConnectionRow>(
      `SELECT * FROM modo_native_social_connections
       WHERE account_id=$1
         AND ($2::text IS NULL OR brand_key=$2 OR brand_key='__organization__')
       ORDER BY CASE WHEN brand_key=$2 THEN 0 ELSE 1 END,updated_at DESC`,
      [accountId, brandId || null],
    );
    const seen = new Set<string>();
    return result.rows.filter((row) => {
      if (seen.has(row.platform)) return false;
      seen.add(row.platform);
      return true;
    });
  }

  private async linkedinConnection(accountId: string, brandId?: string): Promise<NativeConnection> {
    if (!this.pool) {
      return {
        platform: "linkedin",
        brandId: brandId || null,
        externalAccountId: null,
        displayName: null,
        pictureUrl: null,
        connected: false,
        configured: Boolean(this.options.linkedinConfigured),
        canPublish: false,
        expiresAt: null,
        scopes: [],
        message: "LinkedIn aguardando conexão.",
      };
    }
    const result = await this.pool.query<{
      author_urn: string;
      display_name: string;
      token_expires_at: Date;
      scopes: string[];
    }>("SELECT author_urn,display_name,token_expires_at,scopes FROM modo_linkedin_connections WHERE account_id=$1 LIMIT 1", [accountId]);
    const row = result.rows[0];
    const configured = Boolean(this.options.linkedinConfigured);
    const expired = Boolean(row && row.token_expires_at <= new Date());
    return {
      platform: "linkedin",
      brandId: brandId || null,
      externalAccountId: row?.author_urn || null,
      displayName: row?.display_name || null,
      pictureUrl: null,
      connected: Boolean(row && !expired),
      configured,
      canPublish: Boolean(row && !expired && configured),
      expiresAt: row?.token_expires_at.toISOString() || null,
      scopes: row?.scopes || [],
      message: row
        ? expired
          ? "A autorização do LinkedIn expirou. Reconecte a conta."
          : `${row.display_name} conectado ao LinkedIn.`
        : configured
          ? "Conecte o LinkedIn para publicar pela MODO."
          : "O conector LinkedIn aguarda Client ID e Client Secret.",
    };
  }

  private async installInstagramArchiveBridge() {
    if (!this.pool) return;
    await this.pool.query(`
      INSERT INTO modo_native_social_connections(
        id,account_id,brand_id,brand_key,platform,external_account_id,display_name,picture_url,
        access_token_encrypted,token_expires_at,scopes,metadata,connected_at,updated_at
      )
      SELECT
        md5(account_id || ':instagram:' || COALESCE(brand_id,'__organization__')),
        account_id,brand_id,COALESCE(brand_id,'__organization__'),'instagram',instagram_user_id,
        CASE WHEN instagram_username LIKE '@%' THEN instagram_username ELSE '@' || instagram_username END,
        profile_picture_url,access_token_encrypted,token_expires_at,scopes,'{}'::jsonb,connected_at,updated_at
      FROM modo_instagram_connections
      ON CONFLICT(account_id,platform,brand_key) DO UPDATE SET
        external_account_id=EXCLUDED.external_account_id,
        display_name=EXCLUDED.display_name,
        picture_url=EXCLUDED.picture_url,
        access_token_encrypted=EXCLUDED.access_token_encrypted,
        token_expires_at=EXCLUDED.token_expires_at,
        scopes=EXCLUDED.scopes,
        updated_at=EXCLUDED.updated_at;

      CREATE OR REPLACE FUNCTION modo_archive_instagram_connection() RETURNS trigger AS $$
      BEGIN
        INSERT INTO modo_native_social_connections(
          id,account_id,brand_id,brand_key,platform,external_account_id,display_name,picture_url,
          access_token_encrypted,token_expires_at,scopes,metadata,connected_at,updated_at
        ) VALUES(
          md5(NEW.account_id || ':instagram:' || COALESCE(NEW.brand_id,'__organization__')),
          NEW.account_id,NEW.brand_id,COALESCE(NEW.brand_id,'__organization__'),'instagram',NEW.instagram_user_id,
          CASE WHEN NEW.instagram_username LIKE '@%' THEN NEW.instagram_username ELSE '@' || NEW.instagram_username END,
          NEW.profile_picture_url,NEW.access_token_encrypted,NEW.token_expires_at,NEW.scopes,'{}'::jsonb,
          NEW.connected_at,NEW.updated_at
        )
        ON CONFLICT(account_id,platform,brand_key) DO UPDATE SET
          external_account_id=EXCLUDED.external_account_id,
          display_name=EXCLUDED.display_name,
          picture_url=EXCLUDED.picture_url,
          access_token_encrypted=EXCLUDED.access_token_encrypted,
          token_expires_at=EXCLUDED.token_expires_at,
          scopes=EXCLUDED.scopes,
          updated_at=EXCLUDED.updated_at;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;

      DROP TRIGGER IF EXISTS modo_archive_instagram_connection_trigger ON modo_instagram_connections;
      CREATE TRIGGER modo_archive_instagram_connection_trigger
      AFTER INSERT OR UPDATE ON modo_instagram_connections
      FOR EACH ROW EXECUTE FUNCTION modo_archive_instagram_connection();

      CREATE OR REPLACE FUNCTION modo_remove_archived_instagram_connection() RETURNS trigger AS $$
      BEGIN
        DELETE FROM modo_native_social_connections
        WHERE account_id=OLD.account_id AND platform='instagram'
          AND brand_key=COALESCE(OLD.brand_id,'__organization__')
          AND external_account_id=OLD.instagram_user_id;
        RETURN OLD;
      END;
      $$ LANGUAGE plpgsql;

      DROP TRIGGER IF EXISTS modo_remove_archived_instagram_connection_trigger ON modo_instagram_connections;
      CREATE TRIGGER modo_remove_archived_instagram_connection_trigger
      AFTER DELETE ON modo_instagram_connections
      FOR EACH ROW EXECUTE FUNCTION modo_remove_archived_instagram_connection();
    `);
  }

  private async saveOAuthState(input: { accountId: string; brandId: string; platform: "facebook" | "threads"; state: string }) {
    if (!this.pool) throw new NativePublisherError("DATABASE_REQUIRED", 503, "OAuth multicliente exige PostgreSQL.");
    await this.pool.query(
      `INSERT INTO modo_native_social_oauth_states(state,account_id,brand_id,platform,expires_at)
       VALUES($1,$2,$3,$4,$5)`,
      [input.state, input.accountId, input.brandId, input.platform, new Date(Date.now() + 15 * 60_000)],
    );
  }

  private async consumeOAuthState(stateValue: string | undefined, platform: "facebook" | "threads") {
    if (!stateValue || !this.pool) throw new NativePublisherError("OAUTH_STATE_INVALID", 400, "Estado OAuth inválido.");
    const result = await this.pool.query<OAuthStateRow>(
      `DELETE FROM modo_native_social_oauth_states
       WHERE state=$1 AND platform=$2 AND expires_at>NOW()
       RETURNING *`,
      [stateValue, platform],
    );
    if (!result.rowCount) throw new NativePublisherError("OAUTH_STATE_EXPIRED", 400, "A autorização expirou ou já foi utilizada.");
    return result.rows[0];
  }

  private integrationRedirect(
    platform: "facebook" | "threads",
    status: "connected" | "error" | "select",
    brandId: string,
    message?: string,
    selectionId?: string,
  ) {
    const url = new URL("/app/settings/integrations", this.options.webUrl || "http://localhost:5173");
    url.searchParams.set(platform, status);
    url.searchParams.set("brandId", brandId);
    if (message) url.searchParams.set("message", message.slice(0, 300));
    if (selectionId) url.searchParams.set("selection", selectionId);
    return url.toString();
  }

  private async saveFacebookCandidates(
    selectionId: string,
    accountId: string,
    brandId: string,
    pages: JsonRecord[],
  ) {
    if (!this.pool) return;
    const expiresAt = new Date(Date.now() + 15 * 60_000);
    for (const page of pages) {
      const picture = page.picture && typeof page.picture === "object"
        ? safeUrl(((page.picture as JsonRecord).data as JsonRecord | undefined)?.url)
        : null;
      await this.pool.query(
        `INSERT INTO modo_native_facebook_page_candidates(
          selection_id,account_id,brand_id,page_id,page_name,picture_url,access_token_encrypted,expires_at
        ) VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
        [
          selectionId,
          accountId,
          brandId,
          text(page.id),
          text(page.name) || "Página do Facebook",
          picture,
          this.encrypt(text(page.access_token)),
          expiresAt,
        ],
      );
    }
  }

  private async upsertConnection(input: {
    accountId: string;
    brandId: string;
    platform: "facebook" | "threads";
    externalAccountId: string;
    displayName: string;
    pictureUrl: string | null;
    accessToken: string;
    tokenExpiresAt: Date | null;
    scopes: string[];
    metadata: JsonRecord;
  }) {
    return this.upsertConnectionEncrypted({
      ...input,
      encryptedToken: this.encrypt(input.accessToken),
    });
  }

  private async upsertConnectionEncrypted(input: {
    accountId: string;
    brandId: string;
    platform: "facebook" | "threads";
    externalAccountId: string;
    displayName: string;
    pictureUrl: string | null;
    encryptedToken: string;
    tokenExpiresAt: Date | null;
    scopes: string[];
    metadata: JsonRecord;
  }) {
    if (!this.pool) return;
    await this.pool.query(
      `INSERT INTO modo_native_social_connections(
        id,account_id,brand_id,brand_key,platform,external_account_id,display_name,picture_url,
        access_token_encrypted,token_expires_at,scopes,metadata
      ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb)
      ON CONFLICT(account_id,platform,brand_key) DO UPDATE SET
        external_account_id=EXCLUDED.external_account_id,
        display_name=EXCLUDED.display_name,
        picture_url=EXCLUDED.picture_url,
        access_token_encrypted=EXCLUDED.access_token_encrypted,
        token_expires_at=EXCLUDED.token_expires_at,
        scopes=EXCLUDED.scopes,
        metadata=EXCLUDED.metadata,
        updated_at=NOW()`,
      [
        randomUUID(),
        input.accountId,
        input.brandId,
        brandKey(input.brandId),
        input.platform,
        input.externalAccountId,
        input.displayName,
        input.pictureUrl,
        input.encryptedToken,
        input.tokenExpiresAt,
        input.scopes,
        JSON.stringify(input.metadata),
      ],
    );
  }

  private async refreshInstagramToken(connection: ConnectionRow) {
    const current = this.decrypt(connection.access_token_encrypted);
    if (!connection.token_expires_at || connection.token_expires_at.getTime() - Date.now() >= 5 * 24 * 60 * 60_000) {
      return current;
    }
    const url = new URL(`${this.instagramGraphBase}/refresh_access_token`);
    url.searchParams.set("grant_type", "ig_refresh_token");
    url.searchParams.set("access_token", current);
    const response = await this.fetcher(url.toString(), { signal: AbortSignal.timeout(20_000) });
    const payload = await response.json().catch(() => ({})) as JsonRecord;
    if (!response.ok || !text(payload.access_token)) return current;
    const token = text(payload.access_token);
    const expiresAt = new Date(Date.now() + (numberValue(payload.expires_in) || 60 * 24 * 60 * 60) * 1000);
    await this.pool?.query(
      `UPDATE modo_native_social_connections
       SET access_token_encrypted=$2,token_expires_at=$3,updated_at=NOW() WHERE id=$1`,
      [connection.id, this.encrypt(token), expiresAt],
    );
    return token;
  }

  private async waitInstagramContainer(creationId: string, token: string) {
    for (let attempt = 0; attempt < 12; attempt += 1) {
      const url = new URL(`${this.instagramGraphBase}/${this.instagramVersion}/${encodeURIComponent(creationId)}`);
      url.searchParams.set("fields", "status_code");
      url.searchParams.set("access_token", token);
      const response = await this.fetcher(url.toString(), { signal: AbortSignal.timeout(15_000) });
      const payload = await response.json().catch(() => ({})) as JsonRecord;
      if (!response.ok && attempt === 0) return;
      const status = text(payload.status_code).toUpperCase();
      if (!status || status === "FINISHED" || status === "PUBLISHED") return;
      if (["ERROR", "EXPIRED"].includes(status)) {
        throw new NativePublisherError("INSTAGRAM_PROCESSING_FAILED", 422, "O Instagram não conseguiu processar a imagem.");
      }
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    throw new NativePublisherError("INSTAGRAM_PROCESSING_TIMEOUT", 504, "O Instagram demorou demais para processar a imagem.");
  }

  private async graphFormPost(url: string, values: Record<string, string>) {
    const response = await this.fetcher(url, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(values),
      signal: AbortSignal.timeout(30_000),
    });
    const payload = await response.json().catch(() => ({})) as JsonRecord;
    if (!response.ok) {
      const nested = payload.error && typeof payload.error === "object" ? payload.error as JsonRecord : {};
      throw new NativePublisherError(
        "SOCIAL_PROVIDER_ERROR",
        response.status === 429 ? 429 : response.status >= 400 && response.status < 500 ? 422 : 502,
        text(nested.message) || text(payload.error_message) || `A rede social respondeu com status ${response.status}.`,
      );
    }
    return payload;
  }

  private encryptionKey() {
    if (!this.options.encryptionSecret) {
      throw new NativePublisherError("ENCRYPTION_SECRET_MISSING", 503, "Configure o segredo de criptografia do Publisher nativo.");
    }
    return createHash("sha256").update(this.options.encryptionSecret).digest();
  }

  private encrypt(value: string) {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.encryptionKey(), iv);
    const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
    const tag = cipher.getAuthTag();
    return [iv, tag, encrypted].map((part) => part.toString("base64url")).join(".");
  }

  private decrypt(value: string) {
    const [ivValue, tagValue, encryptedValue] = value.split(".");
    if (!ivValue || !tagValue || !encryptedValue) throw new NativePublisherError("TOKEN_INVALID", 500, "Token social inválido.");
    const decipher = createDecipheriv(
      "aes-256-gcm",
      this.encryptionKey(),
      Buffer.from(ivValue, "base64url"),
    );
    decipher.setAuthTag(Buffer.from(tagValue, "base64url"));
    return Buffer.concat([
      decipher.update(Buffer.from(encryptedValue, "base64url")),
      decipher.final(),
    ]).toString("utf8");
  }

  private get instagramGraphBase() {
    return (this.options.instagramGraphBaseUrl || "https://graph.instagram.com").replace(/\/$/, "");
  }

  private get instagramVersion() {
    return apiVersion(this.options.instagramApiVersion, "v21.0");
  }

  private get threadsGraphBase() {
    return (this.options.threadsGraphBaseUrl || "https://graph.threads.net").replace(/\/$/, "");
  }

  private get threadsVersion() {
    return apiVersion(this.options.threadsApiVersion, "v1.0");
  }

  private get facebookScopes() {
    return (this.options.facebookScopes || "pages_show_list,pages_read_engagement,pages_manage_posts,read_insights")
      .split(/[\s,]+/)
      .map((item) => item.trim())
      .filter(Boolean);
  }

  private get threadsScopes() {
    return (this.options.threadsScopes || "threads_basic,threads_content_publish,threads_manage_insights")
      .split(/[\s,]+/)
      .map((item) => item.trim())
      .filter(Boolean);
  }
}
