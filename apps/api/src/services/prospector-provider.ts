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

function getPath(raw: Record<string, unknown>, path: string): unknown {
  return path.split(".").reduce<unknown>((current, key) => {
    if (!current || typeof current !== "object" || Array.isArray(current)) return undefined;
    return (current as Record<string, unknown>)[key];
  }, raw);
}

function firstPath(raw: Record<string, unknown>, paths: string[]) {
  for (const path of paths) {
    const value = firstString(getPath(raw, path));
    if (value) return value;
  }
  return null;
}

function extractLead(raw: Record<string, unknown>): ProspectorDiscoveredLead | null {
  const company = firstPath(raw, [
    "company", "companyName", "organization", "organizationName", "businessName",
    "company.name", "organization.name", "currentCompany.name",
  ]);
  const name = firstPath(raw, [
    "name", "fullName", "personName", "contactName", "person.name", "profile.name",
  ]);
  if (!company || !name) return null;
  return {
    name,
    company,
    role: firstPath(raw, ["role", "title", "jobTitle", "headline", "position", "person.title", "profile.headline"]),
    email: firstPath(raw, ["email", "workEmail", "emailAddress", "contact.email", "person.email"]),
    linkedinUrl: firstPath(raw, ["linkedinUrl", "linkedin", "profileUrl", "linkedinProfileUrl", "person.linkedinUrl"]),
    websiteUrl: firstPath(raw, ["websiteUrl", "website", "companyWebsite", "company.website", "organization.website"]),
    location: firstPath(raw, ["location", "city", "country", "locationName", "person.location"]),
    reason: firstPath(raw, ["reason", "matchReason", "qualificationReason"]),
    signal: firstPath(raw, ["signal", "intentSignal", "buyingSignal", "trigger"]),
    sourceRef: firstPath(raw, ["id", "url", "profileUrl", "linkedinUrl"]),
    metadata: raw,
  };
}

function collectObjects(value: unknown, depth = 0): Record<string, unknown>[] {
  if (depth > 3 || value == null) return [];
  if (Array.isArray(value)) return value.flatMap((item) => collectObjects(item, depth + 1));
  if (typeof value !== "object") return [];
  const raw = value as Record<string, unknown>;
  const direct = extractLead(raw) ? [raw] : [];
  const nestedKeys = ["items", "results", "leads", "people", "contacts", "data"];
  return direct.length ? direct : nestedKeys.flatMap((key) => collectObjects(raw[key], depth + 1));
}

function renderTemplate(value: unknown, variables: Record<string, unknown>): unknown {
  if (Array.isArray(value)) return value.map((item) => renderTemplate(item, variables));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, renderTemplate(item, variables)]));
  }
  if (typeof value !== "string") return value;
  const exact = value.match(/^\{\{([a-zA-Z0-9_]+)\}\}$/);
  if (exact && exact[1] in variables) return variables[exact[1]];
  return value.replace(/\{\{([a-zA-Z0-9_]+)\}\}/g, (_, key: string) => {
    const replacement = variables[key];
    return Array.isArray(replacement) ? replacement.join(", ") : String(replacement ?? "");
  });
}

export class ApifyProspectorProvider implements ProspectorProvider {
  readonly name = "apify";
  readonly configured: boolean;
  private readonly token?: string;
  private readonly actorId?: string;
  private readonly taskId?: string;
  private readonly baseUrl: string;
  private readonly inputTemplate?: unknown;
  private readonly timeoutSeconds: number;
  private readonly maxTotalChargeUsd?: number;

  constructor(options: {
    token?: string;
    actorId?: string;
    taskId?: string;
    baseUrl?: string;
    inputTemplateJson?: string;
    timeoutSeconds?: number;
    maxTotalChargeUsd?: number;
  }) {
    this.token = options.token;
    this.actorId = options.actorId;
    this.taskId = options.taskId;
    this.baseUrl = (options.baseUrl || "https://api.apify.com/v2").replace(/\/$/, "");
    this.timeoutSeconds = Math.max(30, Math.min(300, options.timeoutSeconds || 240));
    this.maxTotalChargeUsd = options.maxTotalChargeUsd && options.maxTotalChargeUsd > 0 ? options.maxTotalChargeUsd : undefined;
    if (options.inputTemplateJson?.trim()) {
      try { this.inputTemplate = JSON.parse(options.inputTemplateJson); }
      catch { throw new Error("APIFY_PROSPECTOR_INPUT_TEMPLATE_INVALID_JSON"); }
    }
    this.configured = Boolean(this.token && (this.actorId || this.taskId));
  }

  private endpoint() {
    if (this.taskId) return `${this.baseUrl}/actor-tasks/${encodeURIComponent(this.taskId)}/run-sync-get-dataset-items`;
    if (this.actorId) return `${this.baseUrl}/actors/${encodeURIComponent(this.actorId)}/run-sync-get-dataset-items`;
    throw new Error("APIFY_TARGET_NOT_CONFIGURED");
  }

  async discover(input: ProspectorDiscoveryInput): Promise<ProspectorDiscoveredLead[]> {
    if (!this.configured || !this.token) throw new Error("APIFY_NOT_CONFIGURED");
    const limit = Math.max(1, Math.min(100, input.limit || 20));
    const searchQuery = [input.segment, input.roles.join(" OR "), input.location].filter(Boolean).join(" ");
    const variables = {
      segment: input.segment,
      roles: input.roles,
      location: input.location || "",
      companySize: input.companySize || "",
      offer: input.offer || "",
      limit,
      maxItems: limit,
      searchQuery,
    };
    const body = this.inputTemplate
      ? renderTemplate(this.inputTemplate, variables)
      : {
          segment: input.segment,
          roles: input.roles,
          location: input.location || undefined,
          companySize: input.companySize || undefined,
          offer: input.offer || undefined,
          maxItems: limit,
          searchQuery,
        };
    const url = new URL(this.endpoint());
    url.searchParams.set("clean", "true");
    url.searchParams.set("format", "json");
    url.searchParams.set("timeout", String(this.timeoutSeconds));
    url.searchParams.set("maxItems", String(limit));
    if (this.maxTotalChargeUsd) url.searchParams.set("maxTotalChargeUsd", String(this.maxTotalChargeUsd));
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), (this.timeoutSeconds + 10) * 1000);
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "accept": "application/json",
          "authorization": `Bearer ${this.token}`,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (!response.ok) {
        const detail = await response.text().catch(() => "");
        throw new Error(`APIFY_HTTP_${response.status}${detail ? `:${detail.slice(0, 180)}` : ""}`);
      }
      const payload = await response.json() as unknown;
      const rows = collectObjects(payload);
      const leads = rows.map(extractLead).filter((item): item is ProspectorDiscoveredLead => Boolean(item));
      const deduped = new Map<string, ProspectorDiscoveredLead>();
      for (const lead of leads) {
        const key = `${lead.name.trim().toLowerCase()}|${lead.company.trim().toLowerCase()}`;
        if (!deduped.has(key)) deduped.set(key, lead);
      }
      return [...deduped.values()].slice(0, limit);
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") throw new Error("APIFY_TIMEOUT");
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }
}
