import type { AuthSession, LoginRequest, RegisterRequest } from "@modo/contracts";
import pg, { type Pool, type PoolClient } from "pg";
import { randomBytes, randomUUID, scryptSync, timingSafeEqual, createHash } from "node:crypto";
import { AuthError } from "./auth-service.js";

const { Pool: PgPool } = pg;

export type WorkspaceType = "business" | "agency";
type Role = "owner" | "admin" | "member";

interface Options {
  databaseUrl?: string;
  databaseSsl?: boolean;
  sessionDays?: number;
}

type UserRow = {
  id: string;
  name: string;
  email: string;
  password_hash: string;
  password_salt: string;
  created_at: Date;
};

type WorkspaceRow = UserRow & {
  organization_id: string;
  organization_name: string;
  organization_created_at: Date;
  role: Role;
};

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

function hashPassword(password: string, salt: string) {
  return scryptSync(password, salt, 64).toString("hex");
}

function verifyPassword(password: string, salt: string, expectedHash: string) {
  const actual = Buffer.from(hashPassword(password, salt), "hex");
  const expected = Buffer.from(expectedHash, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function addDays(date: Date, days: number) {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

export class WorkspaceAuthService {
  private readonly pool?: Pool;
  private readonly sessionDays: number;

  constructor(options: Options = {}) {
    this.sessionDays = options.sessionDays ?? 30;
    if (options.databaseUrl) {
      this.pool = new PgPool({
        connectionString: options.databaseUrl,
        ssl: options.databaseSsl ? { rejectUnauthorized: false } : undefined,
        max: 4,
      });
    }
  }

  get configured() {
    return Boolean(this.pool);
  }

  async initialize() {
    if (!this.pool) return;
    await this.pool.query(`
      ALTER TABLE modo_organizations
        ADD COLUMN IF NOT EXISTS workspace_type TEXT NOT NULL DEFAULT 'business';

      CREATE INDEX IF NOT EXISTS modo_organizations_workspace_type_idx
        ON modo_organizations(workspace_type);

      UPDATE modo_organizations o
      SET workspace_type='agency'
      WHERE workspace_type='business'
        AND EXISTS (
          SELECT 1 FROM modo_subscriptions s
          WHERE s.account_id=o.id
            AND s.plan_slug IN ('agency_professional','agency_studio','agency')
        );
    `);
  }

  async close() {
    await this.pool?.end();
  }

  async register(input: RegisterRequest, workspaceType: WorkspaceType): Promise<AuthSession> {
    const pool = this.requirePool();
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const email = normalizeEmail(input.email);
      const existing = await client.query<UserRow>(
        `SELECT id,name,email,password_hash,password_salt,created_at
         FROM modo_users WHERE email=$1 LIMIT 1`,
        [email],
      );

      let user: UserRow;
      if (existing.rowCount) {
        user = existing.rows[0];
        if (!verifyPassword(input.password, user.password_salt, user.password_hash)) {
          throw new AuthError("INVALID_CREDENTIALS", 401, "A senha não corresponde ao usuário já existente.");
        }
        const workspace = await client.query(
          `SELECT o.id
           FROM modo_memberships m
           JOIN modo_organizations o ON o.id=m.organization_id
           WHERE m.user_id=$1 AND o.workspace_type=$2
           LIMIT 1`,
          [user.id, workspaceType],
        );
        if (workspace.rowCount) {
          throw new AuthError(
            "WORKSPACE_ALREADY_EXISTS",
            409,
            workspaceType === "agency"
              ? "Você já possui um workspace MODO Agency. Entre com seu e-mail e senha."
              : "Você já possui uma conta MODO Business. Entre com seu e-mail e senha.",
          );
        }
      } else {
        const salt = randomBytes(16).toString("hex");
        user = {
          id: randomUUID(),
          name: input.name,
          email,
          password_hash: hashPassword(input.password, salt),
          password_salt: salt,
          created_at: new Date(),
        };
        await client.query(
          `INSERT INTO modo_users(id,name,email,password_hash,password_salt,created_at)
           VALUES($1,$2,$3,$4,$5,$6)`,
          [user.id, user.name, user.email, user.password_hash, user.password_salt, user.created_at],
        );
      }

      const organizationId = randomUUID();
      const organizationCreatedAt = new Date();
      await client.query(
        `INSERT INTO modo_organizations(id,name,workspace_type,created_at)
         VALUES($1,$2,$3,$4)`,
        [organizationId, input.organizationName, workspaceType, organizationCreatedAt],
      );
      await client.query(
        `INSERT INTO modo_memberships(user_id,organization_id,role)
         VALUES($1,$2,'owner')`,
        [user.id, organizationId],
      );

      const session = await this.createSession(client, {
        userId: user.id,
        userName: user.name,
        email: user.email,
        userCreatedAt: user.created_at,
        organizationId,
        organizationName: input.organizationName,
        organizationCreatedAt,
        role: "owner",
      });
      await client.query("COMMIT");
      return session;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async login(input: LoginRequest, workspaceType: WorkspaceType): Promise<AuthSession> {
    const pool = this.requirePool();
    const client = await pool.connect();
    try {
      const userResult = await client.query<UserRow>(
        `SELECT id,name,email,password_hash,password_salt,created_at
         FROM modo_users WHERE email=$1 LIMIT 1`,
        [normalizeEmail(input.email)],
      );
      const user = userResult.rows[0];
      if (!user || !verifyPassword(input.password, user.password_salt, user.password_hash)) {
        throw new AuthError("INVALID_CREDENTIALS", 401, "E-mail ou senha inválidos.");
      }

      const workspaceResult = await client.query<WorkspaceRow>(
        `SELECT u.id,u.name,u.email,u.password_hash,u.password_salt,u.created_at,
                o.id AS organization_id,o.name AS organization_name,
                o.created_at AS organization_created_at,m.role
         FROM modo_users u
         JOIN modo_memberships m ON m.user_id=u.id
         JOIN modo_organizations o ON o.id=m.organization_id
         WHERE u.id=$1 AND o.workspace_type=$2
         ORDER BY m.created_at ASC
         LIMIT 1`,
        [user.id, workspaceType],
      );
      const row = workspaceResult.rows[0];
      if (!row) {
        throw new AuthError(
          "WORKSPACE_NOT_FOUND",
          404,
          workspaceType === "agency"
            ? "Este usuário ainda não possui um workspace MODO Agency."
            : "Este usuário ainda não possui uma conta MODO Business.",
        );
      }

      return this.createSession(client, {
        userId: row.id,
        userName: row.name,
        email: row.email,
        userCreatedAt: row.created_at,
        organizationId: row.organization_id,
        organizationName: row.organization_name,
        organizationCreatedAt: row.organization_created_at,
        role: row.role,
      });
    } finally {
      client.release();
    }
  }

  async getWorkspaceType(organizationId: string): Promise<WorkspaceType> {
    const result = await this.requirePool().query<{ workspace_type: WorkspaceType }>(
      "SELECT workspace_type FROM modo_organizations WHERE id=$1 LIMIT 1",
      [organizationId],
    );
    return result.rows[0]?.workspace_type || "business";
  }

  private async createSession(
    client: PoolClient,
    context: {
      userId: string;
      userName: string;
      email: string;
      userCreatedAt: Date;
      organizationId: string;
      organizationName: string;
      organizationCreatedAt: Date;
      role: Role;
    },
  ): Promise<AuthSession> {
    const token = randomBytes(32).toString("base64url");
    const expiresAt = addDays(new Date(), this.sessionDays);
    await client.query(
      `INSERT INTO modo_sessions(id,token_hash,user_id,organization_id,expires_at)
       VALUES($1,$2,$3,$4,$5)`,
      [randomUUID(), hashToken(token), context.userId, context.organizationId, expiresAt],
    );
    return {
      token,
      expiresAt: expiresAt.toISOString(),
      user: {
        id: context.userId,
        name: context.userName,
        email: context.email,
        createdAt: new Date(context.userCreatedAt).toISOString(),
      },
      organization: {
        id: context.organizationId,
        name: context.organizationName,
        role: context.role,
        createdAt: new Date(context.organizationCreatedAt).toISOString(),
      },
    };
  }

  private requirePool() {
    if (!this.pool) {
      throw new AuthError("WORKSPACE_AUTH_UNAVAILABLE", 503, "Autenticação por workspace requer PostgreSQL.");
    }
    return this.pool;
  }
}
