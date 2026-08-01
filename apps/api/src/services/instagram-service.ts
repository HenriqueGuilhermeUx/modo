import type {
  InstagramConnectionStatus,
  InstagramDataDeletionResponse,
  InstagramPublishResult,
} from "@modo/contracts/instagram";
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import pg, { type Pool } from "pg";
import { assertPublicHttpUrl } from "../security/public-url.js";

const { Pool: PgPool } = pg;
const INSTAGRAM_AUTH_URL = "https://www.instagram.com/oauth/authorize";
const INSTAGRAM_TOKEN_URL = "https://api.instagram.com/oauth/access_token";
const OAUTH_STATE_MINUTES = 15;
const REFRESH_THRESHOLD_MS = 5 * 24 * 60 * 60 * 1000;
const DEFAULT_TOKEN_SECONDS = 60 * 24 * 60 * 60;
const CONTAINER_POLL_ATTEMPTS = 12;
const CONTAINER_POLL_DELAY_MS = 1_000;

const delay = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));

type JsonRecord = Record<string, unknown>;

interface InstagramServiceOptions {
  clientId?: string;
  clientSecret?: string;
  redirectUri?: string;
  encryptionSecret?: string;
  scopes?: string;
  webUrl?: string;
  apiVersion?: string;
  graphBaseUrl?: string;
  databaseUrl?: string;
  databaseSsl?: boolean;
}

interface OAuthStatePayload {
  nonce: string;
  accountId: string;
  brandId: string | null;
  expiresAt: number;
}

interface OAuthStateRow {
  nonce: string;
  account_id: string;
  brand_id: string | null;
  expires_at: Date;
}

interface InstagramConnection {
  accountId: string;
  brandId: string | null;
  instagramUserId: string;
  instagramUsername: string;
  profilePictureUrl: string | null;
  accessTokenEncrypted: string;
  tokenExpiresAt: Date;
  scopes: string[];
  connectedAt: Date;
  updatedAt: Date;
}

interface InstagramConnectionRow {
  account_id: string;
  brand_id: string | null;
  instagram_user_id: string;
  instagram_username: string;
  profile_picture_url: string | null;
  access_token_encrypted: string;
  token_expires_at: Date;
  scopes: string[];
  connected_at: Date;
  updated_at: Date;
}

interface TokenResponse {
  access_token?: string;
  user_id?: string | number;
  expires_in?: number;
  token_type?: string;
  permissions?: string[];
  error_type?: string;
  code?: number;
  error_message?: string;
  error?: GraphApiError;
}

interface GraphApiError {
  message?: string;
  type?: string;
  code?: number;
  error_subcode?: number;
  fbtrace_id?: string;
}

interface SignedRequestPayload {
  user_id?: string | number;
  algorithm?: string;
  issued_at?: number;
  [key: string]: unknown;
}

interface IdentityPayload extends JsonRecord {
  id?: string;
  username?: string;
  profile_picture_url?: string;
}

interface PublishPostInput {
  accountId: string;
  imageUrl: string;
  caption: string;
  contentRequestId?: string;
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

function safeProviderMessage(payload: TokenResponse | JsonRecord, fallback: string) {
  const nested = (payload as TokenResponse).error?.message;
  return nested || stringValue((payload as TokenResponse).error_message) || fallback;
}

function statusCodeForProvider(responseStatus: number) {
  if (responseStatus === 400) return 422;
  if (responseStatus === 401 || responseStatus === 403) return 409;
  if (responseStatus === 429) return 429;
  return 502;
}

export class InstagramError extends Error {
  constructor(
    public readonly code: string,
    public readonly statusCode: number,
    message: string,
  ) {
    super(message);
    this.name = "InstagramError";
  }
}

export class InstagramService {
  private readonly pool?: Pool;
  private readonly states = new Map<string, OAuthStatePayload>();
  private readonly connections = new Map<string, InstagramConnection>();
  private readonly publications = new Map<string, InstagramPublishResult>();

  constructor(private readonly options: InstagramServiceOptions = {}) {
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

  get scopes() {
    return (
      this.options.scopes ||
      "instagram_business_basic,instagram_business_content_publish,instagram_business_manage_insights,instagram_business_manage_comments"
    )
      .split(/[\s,]+/)
      .map((scope) => scope.trim())
      .filter(Boolean);
  }

  get apiVersion() {
    const version = stringValue(this.options.apiVersion) || "v21.0";
    return version.startsWith("v") ? version : `v${version}`;
  }

  get graphBaseUrl() {
    return (this.options.graphBaseUrl || "https://graph.instagram.com").replace(/\/$/, "");
  }

  async initialize() {
    if (!this.pool) return;
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS modo_instagram_oauth_states (
        nonce TEXT PRIMARY KEY,
        account_id TEXT NOT NULL REFERENCES modo_organizations(id) ON DELETE CASCADE,
        brand_id TEXT REFERENCES modo_brands(id) ON DELETE SET NULL,
        expires_at TIMESTAMPTZ NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS modo_instagram_connections (
        account_id TEXT PRIMARY KEY REFERENCES modo_organizations(id) ON DELETE CASCADE,
        brand_id TEXT REFERENCES modo_brands(id) ON DELETE SET NULL,
        instagram_user_id TEXT NOT NULL,
        instagram_username TEXT NOT NULL,
        profile_picture_url TEXT,
        access_token_encrypted TEXT NOT NULL,
        token_expires_at TIMESTAMPTZ NOT NULL,
        scopes TEXT[] NOT NULL DEFAULT '{}',
        connected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE UNIQUE INDEX IF NOT EXISTS modo_instagram_connections_user_idx
        ON modo_instagram_connections(instagram_user_id);

      CREATE TABLE IF NOT EXISTS modo_instagram_publications (
        id TEXT PRIMARY KEY,
        account_id TEXT NOT NULL REFERENCES modo_organizations(id) ON DELETE CASCADE,
        instagram_user_id TEXT NOT NULL,
        content_request_id TEXT REFERENCES modo_content_requests(id) ON DELETE SET NULL,
        creation_id TEXT NOT NULL,
        post_id TEXT NOT NULL,
        permalink TEXT,
        published_at TIMESTAMPTZ NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS modo_instagram_publications_account_idx
        ON modo_instagram_publications(account_id, published_at DESC);

      CREATE TABLE IF NOT EXISTS modo_instagram_data_deletions (
        confirmation_code TEXT PRIMARY KEY,
        instagram_user_id TEXT NOT NULL,
        requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        completed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      DELETE FROM modo_instagram_oauth_states WHERE expires_at < NOW();
    `);
  }

  async close() {
    await this.pool?.end();
  }

  async createAuthorizationUrl(accountId: string, brandId?: string) {
    this.requireConfigured();
    const payload: OAuthStatePayload = {
      nonce: randomBytes(32).toString("base64url"),
      accountId,
      brandId: brandId || null,
      expiresAt: Date.now() + OAUTH_STATE_MINUTES * 60_000,
    };
    await this.saveState(payload);

    const url = new URL(INSTAGRAM_AUTH_URL);
    url.searchParams.set("client_id", this.options.clientId!);
    url.searchParams.set("redirect_uri", this.options.redirectUri!);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", this.scopes.join(","));
    url.searchParams.set("state", this.signState(payload));
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
    if (!input.state) {
      return this.frontendRedirect("error", "Estado de autorização ausente.");
    }

    let state: OAuthStatePayload;
    try {
      state = await this.consumeSignedState(input.state);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Estado de autorização inválido.";
      return this.frontendRedirect("error", message);
    }

    if (input.error || !input.code) {
      return this.frontendRedirect(
        "error",
        input.errorDescription || input.error || "A autorização do Instagram não foi concluída.",
      );
    }

    try {
      const shortLived = await this.exchangeAuthorizationCode(input.code.replace(/#_$/, ""));
      const shortToken = shortLived.access_token;
      if (!shortToken) {
        throw new InstagramError(
          "INSTAGRAM_SHORT_TOKEN_MISSING",
          502,
          "O Instagram não retornou o token temporário esperado.",
        );
      }

      const longLived = await this.exchangeLongLivedToken(shortToken);
      const accessToken = longLived.access_token;
      if (!accessToken) {
        throw new InstagramError(
          "INSTAGRAM_LONG_TOKEN_MISSING",
          502,
          "O Instagram não retornou o token de longa duração esperado.",
        );
      }

      const identity = await this.fetchIdentity(accessToken);
      const instagramUserId = stringValue(identity.id);
      const username = stringValue(identity.username);
      if (!instagramUserId || !username) {
        throw new InstagramError(
          "INSTAGRAM_IDENTITY_INCOMPLETE",
          502,
          "O Instagram não retornou o ID e o username reais da conta profissional.",
        );
      }

      const now = new Date();
      await this.saveConnection({
        accountId: state.accountId,
        brandId: state.brandId,
        instagramUserId,
        instagramUsername: username,
        profilePictureUrl: nullablePublicUrl(identity.profile_picture_url),
        accessTokenEncrypted: this.encrypt(accessToken),
        tokenExpiresAt: new Date(
          Date.now() + Number(longLived.expires_in || DEFAULT_TOKEN_SECONDS) * 1000,
        ),
        scopes: shortLived.permissions?.length ? shortLived.permissions : this.scopes,
        connectedAt: now,
        updatedAt: now,
      });
      return this.frontendRedirect("connected");
    } catch (error) {
      const message = error instanceof Error
        ? error.message
        : "Não foi possível concluir a conexão com o Instagram.";
      return this.frontendRedirect("error", message);
    }
  }

  async getStatus(accountId: string): Promise<InstagramConnectionStatus> {
    const connection = await this.getConnection(accountId);
    if (!this.configured) {
      return {
        provider: "instagram",
        integrationConfigured: false,
        connected: false,
        brandId: null,
        instagramUserId: null,
        username: null,
        profilePictureUrl: null,
        expiresAt: null,
        scopes: this.scopes,
        canPublish: false,
        message: "A integração Instagram aguarda as credenciais do aplicativo no ambiente da MODO.",
      };
    }
    if (!connection) {
      return {
        provider: "instagram",
        integrationConfigured: true,
        connected: false,
        brandId: null,
        instagramUserId: null,
        username: null,
        profilePictureUrl: null,
        expiresAt: null,
        scopes: this.scopes,
        canPublish: false,
        message: "Conecte uma conta profissional do Instagram para publicar conteúdos aprovados.",
      };
    }

    const expired = connection.tokenExpiresAt <= new Date();
    return {
      provider: "instagram",
      integrationConfigured: true,
      connected: !expired,
      brandId: connection.brandId,
      instagramUserId: connection.instagramUserId,
      username: connection.instagramUsername,
      profilePictureUrl: connection.profilePictureUrl,
      expiresAt: connection.tokenExpiresAt.toISOString(),
      scopes: connection.scopes,
      canPublish: !expired && connection.scopes.includes("instagram_business_content_publish"),
      message: expired
        ? "A autorização do Instagram expirou. Reconecte a conta para continuar publicando."
        : `Instagram @${connection.instagramUsername} conectado.`,
    };
  }

  async disconnect(accountId: string) {
    this.connections.delete(accountId);
    if (this.pool) {
      await this.pool.query("DELETE FROM modo_instagram_connections WHERE account_id=$1", [accountId]);
    }
    return { disconnected: true };
  }

  async refreshTokenIfNeeded(accountId: string) {
    const connection = await this.requireConnection(accountId);
    if (connection.tokenExpiresAt.getTime() - Date.now() >= REFRESH_THRESHOLD_MS) {
      return this.getStatus(accountId);
    }

    const currentToken = this.decrypt(connection.accessTokenEncrypted);
    const url = new URL(`${this.graphBaseUrl}/refresh_access_token`);
    url.searchParams.set("grant_type", "ig_refresh_token");
    url.searchParams.set("access_token", currentToken);
    const response = await fetch(url, { signal: AbortSignal.timeout(20_000) });
    const payload = (await response.json().catch(() => ({}))) as TokenResponse;
    if (!response.ok || !payload.access_token) {
      throw new InstagramError(
        "INSTAGRAM_TOKEN_REFRESH_FAILED",
        statusCodeForProvider(response.status),
        safeProviderMessage(payload, "Não foi possível renovar a autorização do Instagram."),
      );
    }

    await this.saveConnection({
      ...connection,
      accessTokenEncrypted: this.encrypt(payload.access_token),
      tokenExpiresAt: new Date(
        Date.now() + Number(payload.expires_in || DEFAULT_TOKEN_SECONDS) * 1000,
      ),
      updatedAt: new Date(),
    });
    return this.getStatus(accountId);
  }

  async publishPost(input: PublishPostInput): Promise<InstagramPublishResult> {
    const publicImageUrl = assertPublicHttpUrl(input.imageUrl).toString();
    await this.refreshTokenIfNeeded(input.accountId);
    const connection = await this.requireConnection(input.accountId);
    const accessToken = this.decrypt(connection.accessTokenEncrypted);

    const creation = await this.graphPost(
      `${this.graphBaseUrl}/${this.apiVersion}/${encodeURIComponent(connection.instagramUserId)}/media`,
      {
        image_url: publicImageUrl,
        caption: input.caption.slice(0, 2_200),
        access_token: accessToken,
      },
      "INSTAGRAM_MEDIA_CREATION_FAILED",
      "O Instagram não criou o contêiner da publicação.",
    );
    const creationId = stringValue(creation.id);
    if (!creationId) {
      throw new InstagramError(
        "INSTAGRAM_CREATION_ID_MISSING",
        502,
        "O Instagram não retornou o identificador de criação da publicação.",
      );
    }

    await this.waitForContainer(creationId, accessToken);

    const published = await this.graphPost(
      `${this.graphBaseUrl}/${this.apiVersion}/${encodeURIComponent(connection.instagramUserId)}/media_publish`,
      {
        creation_id: creationId,
        access_token: accessToken,
      },
      "INSTAGRAM_MEDIA_PUBLISH_FAILED",
      "O Instagram não concluiu a publicação.",
    );
    const postId = stringValue(published.id);
    if (!postId) {
      throw new InstagramError(
        "INSTAGRAM_POST_ID_MISSING",
        502,
        "O Instagram não retornou o ID do post publicado.",
      );
    }

    const permalink = await this.fetchPermalink(postId, accessToken);
    const result: InstagramPublishResult = {
      provider: "instagram",
      contentRequestId: input.contentRequestId || "00000000-0000-0000-0000-000000000000",
      creationId,
      postId,
      permalink,
      publishedAt: new Date().toISOString(),
    };
    await this.savePublication(input.accountId, connection.instagramUserId, result);
    return result;
  }

  async handleDeauthorize(signedRequest: string) {
    const payload = this.decodeMetaSignedRequest(signedRequest);
    const instagramUserId = String(payload.user_id || "").trim();
    if (!instagramUserId) {
      throw new InstagramError(
        "INSTAGRAM_DEAUTHORIZE_USER_MISSING",
        400,
        "A Meta não informou o usuário que revogou a autorização.",
      );
    }
    await this.deleteUserData(instagramUserId);
    return { deauthorized: true };
  }

  async handleDataDeletionRequest(
    signedRequest: string,
  ): Promise<InstagramDataDeletionResponse> {
    const payload = this.decodeMetaSignedRequest(signedRequest);
    const instagramUserId = String(payload.user_id || "").trim();
    if (!instagramUserId) {
      throw new InstagramError(
        "INSTAGRAM_DELETION_USER_MISSING",
        400,
        "A Meta não informou o usuário da solicitação de exclusão.",
      );
    }

    await this.deleteUserData(instagramUserId);
    const confirmationCode = randomBytes(18).toString("hex");
    if (this.pool) {
      await this.pool.query(
        `INSERT INTO modo_instagram_data_deletions(
          confirmation_code,instagram_user_id,requested_at,completed_at
        ) VALUES($1,$2,NOW(),NOW())`,
        [confirmationCode, instagramUserId],
      );
    }
    const url = new URL("/exclusao-de-dados", this.options.webUrl || "http://localhost:5173");
    url.searchParams.set("confirmation_code", confirmationCode);
    return { url: url.toString(), confirmation_code: confirmationCode };
  }

  private requireConfigured() {
    if (!this.configured) {
      throw new InstagramError(
        "INSTAGRAM_NOT_CONFIGURED",
        503,
        "A integração Instagram ainda não foi configurada no ambiente da MODO.",
      );
    }
  }

  private async requireConnection(accountId: string) {
    this.requireConfigured();
    const connection = await this.getConnection(accountId);
    if (!connection) {
      throw new InstagramError(
        "INSTAGRAM_NOT_CONNECTED",
        409,
        "Conecte uma conta profissional do Instagram antes de publicar.",
      );
    }
    if (connection.tokenExpiresAt <= new Date()) {
      throw new InstagramError(
        "INSTAGRAM_TOKEN_EXPIRED",
        409,
        "A autorização do Instagram expirou. Reconecte a conta para continuar.",
      );
    }
    return connection;
  }

  private async exchangeAuthorizationCode(code: string): Promise<TokenResponse> {
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
    const payload = (await response.json().catch(() => ({}))) as TokenResponse;
    if (!response.ok || !payload.access_token) {
      throw new InstagramError(
        "INSTAGRAM_CODE_EXCHANGE_FAILED",
        statusCodeForProvider(response.status),
        safeProviderMessage(payload, "Não foi possível trocar o código de autorização do Instagram."),
      );
    }
    return payload;
  }

  private async exchangeLongLivedToken(shortLivedToken: string): Promise<TokenResponse> {
    const url = new URL(`${this.graphBaseUrl}/access_token`);
    url.searchParams.set("grant_type", "ig_exchange_token");
    url.searchParams.set("client_secret", this.options.clientSecret!);
    url.searchParams.set("access_token", shortLivedToken);
    const response = await fetch(url, { signal: AbortSignal.timeout(20_000) });
    const payload = (await response.json().catch(() => ({}))) as TokenResponse;
    if (!response.ok || !payload.access_token) {
      throw new InstagramError(
        "INSTAGRAM_LONG_TOKEN_EXCHANGE_FAILED",
        statusCodeForProvider(response.status),
        safeProviderMessage(payload, "Não foi possível criar o token de longa duração do Instagram."),
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
    const payload = (await response.json().catch(() => ({}))) as IdentityPayload;
    if (!response.ok || !payload.id || !payload.username) {
      throw new InstagramError(
        "INSTAGRAM_IDENTITY_FAILED",
        statusCodeForProvider(response.status),
        safeProviderMessage(payload, "Não foi possível identificar a conta profissional do Instagram."),
      );
    }
    return payload;
  }

  private async waitForContainer(creationId: string, accessToken: string) {
    for (let attempt = 0; attempt < CONTAINER_POLL_ATTEMPTS; attempt += 1) {
      const url = new URL(`${this.graphBaseUrl}/${this.apiVersion}/${encodeURIComponent(creationId)}`);
      url.searchParams.set("fields", "status_code");
      url.searchParams.set("access_token", accessToken);
      const response = await fetch(url, { signal: AbortSignal.timeout(15_000) });
      const payload = (await response.json().catch(() => ({}))) as JsonRecord;

      if (!response.ok) {
        if (attempt === 0) return;
        throw new InstagramError(
          "INSTAGRAM_CONTAINER_STATUS_FAILED",
          statusCodeForProvider(response.status),
          safeProviderMessage(payload, "Não foi possível acompanhar o processamento da imagem."),
        );
      }

      const status = stringValue(payload.status_code).toUpperCase();
      if (!status || status === "FINISHED" || status === "PUBLISHED") return;
      if (["ERROR", "EXPIRED"].includes(status)) {
        throw new InstagramError(
          "INSTAGRAM_CONTAINER_PROCESSING_FAILED",
          422,
          "O Instagram não conseguiu processar a imagem aprovada.",
        );
      }
      await delay(CONTAINER_POLL_DELAY_MS);
    }
    throw new InstagramError(
      "INSTAGRAM_CONTAINER_TIMEOUT",
      504,
      "O Instagram demorou demais para processar a imagem. Tente publicar novamente.",
    );
  }

  private async fetchPermalink(postId: string, accessToken: string) {
    const url = new URL(`${this.graphBaseUrl}/${this.apiVersion}/${encodeURIComponent(postId)}`);
    url.searchParams.set("fields", "id,permalink");
    url.searchParams.set("access_token", accessToken);
    const response = await fetch(url, { signal: AbortSignal.timeout(15_000) });
    const payload = (await response.json().catch(() => ({}))) as JsonRecord;
    if (!response.ok) return null;
    return nullablePublicUrl(payload.permalink);
  }

  private async graphPost(
    url: string,
    values: Record<string, string>,
    code: string,
    fallback: string,
  ): Promise<JsonRecord> {
    const response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(values),
      signal: AbortSignal.timeout(30_000),
    });
    const payload = (await response.json().catch(() => ({}))) as JsonRecord;
    if (!response.ok) {
      throw new InstagramError(
        code,
        statusCodeForProvider(response.status),
        safeProviderMessage(payload, fallback),
      );
    }
    return payload;
  }

  private stateKey() {
    if (!this.options.encryptionSecret) {
      throw new InstagramError(
        "INSTAGRAM_STATE_SECRET_MISSING",
        503,
        "A assinatura do estado OAuth do Instagram não foi configurada.",
      );
    }
    return this.options.encryptionSecret;
  }

  private signState(payload: OAuthStatePayload) {
    const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
    const signature = createHmac("sha256", this.stateKey()).update(encoded).digest("base64url");
    return `${encoded}.${signature}`;
  }

  private async consumeSignedState(value: string): Promise<OAuthStatePayload> {
    const [encoded, receivedSignature] = value.split(".");
    if (!encoded || !receivedSignature) {
      throw new InstagramError("INSTAGRAM_STATE_INVALID", 400, "Estado OAuth inválido.");
    }
    const expectedSignature = createHmac("sha256", this.stateKey()).update(encoded).digest();
    let received: Buffer;
    try {
      received = Buffer.from(receivedSignature, "base64url");
    } catch {
      throw new InstagramError("INSTAGRAM_STATE_INVALID", 400, "Assinatura OAuth inválida.");
    }
    if (received.length !== expectedSignature.length || !timingSafeEqual(received, expectedSignature)) {
      throw new InstagramError("INSTAGRAM_STATE_INVALID", 400, "Assinatura OAuth inválida.");
    }

    let payload: OAuthStatePayload;
    try {
      payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as OAuthStatePayload;
    } catch {
      throw new InstagramError("INSTAGRAM_STATE_INVALID", 400, "Conteúdo do estado OAuth inválido.");
    }
    if (!payload.nonce || !payload.accountId || payload.expiresAt <= Date.now()) {
      throw new InstagramError("INSTAGRAM_STATE_EXPIRED", 400, "A autorização expirou. Inicie novamente pela MODO.");
    }

    const stored = await this.consumeState(payload.nonce);
    if (!stored || stored.accountId !== payload.accountId || stored.brandId !== payload.brandId) {
      throw new InstagramError("INSTAGRAM_STATE_REUSED", 400, "Esta autorização já foi utilizada ou não é válida.");
    }
    return payload;
  }

  private decodeMetaSignedRequest(value: string): SignedRequestPayload {
    this.requireConfigured();
    const [encodedSignature, encodedPayload] = value.split(".");
    if (!encodedSignature || !encodedPayload) {
      throw new InstagramError("INSTAGRAM_SIGNED_REQUEST_INVALID", 400, "signed_request inválido.");
    }
    const expected = createHmac("sha256", this.options.clientSecret!).update(encodedPayload).digest();
    let received: Buffer;
    try {
      received = Buffer.from(encodedSignature.replace(/-/g, "+").replace(/_/g, "/"), "base64");
    } catch {
      throw new InstagramError("INSTAGRAM_SIGNED_REQUEST_INVALID", 400, "Assinatura da Meta inválida.");
    }
    if (received.length !== expected.length || !timingSafeEqual(received, expected)) {
      throw new InstagramError("INSTAGRAM_SIGNED_REQUEST_INVALID", 400, "Assinatura da Meta inválida.");
    }
    try {
      const payload = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8")) as SignedRequestPayload;
      if (payload.algorithm && payload.algorithm.toUpperCase() !== "HMAC-SHA256") {
        throw new Error("Algoritmo não suportado");
      }
      return payload;
    } catch {
      throw new InstagramError("INSTAGRAM_SIGNED_REQUEST_INVALID", 400, "Conteúdo do signed_request inválido.");
    }
  }

  private encryptionKey() {
    if (!this.options.encryptionSecret) {
      throw new InstagramError(
        "INSTAGRAM_ENCRYPTION_SECRET_MISSING",
        503,
        "A criptografia dos tokens do Instagram não foi configurada.",
      );
    }
    return createHash("sha256").update(this.options.encryptionSecret).digest();
  }

  private encrypt(value: string) {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.encryptionKey(), iv);
    const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
    const tag = cipher.getAuthTag();
    return [iv, tag, encrypted].map((item) => item.toString("base64url")).join(".");
  }

  private decrypt(value: string) {
    const [ivValue, tagValue, encryptedValue] = value.split(".");
    if (!ivValue || !tagValue || !encryptedValue) {
      throw new InstagramError("INSTAGRAM_TOKEN_INVALID", 500, "O token armazenado do Instagram é inválido.");
    }
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

  private frontendRedirect(status: "connected" | "error", message?: string) {
    const target = new URL(
      "/app/settings/integrations",
      this.options.webUrl || "http://localhost:5173",
    );
    target.searchParams.set("instagram", status);
    if (message) target.searchParams.set("instagramMessage", message.slice(0, 400));
    return target.toString();
  }

  private async saveState(payload: OAuthStatePayload) {
    this.states.set(payload.nonce, payload);
    if (!this.pool) return;
    await this.pool.query(
      `INSERT INTO modo_instagram_oauth_states(nonce,account_id,brand_id,expires_at)
       VALUES($1,$2,$3,$4)
       ON CONFLICT(nonce) DO UPDATE SET
         account_id=EXCLUDED.account_id,
         brand_id=EXCLUDED.brand_id,
         expires_at=EXCLUDED.expires_at`,
      [payload.nonce, payload.accountId, payload.brandId, new Date(payload.expiresAt)],
    );
  }

  private async consumeState(nonce: string): Promise<OAuthStatePayload | null> {
    if (this.pool) {
      const result = await this.pool.query<OAuthStateRow>(
        `DELETE FROM modo_instagram_oauth_states WHERE nonce=$1
         RETURNING nonce,account_id,brand_id,expires_at`,
        [nonce],
      );
      const row = result.rows[0];
      return row ? {
        nonce: row.nonce,
        accountId: row.account_id,
        brandId: row.brand_id,
        expiresAt: row.expires_at.getTime(),
      } : null;
    }
    const state = this.states.get(nonce) ?? null;
    this.states.delete(nonce);
    return state;
  }

  private async saveConnection(connection: InstagramConnection) {
    this.connections.set(connection.accountId, connection);
    if (!this.pool) return;
    await this.pool.query(
      `INSERT INTO modo_instagram_connections(
        account_id,brand_id,instagram_user_id,instagram_username,profile_picture_url,
        access_token_encrypted,token_expires_at,scopes,connected_at,updated_at
      ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
      ON CONFLICT(account_id) DO UPDATE SET
        brand_id=EXCLUDED.brand_id,
        instagram_user_id=EXCLUDED.instagram_user_id,
        instagram_username=EXCLUDED.instagram_username,
        profile_picture_url=EXCLUDED.profile_picture_url,
        access_token_encrypted=EXCLUDED.access_token_encrypted,
        token_expires_at=EXCLUDED.token_expires_at,
        scopes=EXCLUDED.scopes,
        connected_at=EXCLUDED.connected_at,
        updated_at=EXCLUDED.updated_at`,
      [
        connection.accountId,
        connection.brandId,
        connection.instagramUserId,
        connection.instagramUsername,
        connection.profilePictureUrl,
        connection.accessTokenEncrypted,
        connection.tokenExpiresAt,
        connection.scopes,
        connection.connectedAt,
        connection.updatedAt,
      ],
    );
  }

  private async getConnection(accountId: string): Promise<InstagramConnection | null> {
    if (this.pool) {
      const result = await this.pool.query<InstagramConnectionRow>(
        `SELECT account_id,brand_id,instagram_user_id,instagram_username,profile_picture_url,
                access_token_encrypted,token_expires_at,scopes,connected_at,updated_at
         FROM modo_instagram_connections WHERE account_id=$1 LIMIT 1`,
        [accountId],
      );
      const row = result.rows[0];
      return row ? {
        accountId: row.account_id,
        brandId: row.brand_id,
        instagramUserId: row.instagram_user_id,
        instagramUsername: row.instagram_username,
        profilePictureUrl: row.profile_picture_url,
        accessTokenEncrypted: row.access_token_encrypted,
        tokenExpiresAt: row.token_expires_at,
        scopes: row.scopes || [],
        connectedAt: row.connected_at,
        updatedAt: row.updated_at,
      } : null;
    }
    return this.connections.get(accountId) ?? null;
  }

  private async savePublication(
    accountId: string,
    instagramUserId: string,
    publication: InstagramPublishResult,
  ) {
    const key = `${accountId}:${publication.postId}`;
    this.publications.set(key, publication);
    if (!this.pool) return;
    await this.pool.query(
      `INSERT INTO modo_instagram_publications(
        id,account_id,instagram_user_id,content_request_id,creation_id,post_id,permalink,published_at
      ) VALUES($1,$2,$3,$4,$5,$6,$7,$8)
      ON CONFLICT(id) DO NOTHING`,
      [
        createHash("sha256").update(key).digest("hex"),
        accountId,
        instagramUserId,
        publication.contentRequestId === "00000000-0000-0000-0000-000000000000"
          ? null
          : publication.contentRequestId,
        publication.creationId,
        publication.postId,
        publication.permalink,
        new Date(publication.publishedAt),
      ],
    );
  }

  private async deleteUserData(instagramUserId: string) {
    for (const [accountId, connection] of this.connections) {
      if (connection.instagramUserId === instagramUserId) this.connections.delete(accountId);
    }
    for (const [key] of this.publications) {
      if (key.includes(instagramUserId)) this.publications.delete(key);
    }
    if (!this.pool) return;
    await this.pool.query("BEGIN");
    try {
      await this.pool.query(
        "DELETE FROM modo_instagram_publications WHERE instagram_user_id=$1",
        [instagramUserId],
      );
      await this.pool.query(
        "DELETE FROM modo_instagram_connections WHERE instagram_user_id=$1",
        [instagramUserId],
      );
      await this.pool.query("COMMIT");
    } catch (error) {
      await this.pool.query("ROLLBACK");
      throw error;
    }
  }
}
