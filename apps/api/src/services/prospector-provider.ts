export interface ProspectorDiscoveryInput {
  segment: string;
  roles: string[];
  location?: string | null;
  companySize?: string | null;
  offer?: string | null;
  limit?: number;
}

export interface ProspectorDiscoveredLead {
  name: string;
  role?: string | null;
  company: string;
  email?: string | null;
  linkedinUrl?: string | null;
  websiteUrl?: string | null;
  location?: string | null;
  reason?: string | null;
  signal?: string | null;
  sourceRef?: string | null;
  metadata?: Record<string, unknown>;
}

export interface ProspectorProvider {
  readonly name: string;
  readonly configured: boolean;
  discover(input: ProspectorDiscoveryInput): Promise<ProspectorDiscoveredLead[]>;
}

export class ManualProspectorProvider implements ProspectorProvider {
  readonly name = "manual";
  readonly configured = false;
  async discover(): Promise<ProspectorDiscoveredLead[]> { return []; }
}

function firstString(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (Array.isArray(value)) {
    const found = value.find((item) => typeof item === "string" && item.trim());
    return typeof found === "string" ? found.trim() : null;
  }
  return null;
}

function extractLead(raw: Record<string, unknown>): ProspectorDiscoveredLead | null {
  const company = firstString(raw.company) || firstString(raw.companyName) || firstString(raw.organization) || firstString(raw.organizationName) || firstString(raw.businessName);
  const name = firstString(raw.name) || firstString(raw.fullName) || firstString(raw.personName) || firstString(raw.contactName);
  if (!company || !name) return null;
  return {
    name,
    company,
    role: firstString(raw.role) || firstString(raw.title) || firstString(raw.jobTitle),
    email: firstString(raw.email) || firstString(raw.workEmail),
    linkedinUrl: firstString(raw.linkedinUrl) || firstString(raw.linkedin) || firstString(raw.profileUrl),
    websiteUrl: firstString(raw.websiteUrl) || firstString(raw.website) || firstString(raw.companyWebsite),
    location: firstString(raw.location) || firstString(raw.city) || firstString(raw.country),
    reason: firstString(raw.reason) || firstString(raw.matchReason),
    signal: firstString(raw.signal) || firstString(raw.intentSignal),
    sourceRef: firstString(raw.id) || firstString(raw.url),
    metadata: raw,
  };
}

export class ApifyProspectorProvider implements ProspectorProvider {
  readonly name = "apify";
  readonly configured: boolean;
  private readonly token?: string;
  private readonly actorId?: string;
  private readonly baseUrl: string;

  constructor(options: { token?: string; actorId?: string; baseUrl?: string }) {
    this.token = options.token;
    this.actorId = options.actorId;
    this.baseUrl = (options.baseUrl || "https://api.apify.com/v2").replace(/\/$/, "");
    this.configured = Boolean(this.token && this.actorId);
  }

  async discover(input: ProspectorDiscoveryInput): Promise<ProspectorDiscoveredLead[]> {
    if (!this.configured || !this.token || !this.actorId) throw new Error("APIFY_NOT_CONFIGURED");
    const actor = encodeURIComponent(this.actorId);
    const response = await fetch(`${this.baseUrl}/acts/${actor}/run-sync-get-dataset-items?token=${encodeURIComponent(this.token)}&clean=true&format=json`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        segment: input.segment,
        roles: input.roles,
        location: input.location || undefined,
        companySize: input.companySize || undefined,
        offer: input.offer || undefined,
        maxItems: Math.max(1, Math.min(100, input.limit || 20)),
        searchQuery: [input.segment, input.roles.join(" OR "), input.location].filter(Boolean).join(" "),
      }),
    });
    if (!response.ok) throw new Error(`APIFY_HTTP_${response.status}`);
    const payload = await response.json() as unknown;
    const rows = Array.isArray(payload) ? payload : [];
    return rows.map((item) => item && typeof item === "object" ? extractLead(item as Record<string, unknown>) : null).filter((item): item is ProspectorDiscoveredLead => Boolean(item));
  }
}
