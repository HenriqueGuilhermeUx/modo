import type { ContentRequest, GeneratedContent } from "@modo/contracts/content";
import type {
  LinkedInAuthorType,
  LinkedInConnectRequest,
  LinkedInConnectionStatus,
  LinkedInPublication,
} from "@modo/contracts/linkedin";
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  randomUUID,
} from "node:crypto";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import pg, { type Pool } from "pg";

const { Pool: PgPool } = pg;

interface LinkedInServiceOptions {
  clientId?: string;
  clientSecret?: string;
  redirectUri?: string;
  scopes?: string;
  encryptionSecret?: string;
  apiVersion?: string;
  webUrl?: string;
  databaseUrl?: string;
  databaseSsl?: boolean;
}

interface OAuthState {
  state: string;
  accountId: string;
  authorType: LinkedInAuthorType;
  organizationUrn: string | null;
  organizationName: string | null;
  expiresAt: Date;
}

interface Connection {
  accountId: string;
  authorType: LinkedInAuthorType;
  authorUrn: string;
  displayName: string;
  encryptedAccessToken: string;
  tokenExpiresAt: Date;
  scopes: string[];
}

interface ConnectionRow {
  account_id: string;
  author_type: LinkedInAuthorType;
  author_urn: string;
  display_name: string;
  encrypted_access_token: string;
  token_expires_at: Date;
  scopes: string[];
}

interface PublicationRow {
  id: string;
  content_request_id: string;
  status: LinkedInPublication["status"];
  scheduled_for: Date | null;
  published_at: Date | null;
  post_urn: string | null;
  error: string | null;
  created_at: Date;
  updated_at: Date;
}

interface TokenResponse {
  access_token?: string;
  expires_in?: number;
  scope?: string;
  error?: string;
  error_description?: string;
}

interface ProfileResponse {
  id?: string;
  localizedFirstName?: string;
  localizedLastName?: string;
}

interface InitializeDocumentResponse {
  value?: {
    uploadUrl?: string;
    document?: string;
  };
}

const delay = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));

function mapPublication(row: PublicationRow): LinkedInPublication {
  return {
    id: row.id,
    contentRequestId: row.content_request_id,
    status: row.status,
    scheduledFor: row.scheduled_for?.toISOString() ?? null,
    publishedAt: row.published_at?.toISOString() ?? null,
    postUrn: row.post_urn,
    error: row.error,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

export class LinkedInError extends Error {
  constructor(
    public readonly code: string,
    public readonly statusCode: number,
    message: string,
  ) {
    super(message);
    this.name = "LinkedInError";
  }
}

export class LinkedInService {
  private readonly pool?: Pool;
  private readonly states = new Map<string, OAuthState>();
  private readonly connections = new Map<string, Connection>();
  private readonly publications: LinkedInPublication[] = [];
  private scheduler?: ReturnType<typeof setInterval>;

  constructor(private readonly options: LinkedInServiceOptions) {
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

  async initialize() {
    if (this.pool) {
      await this.pool.query(`
        CREATE TABLE IF NOT EXISTS modo_linkedin_oauth_states (
          state TEXT PRIMARY KEY,
          account_id TEXT NOT NULL REFERENCES modo_organizations(id) ON DELETE CASCADE,
          author_type TEXT NOT NULL,
          organization_urn TEXT,
          organization_name TEXT,
          expires_at TIMESTAMPTZ NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );

        CREATE TABLE IF NOT EXISTS modo_linkedin_connections (
          account_id TEXT PRIMARY KEY REFERENCES modo_organizations(id) ON DELETE CASCADE,
          author_type TEXT NOT NULL,
          author_urn TEXT NOT NULL,
          display_name TEXT NOT NULL,
          encrypted_access_token TEXT NOT NULL,
          token_expires_at TIMESTAMPTZ NOT NULL,
          scopes TEXT[] NOT NULL DEFAULT '{}',
          connected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );

        CREATE TABLE IF NOT EXISTS modo_linkedin_publications (
          id TEXT PRIMARY KEY,
          account_id TEXT NOT NULL REFERENCES modo_organizations(id) ON DELETE CASCADE,
          content_request_id TEXT NOT NULL REFERENCES modo_content_requests(id) ON DELETE CASCADE,
          status TEXT NOT NULL,
          scheduled_for TIMESTAMPTZ,
          published_at TIMESTAMPTZ,
          post_urn TEXT,
          error TEXT,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          UNIQUE(account_id, content_request_id)
        );
        CREATE INDEX IF NOT EXISTS modo_linkedin_publications_due_idx
          ON modo_linkedin_publications(status, scheduled_for);
      `);
    }

    this.scheduler = setInterval(() => {
      void this.processDuePublications().catch(() => undefined);
    }, 60_000);
    this.scheduler.unref?.();
  }

  async close() {
    if (this.scheduler) clearInterval(this.scheduler);
    await this.pool?.end();
  }

  async getStatus(accountId: string): Promise<LinkedInConnectionStatus> {
    const connection = await this.getConnection(accountId);
    if (!this.configured) {
      return {
        provider: "linkedin",
        integrationConfigured: false,
        connected: false,
        authorType: null,
        authorUrn: null,
        displayName: null,
        expiresAt: null,
        scopes: [],
        canPublishText: false,
        canPublishDocuments: false,
        message: "A integração está pronta no produto e aguarda as credenciais do aplicativo LinkedIn.",
      };
    }

    if (!connection) {
      return {
        provider: "linkedin",
        integrationConfigured: true,
        connected: false,
        authorType: null,
        authorUrn: null,
        displayName: null,
        expiresAt: null,
        scopes: this.scopes,
        canPublishText: false,
        canPublishDocuments: false,
        message: "Conecte um perfil ou página para publicar diretamente pela MODO.",
      };
    }

    const expired = connection.tokenExpiresAt <= new Date();
    return {
      provider: "linkedin",
      integrationConfigured: true,
      connected: !expired,
      authorType: connection.authorType,
      authorUrn: connection.authorUrn,
      displayName: connection.displayName,
      expiresAt: connection.tokenExpiresAt.toISOString(),
      scopes: connection.scopes,
      canPublishText: !expired,
      canPublishDocuments: !expired,
      message: expired
        ? "A autorização expirou. Reconecte o LinkedIn para continuar publicando."
        : `LinkedIn conectado como ${connection.displayName}.`,
    };
  }

  async createAuthorizationUrl(accountId: string, input: LinkedInConnectRequest) {
    this.requireConfigured();
    const state = `${randomUUID()}${randomBytes(18).toString("hex")}`;
    const record: OAuthState = {
      state,
      accountId,
      authorType: input.authorType,
      organizationUrn: input.organizationUrn ?? null,
      organizationName: input.organizationName ?? null,
      expiresAt: new Date(Date.now() + 15 * 60_000),
    };
    await this.saveState(record);

    const url = new URL("https://www.linkedin.com/oauth/v2/authorization");
    url.searchParams.set("response_type", "code");
    url.searchParams.set("client_id", this.options.clientId!);
    url.searchParams.set("redirect_uri", this.options.redirectUri!);
    url.searchParams.set("state", state);
    url.searchParams.set("scope", this.scopes.join(" "));
    return { authorizationUrl: url.toString() };
  }

  async completeAuthorization(input: {
    state?: string;
    code?: string;
    error?: string;
    errorDescription?: string;
  }) {
    const fallback = this.frontendRedirect("error", input.errorDescription || input.error || "Autorização não concluída.");
    if (!input.state) return fallback;

    const state = await this.consumeState(input.state);
    if (!state || state.expiresAt <= new Date()) {
      return this.frontendRedirect("error", "A autorização expirou. Inicie novamente pela MODO.");
    }
    if (input.error || !input.code) return fallback;

    const token = await this.exchangeCode(input.code);
    const accessToken = token.access_token;
    if (!accessToken) {
      return this.frontendRedirect("error", token.error_description || token.error || "Token não recebido.");
    }

    let authorUrn: string;
    let displayName: string;
    if (state.authorType === "organization") {
      authorUrn = state.organizationUrn!;
      displayName = state.organizationName || "Página da empresa";
    } else {
      const profile = await this.fetchProfile(accessToken);
      if (!profile.id) {
        return this.frontendRedirect(
          "error",
          "O LinkedIn não retornou o identificador do perfil. Confirme a permissão r_liteprofile.",
        );
      }
      authorUrn = `urn:li:person:${profile.id}`;
      displayName = [profile.localizedFirstName, profile.localizedLastName].filter(Boolean).join(" ") || "Perfil LinkedIn";
    }

    const connection: Connection = {
      accountId: state.accountId,
      authorType: state.authorType,
      authorUrn,
      displayName,
      encryptedAccessToken: this.encrypt(accessToken),
      tokenExpiresAt: new Date(Date.now() + Number(token.expires_in || 5_184_000) * 1000),
      scopes: (token.scope || this.scopes.join(" ")).split(/\s+/).filter(Boolean),
    };
    await this.saveConnection(connection);
    return this.frontendRedirect("connected");
  }

  async disconnect(accountId: string) {
    this.connections.delete(accountId);
    if (this.pool) {
      await this.pool.query("DELETE FROM modo_linkedin_connections WHERE account_id=$1", [accountId]);
    }
    return { disconnected: true };
  }

  async listPublications(accountId: string): Promise<LinkedInPublication[]> {
    if (this.pool) {
      const result = await this.pool.query<PublicationRow>(
        `SELECT id,content_request_id,status,scheduled_for,published_at,post_urn,error,created_at,updated_at
         FROM modo_linkedin_publications WHERE account_id=$1 ORDER BY created_at DESC LIMIT 100`,
        [accountId],
      );
      return result.rows.map(mapPublication);
    }
    return this.publications.filter((item) => item.id.startsWith(`${accountId}:`));
  }

  async requestPublication(
    accountId: string,
    content: ContentRequest,
    scheduledFor?: string,
  ): Promise<LinkedInPublication> {
    if (content.organizationId !== accountId) {
      throw new LinkedInError("CONTENT_NOT_FOUND", 404, "Conteúdo não encontrado nesta organização.");
    }
    if (content.status !== "approved" || !content.output) {
      throw new LinkedInError(
        "CONTENT_NOT_APPROVED",
        409,
        "Apenas conteúdos aprovados podem ser publicados no LinkedIn.",
      );
    }
    if (!/^linkedin$/i.test(content.channel.trim())) {
      throw new LinkedInError("INVALID_CHANNEL", 409, "Este conteúdo não foi criado para o LinkedIn.");
    }

    const target = scheduledFor ? new Date(scheduledFor) : null;
    if (target && Number.isNaN(target.getTime())) {
      throw new LinkedInError("INVALID_SCHEDULE", 400, "Data de agendamento inválida.");
    }

    const connection = await this.getConnection(accountId);
    if (!this.configured || !connection || connection.tokenExpiresAt <= new Date()) {
      return this.savePublication(accountId, content.id, "manual", target, null, null);
    }

    if (target && target > new Date(Date.now() + 30_000)) {
      return this.savePublication(accountId, content.id, "scheduled", target, null, null);
    }

    const publication = await this.savePublication(accountId, content.id, "publishing", target, null, null);
    return this.publishStored(accountId, publication, content, connection);
  }

  private async processDuePublications() {
    if (!this.pool || !this.configured) return;
    const due = await this.pool.query<{ id: string; account_id: string; content_request_id: string }>(
      `SELECT id,account_id,content_request_id FROM modo_linkedin_publications
       WHERE status='scheduled' AND scheduled_for <= NOW()
       ORDER BY scheduled_for ASC LIMIT 10`,
    );
    for (const row of due.rows) {
      const connection = await this.getConnection(row.account_id);
      if (!connection || connection.tokenExpiresAt <= new Date()) {
        await this.updatePublication(row.id, "failed", null, "Conexão LinkedIn ausente ou expirada.");
        continue;
      }
      const contentResult = await this.pool.query<any>(
        "SELECT * FROM modo_content_requests WHERE id=$1 AND organization_id=$2 LIMIT 1",
        [row.content_request_id, row.account_id],
      );
      const raw = contentResult.rows[0];
      if (!raw) {
        await this.updatePublication(row.id, "failed", null, "Conteúdo não encontrado.");
        continue;
      }
      const content: ContentRequest = {
        id: raw.id,
        organizationId: raw.organization_id,
        brandId: raw.brand_id,
        contentType: raw.content_type,
        objective: raw.objective,
        brief: raw.brief,
        channel: raw.channel,
        status: raw.status,
        creditsCharged: raw.credits_charged,
        revisionCount: raw.revision_count,
        maxRevisions: raw.max_revisions,
        revisionInstructions: raw.revision_instructions,
        output: raw.output,
        error: raw.error,
        providerRunId: raw.provider_run_id,
        approvedAt: raw.approved_at?.toISOString() ?? null,
        createdAt: raw.created_at.toISOString(),
        updatedAt: raw.updated_at.toISOString(),
      };
      const publication = mapPublication({
        id: row.id,
        content_request_id: row.content_request_id,
        status: "publishing",
        scheduled_for: null,
        published_at: null,
        post_urn: null,
        error: null,
        created_at: new Date(),
        updated_at: new Date(),
      });
      await this.updatePublication(row.id, "publishing", null, null);
      await this.publishStored(row.account_id, publication, content, connection).catch(() => undefined);
    }
  }

  private async publishStored(
    accountId: string,
    publication: LinkedInPublication,
    content: ContentRequest,
    connection: Connection,
  ) {
    try {
      const token = this.decrypt(connection.encryptedAccessToken);
      const postUrn = content.contentType === "carousel" && content.output!.slides.length > 0
        ? await this.publishDocument(token, connection.authorUrn, content.output!)
        : await this.publishText(token, connection.authorUrn, content.output!);
      return this.updatePublication(publication.id, "published", postUrn, null, new Date());
    } catch (error) {
      const message = error instanceof Error ? error.message : "Falha ao publicar no LinkedIn.";
      await this.updatePublication(publication.id, "failed", null, message);
      throw error;
    }
  }

  private async publishText(token: string, authorUrn: string, output: GeneratedContent) {
    return this.createPost(token, authorUrn, this.buildCommentary(output));
  }

  private async publishDocument(token: string, authorUrn: string, output: GeneratedContent) {
    const init = await fetch("https://api.linkedin.com/rest/documents?action=initializeUpload", {
      method: "POST",
      headers: this.linkedInHeaders(token),
      body: JSON.stringify({ initializeUploadRequest: { owner: authorUrn } }),
    });
    const initPayload = (await init.json().catch(() => ({}))) as InitializeDocumentResponse & { message?: string };
    const uploadUrl = initPayload.value?.uploadUrl;
    const documentUrn = initPayload.value?.document;
    if (!init.ok || !uploadUrl || !documentUrn) {
      throw new LinkedInError(
        "DOCUMENT_INITIALIZATION_FAILED",
        502,
        initPayload.message || "O LinkedIn não iniciou o upload do documento.",
      );
    }

    const pdf = await this.renderDocument(output);
    const upload = await fetch(uploadUrl, {
      method: "PUT",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/pdf" },
      body: Buffer.from(pdf),
    });
    if (!upload.ok) {
      throw new LinkedInError("DOCUMENT_UPLOAD_FAILED", 502, "O LinkedIn recusou o upload do PDF.");
    }

    for (let attempt = 0; attempt < 8; attempt += 1) {
      const status = await fetch(
        `https://api.linkedin.com/rest/documents/${encodeURIComponent(documentUrn)}`,
        { headers: this.linkedInHeaders(token) },
      );
      const payload = (await status.json().catch(() => ({}))) as { status?: string };
      if (payload.status === "AVAILABLE") break;
      if (payload.status === "PROCESSING_FAILED") {
        throw new LinkedInError("DOCUMENT_PROCESSING_FAILED", 502, "O LinkedIn não processou o PDF.");
      }
      await delay(800);
    }

    return this.createPost(token, authorUrn, this.buildCommentary(output), {
      media: { title: `${output.title.slice(0, 120)}.pdf`, id: documentUrn },
    });
  }

  private async createPost(
    token: string,
    authorUrn: string,
    commentary: string,
    content?: Record<string, unknown>,
  ) {
    const response = await fetch("https://api.linkedin.com/rest/posts", {
      method: "POST",
      headers: this.linkedInHeaders(token),
      body: JSON.stringify({
        author: authorUrn,
        commentary,
        visibility: "PUBLIC",
        distribution: {
          feedDistribution: "MAIN_FEED",
          targetEntities: [],
          thirdPartyDistributionChannels: [],
        },
        ...(content ? { content } : {}),
        lifecycleState: "PUBLISHED",
        isReshareDisabledByAuthor: false,
      }),
    });
    const payload = (await response.json().catch(() => ({}))) as { message?: string };
    if (!response.ok) {
      throw new LinkedInError(
        "LINKEDIN_PUBLISH_FAILED",
        response.status === 401 ? 401 : 502,
        payload.message || `O LinkedIn recusou a publicação (${response.status}).`,
      );
    }
    return response.headers.get("x-restli-id") || "published";
  }

  private buildCommentary(output: GeneratedContent) {
    const hashtags = output.hashtags.join(" ");
    const parts = [output.hook, output.caption, output.cta, hashtags].filter(Boolean);
    const unique: string[] = [];
    for (const part of parts) {
      if (!unique.some((existing) => existing.trim() === part.trim())) unique.push(part.trim());
    }
    const text = unique.join("\n\n");
    return text.length <= 2900 ? text : `${text.slice(0, 2897)}...`;
  }

  private async renderDocument(output: GeneratedContent) {
    const document = await PDFDocument.create();
    const regular = await document.embedFont(StandardFonts.Helvetica);
    const bold = await document.embedFont(StandardFonts.HelveticaBold);
    const slides = output.slides.length > 0
      ? output.slides
      : [{ title: output.title, body: output.caption }];

    const addSlide = (title: string, body: string, index: number, total: number) => {
      const page = document.addPage([800, 1000]);
      page.drawRectangle({ x: 0, y: 0, width: 800, height: 1000, color: rgb(0.96, 0.97, 0.99) });
      page.drawRectangle({ x: 0, y: 0, width: 30, height: 1000, color: rgb(0.12, 0.37, 1) });
      page.drawText("MODO LINKEDIN", { x: 70, y: 925, size: 15, font: bold, color: rgb(0.12, 0.37, 1) });
      page.drawText(`${String(index).padStart(2, "0")} / ${String(total).padStart(2, "0")}`, { x: 650, y: 925, size: 12, font: regular, color: rgb(0.36, 0.4, 0.48) });
      let y = 820;
      for (const line of this.wrap(title, 36)) {
        page.drawText(line, { x: 70, y, size: 34, font: bold, color: rgb(0.05, 0.11, 0.24) });
        y -= 44;
      }
      y -= 25;
      for (const line of this.wrap(body, 65)) {
        if (y < 90) break;
        page.drawText(line, { x: 70, y, size: 19, font: regular, color: rgb(0.22, 0.27, 0.36) });
        y -= 29;
      }
      page.drawText("Sua marca em modo presença.", { x: 70, y: 48, size: 12, font: bold, color: rgb(0.12, 0.37, 1) });
    };

    addSlide(output.hook, output.title, 1, slides.length + 1);
    slides.forEach((slide, index) => addSlide(slide.title, slide.body, index + 2, slides.length + 1));
    return document.save();
  }

  private wrap(text: string, maxCharacters: number) {
    const words = text.replace(/\s+/g, " ").trim().split(" ");
    const lines: string[] = [];
    let current = "";
    for (const word of words) {
      const candidate = current ? `${current} ${word}` : word;
      if (candidate.length > maxCharacters && current) {
        lines.push(current);
        current = word;
      } else {
        current = candidate;
      }
    }
    if (current) lines.push(current);
    return lines;
  }

  private linkedInHeaders(token: string) {
    return {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "Linkedin-Version": this.options.apiVersion || "202606",
      "X-Restli-Protocol-Version": "2.0.0",
    };
  }

  private get scopes() {
    return (this.options.scopes || "r_liteprofile w_member_social")
      .split(/[ ,]+/)
      .map((item) => item.trim())
      .filter(Boolean);
  }

  private async exchangeCode(code: string): Promise<TokenResponse> {
    const body = new URLSearchParams({
      grant_type: "authorization_code",
      code,
      client_id: this.options.clientId!,
      client_secret: this.options.clientSecret!,
      redirect_uri: this.options.redirectUri!,
    });
    const response = await fetch("https://www.linkedin.com/oauth/v2/accessToken", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
    const payload = (await response.json().catch(() => ({}))) as TokenResponse;
    if (!response.ok) {
      throw new LinkedInError(
        "LINKEDIN_TOKEN_EXCHANGE_FAILED",
        502,
        payload.error_description || payload.error || "Falha ao obter token do LinkedIn.",
      );
    }
    return payload;
  }

  private async fetchProfile(token: string): Promise<ProfileResponse> {
    const response = await fetch("https://api.linkedin.com/v2/me", {
      headers: {
        Authorization: `Bearer ${token}`,
        "X-Restli-Protocol-Version": "2.0.0",
      },
    });
    const payload = (await response.json().catch(() => ({}))) as ProfileResponse & { message?: string };
    if (!response.ok) {
      throw new LinkedInError(
        "LINKEDIN_PROFILE_FAILED",
        502,
        payload.message || "Não foi possível identificar o perfil conectado.",
      );
    }
    return payload;
  }

  private encrypt(value: string) {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.encryptionKey, iv);
    const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
    return [iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), encrypted.toString("base64url")].join(".");
  }

  private decrypt(value: string) {
    const [ivValue, tagValue, dataValue] = value.split(".");
    if (!ivValue || !tagValue || !dataValue) throw new LinkedInError("INVALID_TOKEN", 500, "Token LinkedIn inválido.");
    const decipher = createDecipheriv("aes-256-gcm", this.encryptionKey, Buffer.from(ivValue, "base64url"));
    decipher.setAuthTag(Buffer.from(tagValue, "base64url"));
    return Buffer.concat([
      decipher.update(Buffer.from(dataValue, "base64url")),
      decipher.final(),
    ]).toString("utf8");
  }

  private get encryptionKey() {
    return createHash("sha256").update(this.options.encryptionSecret || "disabled").digest();
  }

  private async saveState(state: OAuthState) {
    this.states.set(state.state, state);
    if (this.pool) {
      await this.pool.query(
        `INSERT INTO modo_linkedin_oauth_states(state,account_id,author_type,organization_urn,organization_name,expires_at)
         VALUES($1,$2,$3,$4,$5,$6)`,
        [state.state, state.accountId, state.authorType, state.organizationUrn, state.organizationName, state.expiresAt],
      );
    }
  }

  private async consumeState(value: string): Promise<OAuthState | null> {
    const memory = this.states.get(value);
    this.states.delete(value);
    if (this.pool) {
      const result = await this.pool.query<any>(
        `DELETE FROM modo_linkedin_oauth_states WHERE state=$1
         RETURNING state,account_id,author_type,organization_urn,organization_name,expires_at`,
        [value],
      );
      const row = result.rows[0];
      if (row) {
        return {
          state: row.state,
          accountId: row.account_id,
          authorType: row.author_type,
          organizationUrn: row.organization_urn,
          organizationName: row.organization_name,
          expiresAt: row.expires_at,
        };
      }
    }
    return memory ?? null;
  }

  private async saveConnection(connection: Connection) {
    this.connections.set(connection.accountId, connection);
    if (this.pool) {
      await this.pool.query(
        `INSERT INTO modo_linkedin_connections(
          account_id,author_type,author_urn,display_name,encrypted_access_token,token_expires_at,scopes
        ) VALUES($1,$2,$3,$4,$5,$6,$7)
        ON CONFLICT(account_id) DO UPDATE SET
          author_type=EXCLUDED.author_type,author_urn=EXCLUDED.author_urn,
          display_name=EXCLUDED.display_name,encrypted_access_token=EXCLUDED.encrypted_access_token,
          token_expires_at=EXCLUDED.token_expires_at,scopes=EXCLUDED.scopes,updated_at=NOW()`,
        [
          connection.accountId,
          connection.authorType,
          connection.authorUrn,
          connection.displayName,
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
        `SELECT account_id,author_type,author_urn,display_name,encrypted_access_token,token_expires_at,scopes
         FROM modo_linkedin_connections WHERE account_id=$1 LIMIT 1`,
        [accountId],
      );
      if (result.rowCount) {
        const row = result.rows[0];
        return {
          accountId: row.account_id,
          authorType: row.author_type,
          authorUrn: row.author_urn,
          displayName: row.display_name,
          encryptedAccessToken: row.encrypted_access_token,
          tokenExpiresAt: row.token_expires_at,
          scopes: row.scopes,
        };
      }
    }
    return this.connections.get(accountId) ?? null;
  }

  private async savePublication(
    accountId: string,
    contentRequestId: string,
    status: LinkedInPublication["status"],
    scheduledFor: Date | null,
    postUrn: string | null,
    error: string | null,
  ): Promise<LinkedInPublication> {
    if (this.pool) {
      const result = await this.pool.query<PublicationRow>(
        `INSERT INTO modo_linkedin_publications(id,account_id,content_request_id,status,scheduled_for,post_urn,error)
         VALUES($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT(account_id,content_request_id) DO UPDATE SET
           status=EXCLUDED.status,scheduled_for=EXCLUDED.scheduled_for,
           post_urn=EXCLUDED.post_urn,error=EXCLUDED.error,updated_at=NOW()
         RETURNING id,content_request_id,status,scheduled_for,published_at,post_urn,error,created_at,updated_at`,
        [randomUUID(), accountId, contentRequestId, status, scheduledFor, postUrn, error],
      );
      return mapPublication(result.rows[0]);
    }
    const now = new Date().toISOString();
    const existing = this.publications.find((item) => item.contentRequestId === contentRequestId);
    const next: LinkedInPublication = {
      id: existing?.id || `${accountId}:${randomUUID()}`,
      contentRequestId,
      status,
      scheduledFor: scheduledFor?.toISOString() ?? null,
      publishedAt: status === "published" ? now : null,
      postUrn,
      error,
      createdAt: existing?.createdAt || now,
      updatedAt: now,
    };
    if (existing) Object.assign(existing, next);
    else this.publications.unshift(next);
    return next;
  }

  private async updatePublication(
    id: string,
    status: LinkedInPublication["status"],
    postUrn: string | null,
    error: string | null,
    publishedAt?: Date,
  ): Promise<LinkedInPublication> {
    if (this.pool) {
      const result = await this.pool.query<PublicationRow>(
        `UPDATE modo_linkedin_publications SET
          status=$2,post_urn=COALESCE($3,post_urn),error=$4,
          published_at=COALESCE($5,published_at),updated_at=NOW()
         WHERE id=$1
         RETURNING id,content_request_id,status,scheduled_for,published_at,post_urn,error,created_at,updated_at`,
        [id, status, postUrn, error, publishedAt ?? null],
      );
      if (!result.rowCount) throw new LinkedInError("PUBLICATION_NOT_FOUND", 404, "Publicação não encontrada.");
      return mapPublication(result.rows[0]);
    }
    const item = this.publications.find((publication) => publication.id === id);
    if (!item) throw new LinkedInError("PUBLICATION_NOT_FOUND", 404, "Publicação não encontrada.");
    item.status = status;
    item.postUrn = postUrn ?? item.postUrn;
    item.error = error;
    item.publishedAt = publishedAt?.toISOString() ?? item.publishedAt;
    item.updatedAt = new Date().toISOString();
    return item;
  }

  private frontendRedirect(status: "connected" | "error", message?: string) {
    const target = new URL("/app/linkedin", this.options.webUrl || "http://localhost:5173");
    target.searchParams.set("linkedin", status);
    if (message) target.searchParams.set("message", message.slice(0, 400));
    return target.toString();
  }

  private requireConfigured() {
    if (!this.configured) {
      throw new LinkedInError(
        "LINKEDIN_NOT_CONFIGURED",
        503,
        "Cadastre LINKEDIN_CLIENT_ID, LINKEDIN_CLIENT_SECRET, LINKEDIN_REDIRECT_URI e LINKEDIN_TOKEN_ENCRYPTION_SECRET.",
      );
    }
  }
}
