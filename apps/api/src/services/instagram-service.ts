import type { InstagramPublication } from "@modo/contracts/instagram";
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import pg, { type Pool } from "pg";
import { assertPublicHttpUrl } from "../security/public-url.js";

const { Pool: PgPool } = pg;
const AUTH_URL = "https://www.instagram.com/oauth/authorize";
const TOKEN_URL = "https://api.instagram.com/oauth/access_token";
const STATE_TTL_MS = 15 * 60_000;
const REFRESH_THRESHOLD_MS = 5 * 24 * 60 * 60_000;
const DEFAULT_TOKEN_TTL_SECONDS = 60 * 24 * 60 * 60;
const DEFAULT_SCOPES = ["instagram_business_basic", "instagram_business_content_publish", "instagram_business_manage_insights", "instagram_business_manage_comments"];
const delay = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));

export interface InstagramServiceOptions {
  clientId?: string;
  clientSecret?: string;
  redirectUri?: string;
  encryptionSecret?: string;
  scopes?: string;
  apiVersion?: string;
  graphBaseUrl?: string;
  webUrl?: string;
  databaseUrl?: string;
  databaseSsl?: boolean;
}
interface AuthorizationState { accountId: string; brandId: string | null; expiresAt: number; nonce: string }
interface Connection {
  accountId: string;
  brandId: string | null;
  instagramUserId: string;
  instagramUsername: string;
  encryptedAccessToken: string;
  tokenExpiresAt: Date;
  connectedAt: Date;
  updatedAt: Date;
}
interface ConnectionRow {
  account_id: string;
  brand_id: string | null;
  instagram_user_id: string;
  instagram_username: string;
  encrypted_access_token: string;
  token_expires_at: Date;
  connected_at: Date;
  updated_at: Date;
}
interface PublicationRow {
  content_request_id: string | null;
  creation_id: string;
  instagram_media_id: string;
  permalink: string | null;
  published_at: Date;
  instagram_user_id: string;
  instagram_username: string;
}
interface GraphError { message?: string; type?: string; code?: number; error_subcode?: number }
interface GraphPayload { error?: GraphError }
interface ShortToken extends GraphPayload { access_token?: string; user_id?: string | number }
interface LongToken extends GraphPayload { access_token?: string; token_type?: string; expires_in?: number }
interface Identity extends GraphPayload { id?: string; username?: string }
interface MediaContainer extends GraphPayload { id?: string }
interface MediaStatus extends GraphPayload { status_code?: "EXPIRED" | "ERROR" | "FINISHED" | "IN_PROGRESS" | "PUBLISHED" }
interface MediaPublished extends GraphPayload { id?: string }
interface MediaDetails extends GraphPayload { id?: string; permalink?: string }
interface SignedRequestPayload { algorithm?: string; user_id?: string | number; issued_at?: number; [key: string]: unknown }

export class InstagramError extends Error {
  constructor(public readonly code: string, public readonly statusCode: number, message: string) {
    super(message);
    this.name = "InstagramError";
  }
}

export class InstagramService {
  private readonly pool?: Pool;
  private readonly connections = new Map<string, Connection>();
  private readonly publications = new Map<string, InstagramPublication>();
  private readonly refreshing = new Map<string, Promise<void>>();

  constructor(private readonly options: InstagramServiceOptions = {}) {
    if (options.databaseUrl) {
      this.pool = new PgPool({ connectionString: options.databaseUrl, ssl: options.databaseSsl ? { rejectUnauthorized: false } : undefined, max: 3 });
    }
  }

  get configured() {
    return Boolean(this.options.clientId && this.options.clientSecret && this.options.redirectUri && this.options.encryptionSecret);
  }
  get storage(): "memory" | "postgres" { return this.pool ? "postgres" : "memory" }

  async initialize() {
    if (!this.pool) return;
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS modo_instagram_connections (
        account_id TEXT PRIMARY KEY REFERENCES modo_organizations(id) ON DELETE CASCADE,
        brand_id TEXT REFERENCES modo_brands(id) ON DELETE SET NULL,
        instagram_user_id TEXT NOT NULL UNIQUE,
        instagram_username TEXT NOT NULL,
        encrypted_access_token TEXT NOT NULL,
        token_expires_at TIMESTAMPTZ NOT NULL,
        connected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS modo_instagram_publications (
        id TEXT PRIMARY KEY,
        account_id TEXT NOT NULL REFERENCES modo_organizations(id) ON DELETE CASCADE,
        content_request_id TEXT REFERENCES modo_content_requests(id) ON DELETE SET NULL,
        instagram_user_id TEXT NOT NULL,
        instagram_username TEXT NOT NULL,
        creation_id TEXT NOT NULL,
        instagram_media_id TEXT NOT NULL,
        permalink TEXT,
        published_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE(account_id, content_request_id)
      );
      CREATE INDEX IF NOT EXISTS modo_instagram_publications_account_idx ON modo_instagram_publications(account_id, published_at DESC);
      CREATE INDEX IF NOT EXISTS modo_instagram_connections_user_idx ON modo_instagram_connections(instagram_user_id);
    `);
  }
  async close() { await this.pool?.end() }

  async createAuthorizationUrl(accountId: string, brandId?: string) {
    this.requireConfigured();
    const state = this.signState({ accountId, brandId: brandId || null, expiresAt: Date.now() + STATE_TTL_MS, nonce: randomBytes(18).toString("base64url") });
    const url = new URL(AUTH_URL);
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
    let state: AuthorizationState;
    try { state = this.verifyState(input.state) }
    catch (error) { return this.frontendRedirect("error", error instanceof Error ? error.message : "Estado de autorização inválido.") }
    if (input.error || !input.code) return this.frontendRedirect("error", input.errorDescription || input.error || "A autorização do Instagram não foi concluída.");
    try {
      const shortLived = await this.exchangeCode(input.code);
      if (!shortLived.access_token) throw new InstagramError("INSTAGRAM_SHORT_TOKEN_MISSING", 502, "O Instagram não devolveu o token temporário esperado.");
      const longLived = await this.exchangeLongToken(shortLived.access_token);
      if (!longLived.access_token) throw new InstagramError("INSTAGRAM_LONG_TOKEN_MISSING", 502, "O Instagram não devolveu o token de longa duração esperado.");
      const identity = await this.fetchIdentity(longLived.access_token);
      if (!identity.id || !identity.username) throw new InstagramError("INSTAGRAM_IDENTITY_MISSING", 502, "O Instagram não devolveu o identificador e o nome de usuário da conta.");
      const now = new Date();
      await this.saveConnection({
        accountId: state.accountId,
        brandId: state.brandId,
        instagramUserId: String(identity.id),
        instagramUsername: identity.username,
        encryptedAccessToken: this.encrypt(longLived.access_token),
        tokenExpiresAt: new Date(Date.now() + Number(longLived.expires_in || DEFAULT_TOKEN_TTL_SECONDS) * 1000),
        connectedAt: now,
        updatedAt: now,
      });
      return this.frontendRedirect("connected");
    } catch (error) {
      return this.frontendRedirect("error", error instanceof Error ? error.message : "Não foi possível conectar a conta do Instagram.");
    }
  }

  async getStatus(accountId: string) {
    const connection = await this.getConnection(accountId);
    if (!this.configured) return { provider: "instagram" as const, integrationConfigured: false, connected: false, brandId: null, instagramUsername: null, expiresAt: null, scopes: [], message: "A integração Instagram aguarda as credenciais do aplicativo da MODO." };
    if (!connection) return { provider: "instagram" as const, integrationConfigured: true, connected: false, brandId: null, instagramUsername: null, expiresAt: null, scopes: this.scopes, message: "Conecte uma conta profissional do Instagram para publicar conteúdos aprovados." };
    const expired = connection.tokenExpiresAt.getTime() <= Date.now();
    return {
      provider: "instagram" as const,
      integrationConfigured: true,
      connected: !expired,
      brandId: connection.brandId,
      instagramUsername: connection.instagramUsername,
      expiresAt: connection.tokenExpiresAt.toISOString(),
      scopes: this.scopes,
      message: expired ? "A autorização do Instagram expirou. Reconecte a conta para continuar publicando." : `Instagram conectado como @${connection.instagramUsername}.`,
    };
  }

  async disconnect(accountId: string) {
    this.connections.delete(accountId);
    if (this.pool) await this.pool.query("DELETE FROM modo_instagram_connections WHERE account_id=$1", [accountId]);
    return { disconnected: true };
  }

  async refreshTokenIfNeeded(accountId: string) {
    const connection = await this.getConnection(accountId);
    if (!connection) throw new InstagramError("INSTAGRAM_NOT_CONNECTED", 409, "Conecte sua conta profissional do Instagram antes de publicar.");
    if (connection.tokenExpiresAt.getTime() > Date.now() + REFRESH_THRESHOLD_MS) return;
    const active = this.refreshing.get(accountId);
    if (active) return active;
    const refresh = this.refreshConnection(connection).finally(() => this.refreshing.delete(accountId));
    this.refreshing.set(accountId, refresh);
    return refresh;
  }

  async publishPost(input: { accountId: string; imageUrl: string; caption: string; contentRequestId?: string }): Promise<InstagramPublication> {
    this.requireConfigured();
    try { assertPublicHttpUrl(input.imageUrl) }
    catch (error) { throw new InstagramError("INSTAGRAM_INVALID_IMAGE_URL", 400, error instanceof Error ? error.message : "A URL da imagem não é pública e válida.") }
    const existing = input.contentRequestId ? await this.getPublication(input.accountId, input.contentRequestId) : null;
    if (existing) return existing;
    await this.refreshTokenIfNeeded(input.accountId);
    const connection = await this.getConnection(input.accountId);
    if (!connection) throw new InstagramError("INSTAGRAM_NOT_CONNECTED", 409, "Conecte sua conta profissional do Instagram antes de publicar.");
    const accessToken = this.decrypt(connection.encryptedAccessToken);
    const created = await this.graphRequest<MediaContainer>(
      `${this.graphApi}/${encodeURIComponent(connection.instagramUserId)}/media`,
      { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ image_url: input.imageUrl, caption: input.caption.slice(0, 2200), access_token: accessToken }), signal: AbortSignal.timeout(30_000) },
      "INSTAGRAM_MEDIA_CREATE_FAILED",
      "O Instagram não criou o contêiner da publicação.",
    );
    if (!created.id) throw new InstagramError("INSTAGRAM_CREATION_ID_MISSING", 502, "O Instagram não devolveu o identificador de criação da publicação.");
    await this.waitForContainer(created.id, accessToken);
    const published = await this.graphRequest<MediaPublished>(
      `${this.graphApi}/${encodeURIComponent(connection.instagramUserId)}/media_publish`,
      { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ creation_id: created.id, access_token: accessToken }), signal: AbortSignal.timeout(30_000) },
      "INSTAGRAM_MEDIA_PUBLISH_FAILED",
      "O Instagram não concluiu a publicação.",
    );
    if (!published.id) throw new InstagramError("INSTAGRAM_MEDIA_ID_MISSING", 502, "O Instagram não devolveu o identificador do post publicado.");
    const publication: InstagramPublication = {
      provider: "instagram",
      contentRequestId: input.contentRequestId || null,
      creationId: created.id,
      mediaId: published.id,
      instagramUserId: connection.instagramUserId,
      instagramUsername: connection.instagramUsername,
      permalink: await this.fetchPermalink(published.id, accessToken),
      publishedAt: new Date().toISOString(),
    };
    await this.savePublication(input.accountId, publication);
    return publication;
  }

  async handleDeauthorize(signedRequest: string) {
    const instagramUserId = this.requireSignedRequestUser(this.decodeSignedRequest(signedRequest));
    await this.deleteUserData(instagramUserId, false);
    return { deauthorized: true };
  }
  async handleDataDeletionRequest(signedRequest: string) {
    const instagramUserId = this.requireSignedRequestUser(this.decodeSignedRequest(signedRequest));
    await this.deleteUserData(instagramUserId, true);
    const confirmationCode = randomUUID().replaceAll("-", "");
    const url = new URL("/", (this.options.webUrl || "http://localhost:5173").replace(/\/$/, ""));
    url.searchParams.set("instagramDataDeletion", "completed");
    url.searchParams.set("confirmation_code", confirmationCode);
    return { url: url.toString(), confirmation_code: confirmationCode };
  }

  private async exchangeCode(code: string) {
    const response = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: this.options.clientId!, client_secret: this.options.clientSecret!, grant_type: "authorization_code", redirect_uri: this.options.redirectUri!, code }),
      signal: AbortSignal.timeout(20_000),
    });
    const payload = await response.json().catch(() => ({})) as ShortToken;
    if (!response.ok || payload.error) throw this.mapGraphError(payload.error, "INSTAGRAM_CODE_EXCHANGE_FAILED", response.status, "O Instagram recusou o código de autorização.");
    return payload;
  }
  private async exchangeLongToken(shortToken: string) {
    const url = new URL(`${this.graphBaseUrl}/access_token`);
    url.searchParams.set("grant_type", "ig_exchange_token");
    url.searchParams.set("client_secret", this.options.clientSecret!);
    url.searchParams.set("access_token", shortToken);
    const response = await fetch(url, { signal: AbortSignal.timeout(20_000) });
    const payload = await response.json().catch(() => ({})) as LongToken;
    if (!response.ok || payload.error) throw this.mapGraphError(payload.error, "INSTAGRAM_LONG_TOKEN_EXCHANGE_FAILED", response.status, "O Instagram não converteu o token para longa duração.");
    return payload;
  }
  private fetchIdentity(accessToken: string) {
    const url = new URL(`${this.graphApi}/me`);
    url.searchParams.set("fields", "id,username");
    url.searchParams.set("access_token", accessToken);
    return this.graphRequest<Identity>(url.toString(), { signal: AbortSignal.timeout(20_000) }, "INSTAGRAM_IDENTITY_FAILED", "O Instagram não retornou os dados da conta conectada.");
  }
  private async refreshConnection(connection: Connection) {
    const url = new URL(`${this.graphBaseUrl}/refresh_access_token`);
    url.searchParams.set("grant_type", "ig_refresh_token");
    url.searchParams.set("access_token", this.decrypt(connection.encryptedAccessToken));
    const payload = await this.graphRequest<LongToken>(url.toString(), { signal: AbortSignal.timeout(20_000) }, "INSTAGRAM_TOKEN_REFRESH_FAILED", "A autorização do Instagram expirou. Reconecte a conta.");
    if (!payload.access_token) throw new InstagramError("INSTAGRAM_REFRESH_TOKEN_MISSING", 401, "A autorização do Instagram expirou. Reconecte a conta.");
    await this.saveConnection({ ...connection, encryptedAccessToken: this.encrypt(payload.access_token), tokenExpiresAt: new Date(Date.now() + Number(payload.expires_in || DEFAULT_TOKEN_TTL_SECONDS) * 1000), updatedAt: new Date() });
  }
  private async waitForContainer(creationId: string, accessToken: string) {
    for (let attempt = 0; attempt < 12; attempt += 1) {
      const url = new URL(`${this.graphApi}/${encodeURIComponent(creationId)}`);
      url.searchParams.set("fields", "status_code");
      url.searchParams.set("access_token", accessToken);
      try {
        const payload = await this.graphRequest<MediaStatus>(url.toString(), { signal: AbortSignal.timeout(15_000) }, "INSTAGRAM_MEDIA_STATUS_FAILED", "Não foi possível acompanhar o processamento da imagem no Instagram.");
        if (!payload.status_code || ["FINISHED", "PUBLISHED"].includes(payload.status_code)) return;
        if (["ERROR", "EXPIRED"].includes(payload.status_code)) throw new InstagramError("INSTAGRAM_MEDIA_PROCESSING_FAILED", 422, "O Instagram não conseguiu processar a imagem enviada.");
      } catch (error) {
        if (error instanceof InstagramError && error.code === "INSTAGRAM_MEDIA_PROCESSING_FAILED") throw error;
        return;
      }
      await delay(1000);
    }
    throw new InstagramError("INSTAGRAM_MEDIA_PROCESSING_TIMEOUT", 504, "O Instagram demorou demais para processar a imagem. Tente novamente em alguns minutos.");
  }
  private async fetchPermalink(mediaId: string, accessToken: string) {
    const url = new URL(`${this.graphApi}/${encodeURIComponent(mediaId)}`);
    url.searchParams.set("fields", "id,permalink");
    url.searchParams.set("access_token", accessToken);
    try {
      const payload = await this.graphRequest<MediaDetails>(url.toString(), { signal: AbortSignal.timeout(15_000) }, "INSTAGRAM_PERMALINK_FAILED", "O post foi publicado, mas o link ainda não está disponível.");
      return payload.permalink || null;
    } catch { return null }
  }
  private async graphRequest<T extends GraphPayload>(url: string, init: RequestInit, code: string, message: string): Promise<T> {
    const response = await fetch(url, init);
    const payload = await response.json().catch(() => ({})) as T;
    if (!response.ok || payload.error) throw this.mapGraphError(payload.error, code, response.status, message);
    return payload;
  }
  private mapGraphError(error: GraphError | undefined, fallbackCode: string, status: number, fallbackMessage: string) {
    if (error?.code === 190) return new InstagramError("INSTAGRAM_TOKEN_INVALID", 401, "A autorização do Instagram expirou ou foi revogada. Reconecte a conta.");
    if ([10, 200].includes(Number(error?.code))) return new InstagramError("INSTAGRAM_PERMISSION_DENIED", 403, "A conta conectada não concedeu todas as permissões necessárias para publicar.");
    if (status === 429 || Number(error?.code) === 4) return new InstagramError("INSTAGRAM_RATE_LIMITED", 429, "O Instagram limitou temporariamente novas solicitações. Aguarde e tente novamente.");
    return new InstagramError(fallbackCode, status >= 400 && status < 500 ? status : 502, fallbackMessage);
  }

  private get scopes() { return (this.options.scopes || DEFAULT_SCOPES.join(",")).split(/[\s,]+/).map((item) => item.trim()).filter(Boolean) }
  private get apiVersion() { return (this.options.apiVersion || "v21.0").replace(/^\/+|\/+$/g, "") }
  private get graphBaseUrl() { return (this.options.graphBaseUrl || "https://graph.instagram.com").replace(/\/$/, "") }
  private get graphApi() { return `${this.graphBaseUrl}/${this.apiVersion}` }
  private requireConfigured() {
    if (!this.configured) throw new InstagramError("INSTAGRAM_NOT_CONFIGURED", 503, "A integração Instagram ainda não foi configurada pela MODO.");
  }
  private frontendRedirect(status: "connected" | "error", message?: string) {
    const url = new URL("/app/settings/integrations", (this.options.webUrl || "http://localhost:5173").replace(/\/$/, ""));
    url.searchParams.set("instagram", status);
    if (message) url.searchParams.set("instagramMessage", message.slice(0, 500));
    return url.toString();
  }
  private signState(payload: AuthorizationState) {
    const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
    return `${encoded}.${createHmac("sha256", this.stateSecret).update(encoded).digest("base64url")}`;
  }
  private verifyState(value?: string): AuthorizationState {
    if (!value) throw new InstagramError("INSTAGRAM_STATE_MISSING", 400, "Estado de autorização ausente. Inicie novamente pela MODO.");
    const [encoded, signature] = value.split(".");
    if (!encoded || !signature) throw new InstagramError("INSTAGRAM_STATE_INVALID", 400, "Estado de autorização inválido. Inicie novamente pela MODO.");
    let received: Buffer;
    try { received = Buffer.from(signature, "base64url") }
    catch { throw new InstagramError("INSTAGRAM_STATE_INVALID", 400, "Estado de autorização inválido. Inicie novamente pela MODO.") }
    const expected = createHmac("sha256", this.stateSecret).update(encoded).digest();
    if (expected.length !== received.length || !timingSafeEqual(expected, received)) throw new InstagramError("INSTAGRAM_STATE_INVALID", 400, "Estado de autorização inválido. Inicie novamente pela MODO.");
    let payload: AuthorizationState;
    try { payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as AuthorizationState }
    catch { throw new InstagramError("INSTAGRAM_STATE_INVALID", 400, "Estado de autorização inválido. Inicie novamente pela MODO.") }
    if (!payload.accountId || !payload.expiresAt || payload.expiresAt <= Date.now()) throw new InstagramError("INSTAGRAM_STATE_EXPIRED", 400, "A autorização expirou. Inicie novamente pela MODO.");
    return payload;
  }
  private decodeSignedRequest(value: string) {
    this.requireConfigured();
    const [signature, encoded] = String(value || "").split(".");
    if (!signature || !encoded) throw new InstagramError("INSTAGRAM_SIGNED_REQUEST_INVALID", 400, "A solicitação assinada enviada pela Meta é inválida.");
    let received: Buffer;
    try { received = Buffer.from(signature, "base64url") }
    catch { throw new InstagramError("INSTAGRAM_SIGNED_REQUEST_INVALID", 400, "A solicitação assinada enviada pela Meta é inválida.") }
    const expected = createHmac("sha256", this.options.clientSecret!).update(encoded).digest();
    if (expected.length !== received.length || !timingSafeEqual(expected, received)) throw new InstagramError("INSTAGRAM_SIGNED_REQUEST_INVALID", 400, "A assinatura da solicitação enviada pela Meta é inválida.");
    let payload: SignedRequestPayload;
    try { payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as SignedRequestPayload }
    catch { throw new InstagramError("INSTAGRAM_SIGNED_REQUEST_INVALID", 400, "O conteúdo da solicitação enviada pela Meta é inválido.") }
    if (payload.algorithm && payload.algorithm.toUpperCase() !== "HMAC-SHA256") throw new InstagramError("INSTAGRAM_SIGNED_REQUEST_ALGORITHM_INVALID", 400, "O algoritmo da solicitação assinada não é aceito.");
    return payload;
  }
  private requireSignedRequestUser(payload: SignedRequestPayload) {
    const id = String(payload.user_id || "").trim();
    if (!id) throw new InstagramError("INSTAGRAM_SIGNED_REQUEST_USER_MISSING", 400, "A Meta não informou o usuário do Instagram nesta solicitação.");
    return id;
  }
  private get stateSecret() { return this.options.encryptionSecret || this.options.clientSecret || "instagram-disabled" }
  private get encryptionKey() { return createHash("sha256").update(this.options.encryptionSecret || "disabled").digest() }
  private encrypt(value: string) {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.encryptionKey, iv);
    const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
    return [iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), encrypted.toString("base64url")].join(".");
  }
  private decrypt(value: string) {
    const [iv, tag, data] = value.split(".");
    if (!iv || !tag || !data) throw new InstagramError("INSTAGRAM_INVALID_TOKEN", 500, "A credencial armazenada do Instagram é inválida.");
    const decipher = createDecipheriv("aes-256-gcm", this.encryptionKey, Buffer.from(iv, "base64url"));
    decipher.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([decipher.update(Buffer.from(data, "base64url")), decipher.final()]).toString("utf8");
  }

  private async saveConnection(connection: Connection) {
    this.connections.set(connection.accountId, connection);
    if (!this.pool) return;
    await this.pool.query(
      `INSERT INTO modo_instagram_connections(account_id,brand_id,instagram_user_id,instagram_username,encrypted_access_token,token_expires_at,connected_at,updated_at)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT(account_id) DO UPDATE SET brand_id=EXCLUDED.brand_id,instagram_user_id=EXCLUDED.instagram_user_id,instagram_username=EXCLUDED.instagram_username,encrypted_access_token=EXCLUDED.encrypted_access_token,token_expires_at=EXCLUDED.token_expires_at,updated_at=NOW()`,
      [connection.accountId, connection.brandId, connection.instagramUserId, connection.instagramUsername, connection.encryptedAccessToken, connection.tokenExpiresAt, connection.connectedAt, connection.updatedAt],
    );
  }
  private async getConnection(accountId: string): Promise<Connection | null> {
    if (this.pool) {
      const result = await this.pool.query<ConnectionRow>("SELECT account_id,brand_id,instagram_user_id,instagram_username,encrypted_access_token,token_expires_at,connected_at,updated_at FROM modo_instagram_connections WHERE account_id=$1 LIMIT 1", [accountId]);
      const row = result.rows[0];
      if (row) return { accountId: row.account_id, brandId: row.brand_id, instagramUserId: row.instagram_user_id, instagramUsername: row.instagram_username, encryptedAccessToken: row.encrypted_access_token, tokenExpiresAt: row.token_expires_at, connectedAt: row.connected_at, updatedAt: row.updated_at };
    }
    return this.connections.get(accountId) || null;
  }
  private publicationKey(accountId: string, contentRequestId: string) { return `${accountId}:${contentRequestId}` }
  private async savePublication(accountId: string, publication: InstagramPublication) {
    if (publication.contentRequestId) this.publications.set(this.publicationKey(accountId, publication.contentRequestId), publication);
    if (!this.pool) return;
    await this.pool.query(
      `INSERT INTO modo_instagram_publications(id,account_id,content_request_id,instagram_user_id,instagram_username,creation_id,instagram_media_id,permalink,published_at)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)
       ON CONFLICT(account_id,content_request_id) DO UPDATE SET instagram_user_id=EXCLUDED.instagram_user_id,instagram_username=EXCLUDED.instagram_username,creation_id=EXCLUDED.creation_id,instagram_media_id=EXCLUDED.instagram_media_id,permalink=EXCLUDED.permalink,published_at=EXCLUDED.published_at`,
      [randomUUID(), accountId, publication.contentRequestId, publication.instagramUserId, publication.instagramUsername, publication.creationId, publication.mediaId, publication.permalink, publication.publishedAt],
    );
  }
  private async getPublication(accountId: string, contentRequestId: string) {
    if (this.pool) {
      const result = await this.pool.query<PublicationRow>("SELECT content_request_id,creation_id,instagram_media_id,permalink,published_at,instagram_user_id,instagram_username FROM modo_instagram_publications WHERE account_id=$1 AND content_request_id=$2 LIMIT 1", [accountId, contentRequestId]);
      const row = result.rows[0];
      if (row) return { provider: "instagram" as const, contentRequestId: row.content_request_id, creationId: row.creation_id, mediaId: row.instagram_media_id, instagramUserId: row.instagram_user_id, instagramUsername: row.instagram_username, permalink: row.permalink, publishedAt: row.published_at.toISOString() };
    }
    return this.publications.get(this.publicationKey(accountId, contentRequestId)) || null;
  }
  private async deleteUserData(instagramUserId: string, deletePublications: boolean) {
    const memory = [...this.connections.values()].find((item) => item.instagramUserId === instagramUserId);
    if (memory) {
      this.connections.delete(memory.accountId);
      if (deletePublications) for (const key of [...this.publications.keys()]) if (key.startsWith(`${memory.accountId}:`)) this.publications.delete(key);
    }
    if (!this.pool) return;
    const result = await this.pool.query<{ account_id: string }>("SELECT account_id FROM modo_instagram_connections WHERE instagram_user_id=$1 LIMIT 1", [instagramUserId]);
    const accountId = result.rows[0]?.account_id;
    if (accountId && deletePublications) await this.pool.query("DELETE FROM modo_instagram_publications WHERE account_id=$1", [accountId]);
    await this.pool.query("DELETE FROM modo_instagram_connections WHERE instagram_user_id=$1", [instagramUserId]);
  }
}
