import pg from "pg";

export class MetricoolService {
  private pool?: pg.Pool;
  readonly storage: "postgres" | "memory";
  private memory = new Map<string, { blogId: string; createdAt: string }>();

  constructor(private options: {
    databaseUrl?: string;
    databaseSsl?: boolean;
    userToken?: string;
    userId?: string;
    baseUrl?: string;
  }) {
    this.storage = options.databaseUrl ? "postgres" : "memory";
    if (options.databaseUrl) this.pool = new pg.Pool({ connectionString: options.databaseUrl, ssl: options.databaseSsl ? { rejectUnauthorized: false } : undefined, max: 2 });
  }

  get configured() { return Boolean(this.options.userToken && this.options.userId); }
  get mode() { return this.configured ? "metricool_wli" : "not_configured"; }
  private base() { return (this.options.baseUrl || "https://app.metricool.com").replace(/\/$/, ""); }

  async initialize() {
    if (!this.pool) return;
    await this.pool.query(`CREATE TABLE IF NOT EXISTS metricool_brand_links(
      organization_id TEXT NOT NULL,
      brand_id TEXT NOT NULL,
      metricool_blog_id TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY(organization_id, brand_id),
      UNIQUE(metricool_blog_id)
    )`);
  }

  async close() { await this.pool?.end(); }

  private key(organizationId: string, brandId: string) { return `${organizationId}:${brandId}`; }

  async getLink(organizationId: string, brandId: string) {
    if (this.pool) {
      const { rows } = await this.pool.query(`SELECT metricool_blog_id AS "blogId", created_at AS "createdAt" FROM metricool_brand_links WHERE organization_id=$1 AND brand_id=$2`, [organizationId, brandId]);
      return rows[0] || null;
    }
    return this.memory.get(this.key(organizationId, brandId)) || null;
  }

  private async metricool(path: string, init?: RequestInit) {
    if (!this.configured) throw new Error("Metricool ainda não está configurado na infraestrutura da MODO.");
    const response = await fetch(`${this.base()}${path}`, {
      ...init,
      headers: { "X-Mc-Auth": this.options.userToken!, "Content-Type": "application/json", ...(init?.headers || {}) },
    });
    const raw = await response.text();
    let payload: any = raw;
    try { payload = raw ? JSON.parse(raw) : {}; } catch {}
    if (!response.ok) throw new Error(`Metricool respondeu ${response.status}: ${typeof payload === "string" ? payload.slice(0, 240) : JSON.stringify(payload).slice(0, 240)}`);
    return payload;
  }

  private findBlogId(payload: any): string | null {
    const candidates = [payload?.id, payload?.blogId, payload?.data?.id, payload?.data?.blogId, payload?.profile?.id, payload?.profile?.blogId];
    const value = candidates.find((item) => item !== undefined && item !== null && String(item).trim());
    return value ? String(value) : null;
  }

  async provision(organizationId: string, brandId: string) {
    const existing = await this.getLink(organizationId, brandId);
    if (existing) return existing;
    const payload = await this.metricool(`/api/admin/add-profile?userId=${encodeURIComponent(this.options.userId!)}`);
    const blogId = this.findBlogId(payload);
    if (!blogId) throw new Error("A Metricool criou o perfil, mas não retornou um blogId reconhecível. Revise a conta WLI antes de tentar novamente.");
    const createdAt = new Date().toISOString();
    if (this.pool) {
      await this.pool.query(`INSERT INTO metricool_brand_links(organization_id,brand_id,metricool_blog_id) VALUES($1,$2,$3) ON CONFLICT(organization_id,brand_id) DO UPDATE SET metricool_blog_id=EXCLUDED.metricool_blog_id,updated_at=NOW()`, [organizationId, brandId, blogId]);
    } else this.memory.set(this.key(organizationId, brandId), { blogId, createdAt });
    return { blogId, createdAt };
  }

  async connectionPortal(organizationId: string, brandId: string) {
    const link = await this.provision(organizationId, brandId);
    const query = new URLSearchParams({ scope: "MANAGER", expm: "30", singleUse: "true", networks: "facebook,instagram,threads,linkedin,pinterest,tiktok,youtube,bluesky,gmb" });
    const payload = await this.metricool(`/api/v2/settings/whitelabel/logininfo/${encodeURIComponent(link.blogId)}?${query.toString()}`);
    const loginUrl = payload?.loginUrl || payload?.data?.loginUrl || payload?.url || payload?.data?.url;
    if (!loginUrl) throw new Error("A Metricool não retornou a URL temporária de conexão.");
    return { provider: "metricool", blogId: link.blogId, loginUrl: String(loginUrl), expiresInMinutes: 30, singleUse: true };
  }

  async status(organizationId: string, brandId: string) {
    const link = await this.getLink(organizationId, brandId);
    return { configured: this.configured, provider: "metricool", linked: Boolean(link), blogId: link?.blogId || null, capabilities: ["social_connection_portal","scheduling","analytics","best_time","approval_workflow"] };
  }
}
