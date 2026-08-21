import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import pg, { type Pool } from "pg";

const { Pool: PgPool } = pg;

type Provider = "instagram" | "threads";

interface Options {
  databaseUrl?: string;
  databaseSsl?: boolean;
  instagramEncryptionSecret?: string;
  instagramGraphBaseUrl?: string;
  threadsAppSecret?: string;
}

interface ConnectionRow {
  id: string;
  provider: Provider;
  encrypted_access_token: string;
  token_expires_at: Date;
}

interface RefreshPayload {
  access_token?: string;
  expires_in?: number;
  error?: { message?: string };
}

export class NativeSocialTokenLifecycleService {
  private readonly pool?: Pool;
  private timer?: ReturnType<typeof setInterval>;

  constructor(private readonly options: Options) {
    if (options.databaseUrl) {
      this.pool = new PgPool({
        connectionString: options.databaseUrl,
        ssl: options.databaseSsl ? { rejectUnauthorized: false } : undefined,
        max: 2,
      });
    }
  }

  async initialize() {
    if (!this.pool) return;
    void this.refreshExpiringConnections().catch(() => undefined);
    this.timer = setInterval(() => void this.refreshExpiringConnections().catch(() => undefined), 6 * 60 * 60_000);
    this.timer.unref?.();
  }

  async close() {
    if (this.timer) clearInterval(this.timer);
    await this.pool?.end();
  }

  async refreshExpiringConnections() {
    if (!this.pool) return { scanned: 0, refreshed: 0 };
    const result = await this.pool.query<ConnectionRow>(
      `SELECT id,provider,encrypted_access_token,token_expires_at
       FROM modo_native_social_connections
       WHERE provider IN ('instagram','threads')
         AND token_expires_at IS NOT NULL
         AND token_expires_at > NOW()
         AND token_expires_at <= NOW() + INTERVAL '7 days'
       ORDER BY token_expires_at ASC
       LIMIT 100`,
    );

    let refreshed = 0;
    for (const connection of result.rows) {
      try {
        const secret = this.secretFor(connection.provider);
        if (!secret) continue;
        const token = this.decrypt(connection.encrypted_access_token, secret);
        const next = connection.provider === "instagram"
          ? await this.refreshInstagram(token)
          : await this.refreshThreads(token);
        if (!next.accessToken) continue;
        await this.pool.query(
          `UPDATE modo_native_social_connections
           SET encrypted_access_token=$2,
               token_expires_at=$3,
               metadata=metadata || $4::jsonb,
               updated_at=NOW()
           WHERE id=$1`,
          [
            connection.id,
            this.encrypt(next.accessToken, secret),
            new Date(Date.now() + next.expiresIn * 1000),
            JSON.stringify({ tokenRefreshedAt: new Date().toISOString() }),
          ],
        );
        refreshed += 1;
      } catch {
        // A conexão continua válida até o vencimento atual; nova tentativa ocorrerá no próximo ciclo.
      }
    }
    return { scanned: result.rows.length, refreshed };
  }

  private async refreshInstagram(token: string) {
    const base = (this.options.instagramGraphBaseUrl || "https://graph.instagram.com").replace(/\/$/, "");
    const url = new URL(`${base}/refresh_access_token`);
    url.searchParams.set("grant_type", "ig_refresh_token");
    url.searchParams.set("access_token", token);
    return this.readRefresh(url, token);
  }

  private async refreshThreads(token: string) {
    const url = new URL("https://graph.threads.net/refresh_access_token");
    url.searchParams.set("grant_type", "th_refresh_token");
    url.searchParams.set("access_token", token);
    return this.readRefresh(url, token);
  }

  private async readRefresh(url: URL, currentToken: string) {
    const response = await fetch(url, { signal: AbortSignal.timeout(20_000) });
    const payload = await response.json().catch(() => ({})) as RefreshPayload;
    if (!response.ok) throw new Error(payload.error?.message || `Token refresh failed (${response.status}).`);
    return {
      accessToken: payload.access_token || currentToken,
      expiresIn: Math.max(24 * 60 * 60, Number(payload.expires_in || 5_184_000)),
    };
  }

  private secretFor(provider: Provider) {
    return provider === "instagram" ? this.options.instagramEncryptionSecret : this.options.threadsAppSecret;
  }

  private key(secret: string) {
    return createHash("sha256").update(secret).digest();
  }

  private encrypt(value: string, secret: string) {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key(secret), iv);
    const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
    const tag = cipher.getAuthTag();
    return [iv, tag, encrypted].map((part) => part.toString("base64url")).join(".");
  }

  private decrypt(value: string, secret: string) {
    const [iv, tag, encrypted] = value.split(".");
    if (!iv || !tag || !encrypted) throw new Error("Token social armazenado inválido.");
    const decipher = createDecipheriv("aes-256-gcm", this.key(secret), Buffer.from(iv, "base64url"));
    decipher.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([decipher.update(Buffer.from(encrypted, "base64url")), decipher.final()]).toString("utf8");
  }
}
