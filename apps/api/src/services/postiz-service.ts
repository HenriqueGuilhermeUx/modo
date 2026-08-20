import type { ContentRequest } from "@modo/contracts/content";
import type {
  PostizAnalyticsSummary,
  PostizClaimResponse,
  PostizConnectResponse,
  PostizIntegration,
  PostizPlatform,
  PostizPublication,
  PostizPublishRequest,
} from "@modo/contracts/postiz";
import { randomUUID } from "node:crypto";
import pg, { type Pool } from "pg";
import { assertPublicHttpUrl } from "../security/public-url.js";

const { Pool: PgPool } = pg;
const CONNECTION_WINDOW_MS = 15 * 60_000;

type Fetcher = (input: string, init?: RequestInit) => Promise<Response>;
type JsonRecord = Record<string, unknown>;

interface PostizServiceOptions {
  apiKey?: string;
  baseUrl?: string;
  databaseUrl?: string;
  databaseSsl?: boolean;
  fetcher?: Fetcher;
}

interface RemoteIntegration {
  id: string;
  name?: string;
  identifier?: string;
  picture?: string;
  disabled?: boolean;
  profile?: string;
}

interface PendingConnection {
  id: string;
  accountId: string;
  brandId: string;
  platform: PostizPlatform;
  baselineIds: string[];
  expiresAt: Date;
}

interface ConnectionRow {
  integration_id: string;
  account_id: string;
  brand_id: string | null;
  provider_identifier: PostizPlatform;
  name: string;
  profile: string | null;
  picture: string | null;
  disabled: boolean;
  connected_at: Date;
  updated_at: Date;
}

interface PendingRow {
  id: string;
  account_id: string;
  brand_id: string;
  provider_identifier: PostizPlatform;
  baseline_ids: string[];
  expires_at: Date;
}

interface PublicationRow {
  id: string;
  account_id: string;
  brand_id: string;
  content_request_id: string;
  integration_id: string;
  provider_identifier: PostizPlatform;
  postiz_post_id: string;
  publish_mode: PostizPublishRequest["mode"];
  status: PostizPublication["status"];
  scheduled_for: Date | null;
  release_url: string | null;
  published_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

interface RawAnalyticsMetric {
  label?: string;
  data?: Array<{ total?: string | number; date?: string }>;
  percentageChange?: number;
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function nullablePublicUrl(value: unknown) {
  const text = stringValue(value);
  if (!text) return null;
  try {
    return assertPublicHttpUrl(text).toString();
  } catch {
    return null;
  }
}

function mapConnection(row: ConnectionRow): PostizIntegration {
  return {
    id: row.integration_id,
    brandId: row.brand_id,
    name: row.name,
    identifier: row.provider_identifier,
    profile: row.profile,
    picture: nullablePublicUrl(row.picture),
    disabled: row.disabled,
    connectedAt: row.connected_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

function mapPublication(row: PublicationRow): PostizPublication {
  return {
    id: row.id,
    contentRequestId: row.content_request_id,
    brandId: row.brand_id,
    integrationId: row.integration_id,
    platform: row.provider_identifier,
    postizPostId: row.postiz_post_id,
    mode: row.publish_mode,
    status: row.status,
    scheduledFor: row.scheduled_for?.toISOString() ?? null,
    releaseUrl: nullablePublicUrl(row.release_url),
    publishedAt: row.published_at?.toISOString() ?? null,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

function normalizedMetricKey(label: string) {
  const key = label.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  if (/(impression|reach|view|visualiza|alcance)/.test(key)) return "exposure";
  if (/(like|reaction|curtida|reacao)/.test(key)) return "likes";
  if (/(comment|comentario)/.test(key)) return "comments";
  if (/(share|repost|compartilh)/.test(key)) return "shares";
  if (/(save|bookmark|salv)/.test(key)) return "saves";
  if (/(click|clique)/.test(key)) return "clicks";
  if (/(follower|seguidor)/.test(key)) return "followers";
  return key.replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "") || "metric";
}

function publicationStatus(mode: PostizPublishRequest["mode"]): PostizPublication["status"] {
  if (mode === "draft") return "draft";
  if (mode === "schedule") return "scheduled";
  return "submitted";
}

function providerSettings(platform: PostizPlatform, request: ContentRequest, imageCount: number) {
  if (platform === "instagram" || platform === "instagram-standalone") {
    return {
      __type: platform,
      post_type: request.contentType === "story" ? "story" : "post",
      ...(request.contentType === "story" ? {} : { is_trial_reel: false, collaborators: [] }),
    };
  }
  if (platform === "linkedin" || platform === "linkedin-page") {
    return {
      __type: platform,
      post_as_images_carousel: imageCount > 1,
      ...(imageCount > 1 ? { carousel_name: request.output?.title || "MODO" } : {}),
    };
  }
  return { __type: platform };
}

function composeContent(request: ContentRequest) {
  const output = request.output;
  if (!output) return "";
  const hashtags = output.hashtags
    .map((tag) => tag.trim())
    .filter(Boolean)
    .map((tag) => (tag.startsWith("#") ? tag : `#${tag.replace(/^#+/, "")}`))
    .join(" ");
  return [output.caption.trim(), output.cta.trim(), hashtags].filter(Boolean).join("\n\n").slice(0, 5000);
}

function mediaUrls(request: ContentRequest) {
  const output = request.output;
  if (!output) return [];
  const visual = output.visualAssets
    .filter((asset) => asset.imageStatus === "generated" && asset.imageUrl)
    .sort((a, b) => a.index - b.index)
    .map((asset) => asset.imageUrl!)
    .filter(Boolean);
  if (["carousel", "story"].includes(request.contentType) && visual.length) return visual;
  return output.imageUrl ? [output.imageUrl] : [];
}

export class PostizError extends Error {
  constructor(
    public readonly code: string,
    public readonly statusCode: number,
    message: string,
  ) {
    super(message);
    this.name = "PostizError";
  }
}

export class PostizService {
  private readonly pool?: Pool;
  private readonly fetcher: Fetcher;
  private readonly connections = new Map<string, ConnectionRow>();
  private readonly pending = new Map<string, PendingConnection>();
  private readonly publications = new Map<string, PublicationRow>();

  constructor(private readonly options: PostizServiceOptions = {}) {
    this.fetcher = options.fetcher ?? ((input, init) => fetch(input, init));
    if (options.databaseUrl) {
      this.pool = new PgPool({
        connectionString: options.databaseUrl,
        ssl: options.databaseSsl ? { rejectUnauthorized: false } : undefined,
        max: 4,
      });
    }
  }

  get configured() {
    return Boolean(this.options.apiKey);
  }

  get storage(): "memory" | "postgres" {
    return this.pool ? "postgres" : "memory";
  }

  get baseUrl() {
    return (this.options.baseUrl || "https://api.postiz.com/public/v1").replace(/\/$/, "");
  }

  async initialize() {
    if (!this.pool) return;
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS modo_postiz_connections (
        integration_id TEXT PRIMARY KEY,
        account_id TEXT NOT NULL REFERENCES modo_organizations(id) ON DELETE CASCADE,
        brand_id TEXT REFERENCES modo_brands(id) ON DELETE SET NULL,
        provider_identifier TEXT NOT NULL,
        name TEXT NOT NULL,
        profile TEXT,
        picture TEXT,
        disabled BOOLEAN NOT NULL DEFAULT FALSE,
        connected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS modo_postiz_connections_account_idx
        ON modo_postiz_connections(account_id, brand_id, updated_at DESC);

      CREATE TABLE IF NOT EXISTS modo_postiz_pending_connections (
        id TEXT PRIMARY KEY,
        account_id TEXT NOT NULL REFERENCES modo_organizations(id) ON DELETE CASCADE,
        brand_id TEXT NOT NULL REFERENCES modo_brands(id) ON DELETE CASCADE,
        provider_identifier TEXT NOT NULL,
        baseline_ids TEXT[] NOT NULL DEFAULT '{}',
        expires_at TIMESTAMPTZ NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS modo_postiz_pending_provider_idx
        ON modo_postiz_pending_connections(provider_identifier, expires_at DESC);

      CREATE TABLE IF NOT EXISTS modo_postiz_publications (
        id TEXT PRIMARY KEY,
        account_id TEXT NOT NULL REFERENCES modo_organizations(id) ON DELETE CASCADE,
        brand_id TEXT NOT NULL REFERENCES modo_brands(id) ON DELETE CASCADE,
        content_request_id TEXT NOT NULL REFERENCES modo_content_requests(id) ON DELETE CASCADE,
        integration_id TEXT NOT NULL,
        provider_identifier TEXT NOT NULL,
        postiz_post_id TEXT NOT NULL,
        publish_mode TEXT NOT NULL,
        status TEXT NOT NULL,
        scheduled_for TIMESTAMPTZ,
        release_url TEXT,
        published_at TIMESTAMPTZ,
        content_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE(account_id, postiz_post_id)
      );
      CREATE INDEX IF NOT EXISTS modo_postiz_publications_content_idx
        ON modo_postiz_publications(account_id, content_request_id, created_at DESC);

      CREATE TABLE IF NOT EXISTS modo_postiz_analytics_snapshots (
        id TEXT PRIMARY KEY,
        account_id TEXT NOT NULL REFERENCES modo_organizations(id) ON DELETE CASCADE,
        brand_id TEXT NOT NULL REFERENCES modo_brands(id) ON DELETE CASCADE,
        publication_id TEXT NOT NULL REFERENCES modo_postiz_publications(id) ON DELETE CASCADE,
        postiz_post_id TEXT NOT NULL,
        days INTEGER NOT NULL,
        score NUMERIC NOT NULL,
        engagement_rate NUMERIC,
        learning_signal TEXT NOT NULL,
        metrics JSONB NOT NULL DEFAULT '[]'::jsonb,
        normalized JSONB NOT NULL DEFAULT '{}'::jsonb,
        collected_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS modo_postiz_analytics_brand_idx
        ON modo_postiz_analytics_snapshots(account_id, brand_id, collected_at DESC);

      DELETE FROM modo_postiz_pending_connections WHERE expires_at < NOW();
    `);
  }

  async close() {
    await this.pool?.end();
  }

  async connectionStatus(accountId: string, brandId?: string) {
    const integrations = await this.listConnections(accountId, brandId);
    if (!this.configured) {
      return { configured: false, connected: false, provider: "postiz" as const, integrations };
    }
    try {
      const remote = await this.request<{ connected?: boolean }>("/is-connected");
      return {
        configured: true,
        connected: Boolean(remote.connected),
        provider: "postiz" as const,
        integrations,
      };
    } catch {
      return { configured: true, connected: false, provider: "postiz" as const, integrations };
    }
  }

  async startConnection(
    accountId: string,
    brandId: string,
    platform: PostizPlatform,
  ): Promise<PostizConnectResponse> {
    this.requireConfigured();
    await this.cleanupPending();
    const active = await this.activePendingForPlatform(platform);
    if (active) {
      throw new PostizError(
        "POSTIZ_CONNECTION_BUSY",
        409,
        "Já existe uma conexão deste canal em andamento. Conclua ou aguarde alguns minutos.",
      );
    }

    const baseline = await this.listRemoteIntegrations();
    const response = await this.request<{ url?: string }>(`/social/${encodeURIComponent(platform)}`);
    const authorizationUrl = nullablePublicUrl(response.url);
    if (!authorizationUrl) {
      throw new PostizError(
        "POSTIZ_AUTH_URL_MISSING",
        502,
        "O Postiz não retornou uma URL de autorização válida.",
      );
    }

    const pending: PendingConnection = {
      id: randomUUID(),
      accountId,
      brandId,
      platform,
      baselineIds: baseline.map((item) => item.id),
      expiresAt: new Date(Date.now() + CONNECTION_WINDOW_MS),
    };
    await this.savePending(pending);
    return {
      pendingId: pending.id,
      authorizationUrl,
      expiresAt: pending.expiresAt.toISOString(),
    };
  }

  async claimConnection(accountId: string, pendingId: string): Promise<PostizClaimResponse> {
    this.requireConfigured();
    const pending = await this.getPending(accountId, pendingId);
    if (!pending) {
      throw new PostizError(
        "POSTIZ_PENDING_NOT_FOUND",
        404,
        "A tentativa de conexão expirou. Inicie a conexão novamente.",
      );
    }
    if (pending.expiresAt.getTime() <= Date.now()) {
      await this.deletePending(pending.id);
      throw new PostizError(
        "POSTIZ_PENDING_EXPIRED",
        410,
        "A tentativa de conexão expirou. Inicie novamente.",
      );
    }

    const remote = await this.listRemoteIntegrations();
    const mappedIds = new Set((await this.allConnectionIds()).map(String));
    const candidates = remote.filter(
      (item) =>
        item.identifier === pending.platform &&
        !pending.baselineIds.includes(item.id) &&
        !mappedIds.has(item.id),
    );

    if (!candidates.length) return { status: "pending", integrations: [] };

    const integrations: PostizIntegration[] = [];
    for (const candidate of candidates) {
      integrations.push(
        await this.upsertConnection(accountId, pending.brandId, candidate, pending.platform),
      );
    }
    await this.deletePending(pending.id);
    return { status: "connected", integrations };
  }

  async listConnections(accountId: string, brandId?: string): Promise<PostizIntegration[]> {
    const local = await this.readConnections(accountId, brandId);
    if (!this.configured || !local.length) return local;

    try {
      const remote = await this.listRemoteIntegrations();
      const byId = new Map(remote.map((item) => [item.id, item]));
      const refreshed: PostizIntegration[] = [];
      for (const connection of local) {
        const item = byId.get(connection.id);
        if (!item) {
          refreshed.push(await this.markDisabled(accountId, connection.id, true));
          continue;
        }
        refreshed.push(
          await this.upsertConnection(
            accountId,
            connection.brandId,
            item,
            connection.identifier,
          ),
        );
      }
      return refreshed;
    } catch {
      return local;
    }
  }

  async removeConnection(accountId: string, integrationId: string) {
    if (this.pool) {
      const result = await this.pool.query(
        "DELETE FROM modo_postiz_connections WHERE account_id=$1 AND integration_id=$2 RETURNING integration_id",
        [accountId, integrationId],
      );
      if (!result.rowCount) throw this.connectionNotFound();
      return { disconnected: true };
    }
    const row = this.connections.get(integrationId);
    if (!row || row.account_id !== accountId) throw this.connectionNotFound();
    this.connections.delete(integrationId);
    return { disconnected: true };
  }

  async publish(
    accountId: string,
    request: ContentRequest,
    input: PostizPublishRequest,
  ): Promise<PostizPublication[]> {
    this.requireConfigured();
    if (request.status !== "approved" || !request.output) {
      throw new PostizError(
        "POSTIZ_CONTENT_NOT_APPROVED",
        409,
        "A peça precisa estar aprovada antes de publicar ou agendar.",
      );
    }
    if (input.mode === "schedule" && input.scheduledFor) {
      const scheduled = new Date(input.scheduledFor);
      if (!Number.isFinite(scheduled.getTime()) || scheduled.getTime() <= Date.now() + 60_000) {
        throw new PostizError(
          "POSTIZ_INVALID_SCHEDULE",
          400,
          "Escolha um horário futuro para o agendamento.",
        );
      }
    }

    const available = await this.readConnections(accountId, request.brandId);
    const selected = input.integrationIds.map((id) => available.find((item) => item.id === id));
    if (selected.some((item) => !item)) throw this.connectionNotFound();
    if (selected.some((item) => item?.disabled)) {
      throw new PostizError(
        "POSTIZ_CONNECTION_DISABLED",
        409,
        "Reconecte o canal antes de publicar.",
      );
    }

    const urls = mediaUrls(request);
    const uploads = await Promise.all(urls.map((url) => this.uploadFromUrl(url)));
    const content = composeContent(request);
    const date = input.mode === "schedule" ? input.scheduledFor! : new Date().toISOString();
    const posts: JsonRecord[] = [];

    for (const integration of selected as PostizIntegration[]) {
      if (request.contentType === "story" && integration.identifier.startsWith("instagram")) {
        if (!uploads.length) {
          throw new PostizError(
            "POSTIZ_STORY_MEDIA_REQUIRED",
            409,
            "Stories do Instagram precisam de pelo menos uma arte pronta.",
          );
        }
        for (const upload of uploads) {
          posts.push({
            integration: { id: integration.id },
            value: [{ content: "", image: [upload] }],
            settings: providerSettings(integration.identifier, request, 1),
          });
        }
        continue;
      }
      posts.push({
        integration: { id: integration.id },
        value: [{ content, image: uploads }],
        settings: providerSettings(integration.identifier, request, uploads.length),
      });
    }

    const response = await this.request<Array<{ postId?: string; integration?: string }>>("/posts", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        type: input.mode,
        date,
        shortLink: false,
        tags: [],
        posts,
      }),
    });
    if (!Array.isArray(response) || !response.length) {
      throw new PostizError(
        "POSTIZ_EMPTY_PUBLISH_RESPONSE",
        502,
        "O Postiz não confirmou a criação da publicação.",
      );
    }

    const created: PostizPublication[] = [];
    for (const result of response) {
      const postId = stringValue(result.postId);
      const integrationId = stringValue(result.integration);
      if (!postId || !integrationId) continue;
      const integration = (selected as PostizIntegration[]).find((item) => item.id === integrationId);
      if (!integration) continue;
      created.push(
        await this.savePublication(accountId, request, integration, postId, input, date),
      );
    }
    if (!created.length) {
      throw new PostizError(
        "POSTIZ_PUBLICATION_MAPPING_FAILED",
        502,
        "A publicação foi enviada, mas a MODO não conseguiu associar o retorno aos canais.",
      );
    }
    return created;
  }

  async listPublications(accountId: string, contentRequestId: string) {
    if (this.pool) {
      const result = await this.pool.query<PublicationRow>(
        `SELECT * FROM modo_postiz_publications
         WHERE account_id=$1 AND content_request_id=$2
         ORDER BY created_at DESC`,
        [accountId, contentRequestId],
      );
      return result.rows.map(mapPublication);
    }
    return [...this.publications.values()]
      .filter((row) => row.account_id === accountId && row.content_request_id === contentRequestId)
      .sort((a, b) => b.created_at.getTime() - a.created_at.getTime())
      .map(mapPublication);
  }

  async syncPublications(accountId: string, contentRequestId: string) {
    const local = await this.listPublications(accountId, contentRequestId);
    if (!this.configured || !local.length) return local;
    const start = new Date(Math.min(...local.map((item) => new Date(item.createdAt).getTime())) - 86_400_000);
    const end = new Date(Date.now() + 365 * 86_400_000);
    try {
      const remote = await this.request<{ posts?: Array<JsonRecord> }>(
        `/posts?startDate=${encodeURIComponent(start.toISOString())}&endDate=${encodeURIComponent(end.toISOString())}`,
      );
      const byId = new Map((remote.posts || []).map((item) => [stringValue(item.id), item]));
      for (const publication of local) {
        const item = byId.get(publication.postizPostId);
        if (!item) continue;
        const releaseUrl = nullablePublicUrl(item.releaseURL);
        if (releaseUrl) await this.markPublished(accountId, publication.id, releaseUrl);
      }
    } catch {
      return local;
    }
    return this.listPublications(accountId, contentRequestId);
  }

  async refreshAnalytics(
    accountId: string,
    publicationId: string,
    days = 30,
  ): Promise<{ publication: PostizPublication; summary: PostizAnalyticsSummary }> {
    this.requireConfigured();
    const publication = await this.getPublication(accountId, publicationId);
    const raw = await this.request<RawAnalyticsMetric[]>(
      `/analytics/post/${encodeURIComponent(publication.postizPostId)}?date=${days}`,
    );
    const metrics = (Array.isArray(raw) ? raw : []).map((metric) => {
      const values = Array.isArray(metric.data) ? metric.data : [];
      const latest = values.length ? Number(values[values.length - 1]?.total || 0) : 0;
      return {
        label: stringValue(metric.label) || "Métrica",
        latest: Number.isFinite(latest) ? latest : 0,
        percentageChange:
          typeof metric.percentageChange === "number" && Number.isFinite(metric.percentageChange)
            ? metric.percentageChange
            : null,
      };
    });

    const normalized: Record<string, number> = {};
    for (const metric of metrics) {
      const key = normalizedMetricKey(metric.label);
      normalized[key] = Math.max(normalized[key] || 0, metric.latest);
    }
    const exposure = normalized.exposure || 0;
    const engagementPoints =
      (normalized.likes || 0) +
      (normalized.comments || 0) * 2 +
      (normalized.shares || 0) * 3 +
      (normalized.saves || 0) * 3 +
      (normalized.clicks || 0) * 2;
    const engagementRate = exposure > 0 ? (engagementPoints / exposure) * 100 : null;
    const score = Math.max(
      0,
      Math.min(
        100,
        Math.round(engagementRate === null ? Math.min(100, engagementPoints) : engagementRate * 10),
      ),
    );
    const learningSignal: PostizAnalyticsSummary["learningSignal"] =
      score >= 60 ? "performed_well" : score <= 25 ? "performed_poorly" : "neutral";
    const summary: PostizAnalyticsSummary = {
      publicationId: publication.id,
      postizPostId: publication.postizPostId,
      days,
      score,
      engagementRate,
      metrics,
      normalized,
      learningSignal,
      collectedAt: new Date().toISOString(),
    };
    await this.saveAnalytics(accountId, publication.brandId, summary);
    return { publication, summary };
  }

  async brandInsights(accountId: string, brandId: string) {
    if (!this.pool) return { samples: 0, averageScore: 0, bestScore: 0, signal: "insufficient_data" as const };
    const result = await this.pool.query<{
      samples: number;
      average_score: number;
      best_score: number;
    }>(
      `SELECT COUNT(*)::int AS samples,
              COALESCE(AVG(latest.score),0)::float AS average_score,
              COALESCE(MAX(latest.score),0)::float AS best_score
       FROM (
         SELECT DISTINCT ON (publication_id) publication_id, score
         FROM modo_postiz_analytics_snapshots
         WHERE account_id=$1 AND brand_id=$2
         ORDER BY publication_id, collected_at DESC
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
      signal:
        samples < 3
          ? ("insufficient_data" as const)
          : averageScore >= 60
            ? ("strong" as const)
            : averageScore <= 25
              ? ("weak" as const)
              : ("learning" as const),
    };
  }

  private requireConfigured() {
    if (!this.options.apiKey) {
      throw new PostizError(
        "POSTIZ_NOT_CONFIGURED",
        503,
        "A distribuição multicanal ainda não foi ativada na MODO.",
      );
    }
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    this.requireConfigured();
    const response = await this.fetcher(`${this.baseUrl}${path}`, {
      ...init,
      headers: {
        Authorization: this.options.apiKey!,
        ...(init.headers || {}),
      },
    });
    const payload = (await response.json().catch(() => ({}))) as JsonRecord | unknown[];
    if (!response.ok) {
      const record = !Array.isArray(payload) ? (payload as JsonRecord) : {};
      const message =
        stringValue(record.message) ||
        stringValue(record.error) ||
        `O Postiz respondeu com status ${response.status}.`;
      const status = response.status === 429 ? 429 : response.status >= 400 && response.status < 500 ? 422 : 502;
      throw new PostizError("POSTIZ_PROVIDER_ERROR", status, message);
    }
    return payload as T;
  }

  private async listRemoteIntegrations(): Promise<RemoteIntegration[]> {
    const payload = await this.request<RemoteIntegration[]>("/integrations");
    return Array.isArray(payload)
      ? payload.filter(
          (item) =>
            item &&
            stringValue(item.id) &&
            ["instagram", "instagram-standalone", "facebook", "linkedin", "linkedin-page", "threads"].includes(
              stringValue(item.identifier),
            ),
        )
      : [];
  }

  private async uploadFromUrl(url: string) {
    const publicUrl = assertPublicHttpUrl(url).toString();
    const payload = await this.request<{ id?: string; path?: string }>("/upload-from-url", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url: publicUrl }),
    });
    const id = stringValue(payload.id);
    const path = nullablePublicUrl(payload.path);
    if (!id || !path) {
      throw new PostizError(
        "POSTIZ_UPLOAD_FAILED",
        502,
        "O Postiz não confirmou o upload de uma das artes.",
      );
    }
    return { id, path };
  }

  private async readConnections(accountId: string, brandId?: string): Promise<PostizIntegration[]> {
    if (this.pool) {
      const params: unknown[] = [accountId];
      let clause = "account_id=$1";
      if (brandId) {
        params.push(brandId);
        clause += " AND (brand_id=$2 OR brand_id IS NULL)";
      }
      const result = await this.pool.query<ConnectionRow>(
        `SELECT * FROM modo_postiz_connections WHERE ${clause} ORDER BY connected_at DESC`,
        params,
      );
      return result.rows.map(mapConnection);
    }
    return [...this.connections.values()]
      .filter(
        (row) =>
          row.account_id === accountId &&
          (!brandId || row.brand_id === brandId || row.brand_id === null),
      )
      .sort((a, b) => b.connected_at.getTime() - a.connected_at.getTime())
      .map(mapConnection);
  }

  private async upsertConnection(
    accountId: string,
    brandId: string | null,
    remote: RemoteIntegration,
    platform: PostizPlatform,
  ): Promise<PostizIntegration> {
    const picture = nullablePublicUrl(remote.picture);
    if (this.pool) {
      const result = await this.pool.query<ConnectionRow>(
        `INSERT INTO modo_postiz_connections(
          integration_id,account_id,brand_id,provider_identifier,name,profile,picture,disabled
        ) VALUES($1,$2,$3,$4,$5,$6,$7,$8)
        ON CONFLICT(integration_id) DO UPDATE SET
          account_id=EXCLUDED.account_id,
          brand_id=COALESCE(EXCLUDED.brand_id,modo_postiz_connections.brand_id),
          provider_identifier=EXCLUDED.provider_identifier,
          name=EXCLUDED.name,
          profile=EXCLUDED.profile,
          picture=EXCLUDED.picture,
          disabled=EXCLUDED.disabled,
          updated_at=NOW()
        RETURNING *`,
        [
          remote.id,
          accountId,
          brandId,
          platform,
          stringValue(remote.name) || platform,
          stringValue(remote.profile) || null,
          picture,
          Boolean(remote.disabled),
        ],
      );
      return mapConnection(result.rows[0]);
    }
    const current = this.connections.get(remote.id);
    const row: ConnectionRow = {
      integration_id: remote.id,
      account_id: accountId,
      brand_id: brandId ?? current?.brand_id ?? null,
      provider_identifier: platform,
      name: stringValue(remote.name) || platform,
      profile: stringValue(remote.profile) || null,
      picture,
      disabled: Boolean(remote.disabled),
      connected_at: current?.connected_at ?? new Date(),
      updated_at: new Date(),
    };
    this.connections.set(remote.id, row);
    return mapConnection(row);
  }

  private async markDisabled(accountId: string, integrationId: string, disabled: boolean) {
    if (this.pool) {
      const result = await this.pool.query<ConnectionRow>(
        `UPDATE modo_postiz_connections SET disabled=$3,updated_at=NOW()
         WHERE account_id=$1 AND integration_id=$2 RETURNING *`,
        [accountId, integrationId, disabled],
      );
      if (!result.rowCount) throw this.connectionNotFound();
      return mapConnection(result.rows[0]);
    }
    const row = this.connections.get(integrationId);
    if (!row || row.account_id !== accountId) throw this.connectionNotFound();
    row.disabled = disabled;
    row.updated_at = new Date();
    return mapConnection(row);
  }

  private async savePending(pending: PendingConnection) {
    if (this.pool) {
      await this.pool.query(
        `INSERT INTO modo_postiz_pending_connections(
          id,account_id,brand_id,provider_identifier,baseline_ids,expires_at
        ) VALUES($1,$2,$3,$4,$5,$6)`,
        [
          pending.id,
          pending.accountId,
          pending.brandId,
          pending.platform,
          pending.baselineIds,
          pending.expiresAt,
        ],
      );
      return;
    }
    this.pending.set(pending.id, pending);
  }

  private async getPending(accountId: string, id: string) {
    if (this.pool) {
      const result = await this.pool.query<PendingRow>(
        `SELECT * FROM modo_postiz_pending_connections
         WHERE id=$1 AND account_id=$2 LIMIT 1`,
        [id, accountId],
      );
      if (!result.rowCount) return null;
      const row = result.rows[0];
      return {
        id: row.id,
        accountId: row.account_id,
        brandId: row.brand_id,
        platform: row.provider_identifier,
        baselineIds: row.baseline_ids,
        expiresAt: row.expires_at,
      } satisfies PendingConnection;
    }
    const pending = this.pending.get(id);
    return pending?.accountId === accountId ? pending : null;
  }

  private async deletePending(id: string) {
    if (this.pool) {
      await this.pool.query("DELETE FROM modo_postiz_pending_connections WHERE id=$1", [id]);
      return;
    }
    this.pending.delete(id);
  }

  private async cleanupPending() {
    if (this.pool) {
      await this.pool.query("DELETE FROM modo_postiz_pending_connections WHERE expires_at < NOW()");
      return;
    }
    for (const [id, item] of this.pending.entries()) {
      if (item.expiresAt.getTime() <= Date.now()) this.pending.delete(id);
    }
  }

  private async activePendingForPlatform(platform: PostizPlatform) {
    if (this.pool) {
      const result = await this.pool.query<{ id: string }>(
        `SELECT id FROM modo_postiz_pending_connections
         WHERE provider_identifier=$1 AND expires_at > NOW() LIMIT 1`,
        [platform],
      );
      return result.rows[0]?.id ?? null;
    }
    return [...this.pending.values()].find(
      (item) => item.platform === platform && item.expiresAt.getTime() > Date.now(),
    )?.id ?? null;
  }

  private async allConnectionIds() {
    if (this.pool) {
      const result = await this.pool.query<{ integration_id: string }>(
        "SELECT integration_id FROM modo_postiz_connections",
      );
      return result.rows.map((row) => row.integration_id);
    }
    return [...this.connections.keys()];
  }

  private async savePublication(
    accountId: string,
    request: ContentRequest,
    integration: PostizIntegration,
    postizPostId: string,
    input: PostizPublishRequest,
    date: string,
  ) {
    const id = randomUUID();
    const status = publicationStatus(input.mode);
    const scheduledFor = input.mode === "schedule" ? new Date(date) : null;
    const snapshot = JSON.stringify({
      contentType: request.contentType,
      objective: request.objective,
      channel: request.channel,
      title: request.output?.title,
      hook: request.output?.hook,
    });
    if (this.pool) {
      const result = await this.pool.query<PublicationRow>(
        `INSERT INTO modo_postiz_publications(
          id,account_id,brand_id,content_request_id,integration_id,provider_identifier,
          postiz_post_id,publish_mode,status,scheduled_for,content_snapshot
        ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb)
        ON CONFLICT(account_id,postiz_post_id) DO UPDATE SET updated_at=NOW()
        RETURNING *`,
        [
          id,
          accountId,
          request.brandId,
          request.id,
          integration.id,
          integration.identifier,
          postizPostId,
          input.mode,
          status,
          scheduledFor,
          snapshot,
        ],
      );
      return mapPublication(result.rows[0]);
    }
    const now = new Date();
    const row: PublicationRow = {
      id,
      account_id: accountId,
      brand_id: request.brandId,
      content_request_id: request.id,
      integration_id: integration.id,
      provider_identifier: integration.identifier,
      postiz_post_id: postizPostId,
      publish_mode: input.mode,
      status,
      scheduled_for: scheduledFor,
      release_url: null,
      published_at: null,
      created_at: now,
      updated_at: now,
    };
    this.publications.set(id, row);
    return mapPublication(row);
  }

  private async markPublished(accountId: string, publicationId: string, releaseUrl: string) {
    if (this.pool) {
      await this.pool.query(
        `UPDATE modo_postiz_publications
         SET status='published',release_url=$3,published_at=COALESCE(published_at,NOW()),updated_at=NOW()
         WHERE account_id=$1 AND id=$2`,
        [accountId, publicationId, releaseUrl],
      );
      return;
    }
    const row = this.publications.get(publicationId);
    if (row && row.account_id === accountId) {
      row.status = "published";
      row.release_url = releaseUrl;
      row.published_at = row.published_at ?? new Date();
      row.updated_at = new Date();
    }
  }

  private async getPublication(accountId: string, id: string) {
    if (this.pool) {
      const result = await this.pool.query<PublicationRow>(
        "SELECT * FROM modo_postiz_publications WHERE account_id=$1 AND id=$2 LIMIT 1",
        [accountId, id],
      );
      if (!result.rowCount) throw this.publicationNotFound();
      return mapPublication(result.rows[0]);
    }
    const row = this.publications.get(id);
    if (!row || row.account_id !== accountId) throw this.publicationNotFound();
    return mapPublication(row);
  }

  private async saveAnalytics(accountId: string, brandId: string, summary: PostizAnalyticsSummary) {
    if (!this.pool) return;
    await this.pool.query(
      `INSERT INTO modo_postiz_analytics_snapshots(
        id,account_id,brand_id,publication_id,postiz_post_id,days,score,
        engagement_rate,learning_signal,metrics,normalized,collected_at
      ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11::jsonb,$12)`,
      [
        randomUUID(),
        accountId,
        brandId,
        summary.publicationId,
        summary.postizPostId,
        summary.days,
        summary.score,
        summary.engagementRate,
        summary.learningSignal,
        JSON.stringify(summary.metrics),
        JSON.stringify(summary.normalized),
        summary.collectedAt,
      ],
    );
  }

  private connectionNotFound() {
    return new PostizError(
      "POSTIZ_CONNECTION_NOT_FOUND",
      404,
      "Canal não encontrado para esta marca.",
    );
  }

  private publicationNotFound() {
    return new PostizError(
      "POSTIZ_PUBLICATION_NOT_FOUND",
      404,
      "Publicação não encontrada.",
    );
  }
}
