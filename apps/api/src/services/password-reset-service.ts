import { createHash, randomBytes, randomUUID, scryptSync } from "node:crypto";
import pg, { type Pool, type PoolClient } from "pg";

const { Pool: PgPool } = pg;
const RESET_MINUTES = 30;

interface Options {
  databaseUrl?: string;
  databaseSsl?: boolean;
  publicWebUrl?: string;
  resendApiKey?: string;
  emailFrom?: string;
}

type UserRow = {
  id: string;
  name: string;
  email: string;
};

type ResetRow = {
  id: string;
  user_id: string;
  expires_at: Date;
  used_at: Date | null;
};

export class PasswordResetError extends Error {
  constructor(
    public readonly code: string,
    public readonly statusCode: number,
    message: string,
  ) {
    super(message);
    this.name = "PasswordResetError";
  }
}

function normalizeEmail(value: string) {
  return value.trim().toLowerCase();
}

function hashToken(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function hashPassword(password: string, salt: string) {
  return scryptSync(password, salt, 64).toString("hex");
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

export class PasswordResetService {
  private readonly pool?: Pool;

  constructor(private readonly options: Options = {}) {
    if (options.databaseUrl) {
      this.pool = new PgPool({
        connectionString: options.databaseUrl,
        ssl: options.databaseSsl ? { rejectUnauthorized: false } : undefined,
        max: 3,
      });
    }
  }

  get configured() {
    return Boolean(this.pool && this.options.resendApiKey && this.options.emailFrom);
  }

  async initialize() {
    if (!this.pool) return;
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS modo_password_reset_tokens (
        id UUID PRIMARY KEY,
        token_hash TEXT NOT NULL UNIQUE,
        user_id TEXT NOT NULL REFERENCES modo_users(id) ON DELETE CASCADE,
        expires_at TIMESTAMPTZ NOT NULL,
        used_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS modo_password_reset_tokens_user_idx
        ON modo_password_reset_tokens(user_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS modo_password_reset_tokens_expiry_idx
        ON modo_password_reset_tokens(expires_at);
    `);
  }

  async close() {
    await this.pool?.end();
  }

  async request(email: string, mode: "business" | "agency" = "business") {
    const pool = this.requirePool();
    this.requireEmailDelivery();

    await pool.query(
      `DELETE FROM modo_password_reset_tokens
       WHERE expires_at < NOW() - INTERVAL '1 day'
          OR used_at < NOW() - INTERVAL '1 day'`,
    );

    const userResult = await pool.query<UserRow>(
      `SELECT id,name,email FROM modo_users WHERE email=$1 LIMIT 1`,
      [normalizeEmail(email)],
    );
    const user = userResult.rows[0];

    // Resposta deliberadamente idêntica para e-mails existentes e inexistentes.
    if (!user) return { accepted: true };

    const token = randomBytes(32).toString("base64url");
    const tokenHash = hashToken(token);
    const expiresAt = new Date(Date.now() + RESET_MINUTES * 60_000);

    await pool.query("BEGIN");
    try {
      await pool.query(
        `UPDATE modo_password_reset_tokens
         SET used_at=COALESCE(used_at,NOW())
         WHERE user_id=$1 AND used_at IS NULL`,
        [user.id],
      );
      await pool.query(
        `INSERT INTO modo_password_reset_tokens(id,token_hash,user_id,expires_at)
         VALUES($1,$2,$3,$4)`,
        [randomUUID(), tokenHash, user.id, expiresAt],
      );
      await pool.query("COMMIT");
    } catch (error) {
      await pool.query("ROLLBACK");
      throw error;
    }

    try {
      await this.sendResetEmail(user, token, mode);
    } catch (error) {
      // Não muda a resposta externa: evita enumeração por diferenças de entrega.
      await pool.query(
        `UPDATE modo_password_reset_tokens SET used_at=NOW()
         WHERE token_hash=$1 AND used_at IS NULL`,
        [tokenHash],
      ).catch(() => undefined);
      const message = error instanceof Error ? error.message : "Falha desconhecida";
      console.error(`[MODO_PASSWORD_RESET] entrega de e-mail falhou: ${message}`);
    }

    return { accepted: true };
  }

  async reset(token: string, password: string) {
    const pool = this.requirePool();
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const result = await client.query<ResetRow>(
        `SELECT id,user_id,expires_at,used_at
         FROM modo_password_reset_tokens
         WHERE token_hash=$1
         LIMIT 1
         FOR UPDATE`,
        [hashToken(token)],
      );
      const record = result.rows[0];
      if (!record || record.used_at || new Date(record.expires_at).getTime() <= Date.now()) {
        throw new PasswordResetError(
          "PASSWORD_RESET_TOKEN_INVALID",
          400,
          "Este link de recuperação é inválido, já foi usado ou expirou.",
        );
      }

      const salt = randomBytes(16).toString("hex");
      await client.query(
        `UPDATE modo_users SET password_hash=$2,password_salt=$3 WHERE id=$1`,
        [record.user_id, hashPassword(password, salt), salt],
      );
      await client.query(
        `UPDATE modo_password_reset_tokens SET used_at=NOW()
         WHERE user_id=$1 AND used_at IS NULL`,
        [record.user_id],
      );
      // Troca de senha encerra todas as sessões existentes, inclusive Agency.
      await client.query("DELETE FROM modo_sessions WHERE user_id=$1", [record.user_id]);
      await client.query("COMMIT");
      return { reset: true };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  private requirePool() {
    if (!this.pool) {
      throw new PasswordResetError(
        "PASSWORD_RESET_UNAVAILABLE",
        503,
        "A recuperação de senha está temporariamente indisponível.",
      );
    }
    return this.pool;
  }

  private requireEmailDelivery() {
    if (!this.options.resendApiKey || !this.options.emailFrom) {
      throw new PasswordResetError(
        "PASSWORD_RESET_EMAIL_UNAVAILABLE",
        503,
        "A recuperação de senha está temporariamente indisponível.",
      );
    }
  }

  private async sendResetEmail(user: UserRow, token: string, mode: "business" | "agency") {
    const base = (this.options.publicWebUrl || "http://localhost:5173").replace(/\/$/, "");
    const url = new URL(`${base}/redefinir-senha`);
    url.searchParams.set("token", token);
    url.searchParams.set("mode", mode);
    const safeName = escapeHtml(user.name || "");
    const href = escapeHtml(url.toString());

    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.options.resendApiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        from: this.options.emailFrom,
        to: [user.email],
        subject: "Redefina sua senha da MODO",
        text: `Olá${user.name ? `, ${user.name}` : ""}. Use este link para redefinir sua senha da MODO. Ele expira em ${RESET_MINUTES} minutos: ${url.toString()}`,
        html: `<div style="font-family:Arial,sans-serif;color:#0d1b3e;max-width:560px;margin:auto;padding:28px"><img src="${escapeHtml(base)}/logo.svg" alt="MODO" style="width:120px;margin-bottom:24px"/><h1 style="font-size:26px">Redefina sua senha</h1><p>Olá${safeName ? `, ${safeName}` : ""}. Recebemos um pedido para redefinir sua senha da MODO.</p><p>Este link é de uso único e expira em ${RESET_MINUTES} minutos.</p><p style="margin:28px 0"><a href="${href}" style="background:#1f5eff;color:white;text-decoration:none;padding:13px 18px;border-radius:10px;font-weight:700">Criar nova senha</a></p><p style="font-size:12px;color:#69758b">Se você não solicitou esta alteração, ignore este e-mail. Sua senha atual continuará válida.</p></div>`,
      }),
      signal: AbortSignal.timeout(15_000),
    });

    if (!response.ok) {
      const payload = await response.text().catch(() => "");
      throw new Error(`Resend rejeitou a entrega (${response.status}): ${payload.slice(0, 180)}`);
    }
  }
}
