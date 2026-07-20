import type {
  AuthSession,
  Brand,
  BrandCreateRequest,
  LoginRequest,
  OrganizationPublic,
  RegisterRequest,
  UserPublic,
} from "@modo/contracts";
import pg, { type Pool, type PoolClient } from "pg";
import {
  createHash,
  randomBytes,
  randomUUID,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";

const { Pool: PgPool } = pg;

type Role = "owner" | "admin" | "member";

export interface AuthContext {
  user: UserPublic;
  organization: OrganizationPublic;
}

interface AuthServiceOptions {
  databaseUrl?: string;
  databaseSsl?: boolean;
  sessionDays?: number;
}

interface MemoryUser {
  id: string;
  name: string;
  email: string;
  passwordHash: string;
  passwordSalt: string;
  createdAt: Date;
}

interface MemoryOrganization {
  id: string;
  name: string;
  createdAt: Date;
}

interface MemoryMembership {
  userId: string;
  organizationId: string;
  role: Role;
}

interface MemorySession {
  tokenHash: string;
  userId: string;
  organizationId: string;
  expiresAt: Date;
}

interface SessionRow {
  user_id: string;
  user_name: string;
  email: string;
  user_created_at: Date;
  organization_id: string;
  organization_name: string;
  organization_created_at: Date;
  role: Role;
  expires_at: Date;
}

interface BrandRow {
  id: string;
  organization_id: string;
  name: string;
  website_url: string | null;
  instagram_handle: string | null;
  niche: Brand["niche"];
  created_at: Date;
  updated_at: Date;
}

export class AuthError extends Error {
  constructor(
    public readonly code: string,
    public readonly statusCode: number,
    message: string,
  ) {
    super(message);
    this.name = "AuthError";
  }
}

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

function mapBrand(row: BrandRow): Brand {
  return {
    id: row.id,
    organizationId: row.organization_id,
    name: row.name,
    websiteUrl: row.website_url ?? "",
    instagramHandle: row.instagram_handle ?? "",
    niche: row.niche,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

export class AuthService {
  private readonly pool?: Pool;
  private readonly sessionDays: number;
  private readonly users = new Map<string, MemoryUser>();
  private readonly organizations = new Map<string, MemoryOrganization>();
  private readonly memberships = new Map<string, MemoryMembership[]>();
  private readonly sessions = new Map<string, MemorySession>();
  private readonly brands = new Map<string, Brand[]>();

  constructor(options: AuthServiceOptions = {}) {
    this.sessionDays = options.sessionDays ?? 30;
    if (options.databaseUrl) {
      this.pool = new PgPool({
        connectionString: options.databaseUrl,
        ssl: options.databaseSsl ? { rejectUnauthorized: false } : undefined,
        max: 5,
      });
    }
  }

  get storage(): "memory" | "postgres" {
    return this.pool ? "postgres" : "memory";
  }

  async initialize() {
    if (!this.pool) return;
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS modo_users (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        email TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        password_salt TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS modo_organizations (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS modo_memberships (
        user_id TEXT NOT NULL REFERENCES modo_users(id) ON DELETE CASCADE,
        organization_id TEXT NOT NULL REFERENCES modo_organizations(id) ON DELETE CASCADE,
        role TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (user_id, organization_id)
      );

      CREATE TABLE IF NOT EXISTS modo_sessions (
        id TEXT PRIMARY KEY,
        token_hash TEXT NOT NULL UNIQUE,
        user_id TEXT NOT NULL REFERENCES modo_users(id) ON DELETE CASCADE,
        organization_id TEXT NOT NULL REFERENCES modo_organizations(id) ON DELETE CASCADE,
        expires_at TIMESTAMPTZ NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS modo_sessions_token_idx ON modo_sessions(token_hash);

      CREATE TABLE IF NOT EXISTS modo_brands (
        id TEXT PRIMARY KEY,
        organization_id TEXT NOT NULL REFERENCES modo_organizations(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        website_url TEXT,
        instagram_handle TEXT,
        niche TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS modo_brands_organization_idx ON modo_brands(organization_id);
    `);
  }

  async close() {
    await this.pool?.end();
  }

  async register(input: RegisterRequest): Promise<AuthSession> {
    if (this.pool) return this.registerPostgres(input);
    return this.registerMemory(input);
  }

  async login(input: LoginRequest): Promise<AuthSession> {
    if (this.pool) return this.loginPostgres(input);
    return this.loginMemory(input);
  }

  async authenticate(token: string): Promise<AuthContext> {
    if (!token) throw new AuthError("UNAUTHORIZED", 401, "Sessão não informada.");
    if (this.pool) return this.authenticatePostgres(token);
    return this.authenticateMemory(token);
  }

  async logout(token: string) {
    const tokenHash = hashToken(token);
    if (this.pool) {
      await this.pool.query("DELETE FROM modo_sessions WHERE token_hash = $1", [tokenHash]);
      return;
    }
    this.sessions.delete(tokenHash);
  }

  async listBrands(organizationId: string): Promise<Brand[]> {
    if (this.pool) {
      const result = await this.pool.query<BrandRow>(
        `SELECT id, organization_id, name, website_url, instagram_handle, niche, created_at, updated_at
         FROM modo_brands WHERE organization_id = $1 ORDER BY created_at DESC`,
        [organizationId],
      );
      return result.rows.map(mapBrand);
    }
    return [...(this.brands.get(organizationId) ?? [])];
  }

  async createBrand(organizationId: string, input: BrandCreateRequest): Promise<Brand> {
    const now = new Date();
    const brand: Brand = {
      id: randomUUID(),
      organizationId,
      name: input.name,
      websiteUrl: input.websiteUrl ?? "",
      instagramHandle: input.instagramHandle ?? "",
      niche: input.niche,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    };

    if (this.pool) {
      const result = await this.pool.query<BrandRow>(
        `INSERT INTO modo_brands(id, organization_id, name, website_url, instagram_handle, niche)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id, organization_id, name, website_url, instagram_handle, niche, created_at, updated_at`,
        [
          brand.id,
          organizationId,
          brand.name,
          brand.websiteUrl || null,
          brand.instagramHandle || null,
          brand.niche,
        ],
      );
      return mapBrand(result.rows[0]);
    }

    const list = this.brands.get(organizationId) ?? [];
    list.unshift(brand);
    this.brands.set(organizationId, list);
    return brand;
  }

  private registerMemory(input: RegisterRequest): AuthSession {
    const email = normalizeEmail(input.email);
    if ([...this.users.values()].some((user) => user.email === email)) {
      throw new AuthError("EMAIL_ALREADY_EXISTS", 409, "Já existe uma conta com este e-mail.");
    }

    const now = new Date();
    const salt = randomBytes(16).toString("hex");
    const user: MemoryUser = {
      id: randomUUID(),
      name: input.name,
      email,
      passwordHash: hashPassword(input.password, salt),
      passwordSalt: salt,
      createdAt: now,
    };
    const organization: MemoryOrganization = {
      id: randomUUID(),
      name: input.organizationName,
      createdAt: now,
    };
    const membership: MemoryMembership = {
      userId: user.id,
      organizationId: organization.id,
      role: "owner",
    };

    this.users.set(user.id, user);
    this.organizations.set(organization.id, organization);
    this.memberships.set(user.id, [membership]);
    this.brands.set(organization.id, []);
    return this.createMemorySession(user, organization, membership.role);
  }

  private loginMemory(input: LoginRequest): AuthSession {
    const email = normalizeEmail(input.email);
    const user = [...this.users.values()].find((candidate) => candidate.email === email);
    if (!user || !verifyPassword(input.password, user.passwordSalt, user.passwordHash)) {
      throw new AuthError("INVALID_CREDENTIALS", 401, "E-mail ou senha inválidos.");
    }
    const membership = this.memberships.get(user.id)?.[0];
    const organization = membership && this.organizations.get(membership.organizationId);
    if (!membership || !organization) {
      throw new AuthError("ORGANIZATION_NOT_FOUND", 404, "Organização não encontrada.");
    }
    return this.createMemorySession(user, organization, membership.role);
  }

  private createMemorySession(
    user: MemoryUser,
    organization: MemoryOrganization,
    role: Role,
  ): AuthSession {
    const token = randomBytes(32).toString("base64url");
    const expiresAt = addDays(new Date(), this.sessionDays);
    this.sessions.set(hashToken(token), {
      tokenHash: hashToken(token),
      userId: user.id,
      organizationId: organization.id,
      expiresAt,
    });
    return {
      token,
      expiresAt: expiresAt.toISOString(),
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        createdAt: user.createdAt.toISOString(),
      },
      organization: {
        id: organization.id,
        name: organization.name,
        role,
        createdAt: organization.createdAt.toISOString(),
      },
    };
  }

  private authenticateMemory(token: string): AuthContext {
    const tokenHash = hashToken(token);
    const session = this.sessions.get(tokenHash);
    if (!session || session.expiresAt <= new Date()) {
      this.sessions.delete(tokenHash);
      throw new AuthError("UNAUTHORIZED", 401, "Sessão inválida ou expirada.");
    }
    const user = this.users.get(session.userId);
    const organization = this.organizations.get(session.organizationId);
    const membership = this.memberships
      .get(session.userId)
      ?.find((item) => item.organizationId === session.organizationId);
    if (!user || !organization || !membership) {
      throw new AuthError("UNAUTHORIZED", 401, "Sessão inválida.");
    }
    return {
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        createdAt: user.createdAt.toISOString(),
      },
      organization: {
        id: organization.id,
        name: organization.name,
        role: membership.role,
        createdAt: organization.createdAt.toISOString(),
      },
    };
  }

  private async registerPostgres(input: RegisterRequest): Promise<AuthSession> {
    const client = await this.requirePool().connect();
    try {
      await client.query("BEGIN");
      const email = normalizeEmail(input.email);
      const existing = await client.query("SELECT id FROM modo_users WHERE email = $1", [email]);
      if (existing.rowCount) {
        throw new AuthError("EMAIL_ALREADY_EXISTS", 409, "Já existe uma conta com este e-mail.");
      }

      const userId = randomUUID();
      const organizationId = randomUUID();
      const salt = randomBytes(16).toString("hex");
      const createdAt = new Date();
      await client.query(
        `INSERT INTO modo_users(id, name, email, password_hash, password_salt, created_at)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [userId, input.name, email, hashPassword(input.password, salt), salt, createdAt],
      );
      await client.query(
        `INSERT INTO modo_organizations(id, name, created_at) VALUES ($1, $2, $3)`,
        [organizationId, input.organizationName, createdAt],
      );
      await client.query(
        `INSERT INTO modo_memberships(user_id, organization_id, role) VALUES ($1, $2, 'owner')`,
        [userId, organizationId],
      );
      const session = await this.createPostgresSession(client, {
        userId,
        userName: input.name,
        email,
        userCreatedAt: createdAt,
        organizationId,
        organizationName: input.organizationName,
        organizationCreatedAt: createdAt,
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

  private async loginPostgres(input: LoginRequest): Promise<AuthSession> {
    const client = await this.requirePool().connect();
    try {
      const result = await client.query<{
        id: string;
        name: string;
        email: string;
        password_hash: string;
        password_salt: string;
        created_at: Date;
        organization_id: string;
        organization_name: string;
        organization_created_at: Date;
        role: Role;
      }>(
        `SELECT u.id, u.name, u.email, u.password_hash, u.password_salt, u.created_at,
                o.id AS organization_id, o.name AS organization_name,
                o.created_at AS organization_created_at, m.role
         FROM modo_users u
         JOIN modo_memberships m ON m.user_id = u.id
         JOIN modo_organizations o ON o.id = m.organization_id
         WHERE u.email = $1
         ORDER BY m.created_at ASC
         LIMIT 1`,
        [normalizeEmail(input.email)],
      );
      const row = result.rows[0];
      if (!row || !verifyPassword(input.password, row.password_salt, row.password_hash)) {
        throw new AuthError("INVALID_CREDENTIALS", 401, "E-mail ou senha inválidos.");
      }
      return this.createPostgresSession(client, {
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

  private async createPostgresSession(
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
      `INSERT INTO modo_sessions(id, token_hash, user_id, organization_id, expires_at)
       VALUES ($1, $2, $3, $4, $5)`,
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

  private async authenticatePostgres(token: string): Promise<AuthContext> {
    const result = await this.requirePool().query<SessionRow>(
      `SELECT s.user_id, u.name AS user_name, u.email, u.created_at AS user_created_at,
              s.organization_id, o.name AS organization_name,
              o.created_at AS organization_created_at, m.role, s.expires_at
       FROM modo_sessions s
       JOIN modo_users u ON u.id = s.user_id
       JOIN modo_organizations o ON o.id = s.organization_id
       JOIN modo_memberships m ON m.user_id = s.user_id AND m.organization_id = s.organization_id
       WHERE s.token_hash = $1
       LIMIT 1`,
      [hashToken(token)],
    );
    const row = result.rows[0];
    if (!row || new Date(row.expires_at) <= new Date()) {
      if (row) await this.requirePool().query("DELETE FROM modo_sessions WHERE token_hash = $1", [hashToken(token)]);
      throw new AuthError("UNAUTHORIZED", 401, "Sessão inválida ou expirada.");
    }
    return {
      user: {
        id: row.user_id,
        name: row.user_name,
        email: row.email,
        createdAt: new Date(row.user_created_at).toISOString(),
      },
      organization: {
        id: row.organization_id,
        name: row.organization_name,
        role: row.role,
        createdAt: new Date(row.organization_created_at).toISOString(),
      },
    };
  }

  private requirePool() {
    if (!this.pool) throw new Error("PostgreSQL não configurado.");
    return this.pool;
  }
}
