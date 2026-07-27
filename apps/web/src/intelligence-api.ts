import {
  IntelligenceMissionCreateSchema,
  IntelligenceMissionListSchema,
  IntelligenceMissionSchema,
  IntelligenceProviderSchema,
  intelligencePlaybookCatalog,
  type IntelligenceMissionCreate,
  type IntelligencePlaybook,
} from "@modo/contracts/intelligence";
import { getSessionToken } from "./api";

const API_URL = (import.meta.env.VITE_API_URL || "http://localhost:4000").replace(/\/$/, "");

export type IntelligenceLeadStatus =
  | "new"
  | "qualified"
  | "contacted"
  | "negotiating"
  | "won"
  | "lost"
  | "archived";

export type IntelligenceLeadPriority = "low" | "medium" | "high";

export interface IntelligenceLeadItem extends Record<string, unknown> {
  leadId: string;
  position: number;
  businessName: string;
  category: string;
  phone: string;
  website: string;
  rating: number;
  reviewsCount: number;
  address: string;
  city: string;
  state: string;
  countryCode: string;
  mapsUrl: string;
  qualityScore: number;
  contactAvailable: boolean;
  pipelineStatus: IntelligenceLeadStatus;
  priority: IntelligenceLeadPriority;
  notes: string;
  occurrenceCount: number;
  firstSeenAt: string;
  lastSeenAt: string;
}

export interface IntelligenceQuota {
  plan: "trial" | "start" | "presenca" | "pro" | "business";
  periodStart: string;
  periodEnd: string;
  monthlyRuns: number;
  monthlyItems: number;
  maxItemsPerRun: number;
  maxConcurrentRuns: number;
  runsUsed: number;
  itemsUsed: number;
  runsRemaining: number;
  itemsRemaining: number;
  runningNow: number;
}

async function request(path: string, init?: RequestInit) {
  const response = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${getSessionToken()}`,
      ...init?.headers,
    },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.message || "Não foi possível concluir a missão de inteligência.");
  return payload;
}

function quotaFromPayload(value: unknown): IntelligenceQuota {
  const source = value && typeof value === "object" ? value as Record<string, unknown> : {};
  return {
    plan: (["trial", "start", "presenca", "pro", "business"].includes(String(source.plan))
      ? String(source.plan)
      : "trial") as IntelligenceQuota["plan"],
    periodStart: String(source.periodStart || new Date().toISOString()),
    periodEnd: String(source.periodEnd || new Date().toISOString()),
    monthlyRuns: Number(source.monthlyRuns || 0),
    monthlyItems: Number(source.monthlyItems || 0),
    maxItemsPerRun: Number(source.maxItemsPerRun || 10),
    maxConcurrentRuns: Number(source.maxConcurrentRuns || 1),
    runsUsed: Number(source.runsUsed || 0),
    itemsUsed: Number(source.itemsUsed || 0),
    runsRemaining: Number(source.runsRemaining || 0),
    itemsRemaining: Number(source.itemsRemaining || 0),
    runningNow: Number(source.runningNow || 0),
  };
}

function leadFromPayload(value: unknown): IntelligenceLeadItem {
  const source = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const status = String(source.pipelineStatus || "new") as IntelligenceLeadStatus;
  const priority = String(source.priority || "medium") as IntelligenceLeadPriority;
  return {
    ...source,
    leadId: String(source.leadId || ""),
    position: Number(source.position || 0),
    businessName: String(source.businessName || ""),
    category: String(source.category || ""),
    phone: String(source.phone || ""),
    website: String(source.website || ""),
    rating: Number(source.rating || 0),
    reviewsCount: Number(source.reviewsCount || 0),
    address: String(source.address || ""),
    city: String(source.city || ""),
    state: String(source.state || ""),
    countryCode: String(source.countryCode || ""),
    mapsUrl: String(source.mapsUrl || ""),
    qualityScore: Number(source.qualityScore || 0),
    contactAvailable: Boolean(source.contactAvailable),
    pipelineStatus: ["new", "qualified", "contacted", "negotiating", "won", "lost", "archived"].includes(status)
      ? status
      : "new",
    priority: ["low", "medium", "high"].includes(priority) ? priority : "medium",
    notes: String(source.notes || ""),
    occurrenceCount: Math.max(1, Number(source.occurrenceCount || 1)),
    firstSeenAt: String(source.firstSeenAt || ""),
    lastSeenAt: String(source.lastSeenAt || ""),
  };
}

export async function getIntelligencePlaybooks() {
  const payload = await request("/api/v1/intelligence/playbooks");
  return {
    provider: IntelligenceProviderSchema.parse(payload.provider),
    configured: payload.configured as Record<IntelligencePlaybook, boolean>,
    playbooks: payload.playbooks || intelligencePlaybookCatalog,
    quota: quotaFromPayload(payload.quota),
  };
}

export async function listIntelligenceMissions() {
  return IntelligenceMissionListSchema.parse(
    await request("/api/v1/intelligence/missions"),
  ).missions;
}

export async function createIntelligenceMission(input: IntelligenceMissionCreate) {
  return IntelligenceMissionSchema.parse(
    await request("/api/v1/intelligence/missions", {
      method: "POST",
      body: JSON.stringify(IntelligenceMissionCreateSchema.parse(input)),
    }),
  );
}

export async function getIntelligenceMission(id: string) {
  return IntelligenceMissionSchema.parse(
    await request(`/api/v1/intelligence/missions/${id}`),
  );
}

export async function retryIntelligenceMission(id: string) {
  return IntelligenceMissionSchema.parse(
    await request(`/api/v1/intelligence/missions/${id}/retry`, { method: "POST" }),
  );
}

export async function getIntelligenceResults(id: string, limit = 100) {
  const payload = await request(`/api/v1/intelligence/missions/${id}/results?limit=${limit}`);
  const mission = IntelligenceMissionSchema.parse(payload.mission);
  const rawItems = Array.isArray(payload.items)
    ? payload.items.filter((item: unknown): item is Record<string, unknown> => Boolean(item) && typeof item === "object")
    : [];
  return {
    mission,
    items: mission.playbook === "b2b_prospecting"
      ? rawItems.map(leadFromPayload)
      : rawItems,
  };
}

export async function listIntelligenceLeads(filters: {
  status?: IntelligenceLeadStatus;
  priority?: IntelligenceLeadPriority;
  search?: string;
  limit?: number;
} = {}) {
  const query = new URLSearchParams();
  if (filters.status) query.set("status", filters.status);
  if (filters.priority) query.set("priority", filters.priority);
  if (filters.search) query.set("search", filters.search);
  query.set("limit", String(filters.limit || 200));
  const payload = await request(`/api/v1/intelligence/leads?${query.toString()}`);
  return Array.isArray(payload.leads) ? payload.leads.map(leadFromPayload) : [];
}

export async function updateIntelligenceLead(
  id: string,
  input: Partial<Pick<IntelligenceLeadItem, "pipelineStatus" | "priority" | "notes">>,
) {
  return leadFromPayload(await request(`/api/v1/intelligence/leads/${id}`, {
    method: "PATCH",
    body: JSON.stringify({
      status: input.pipelineStatus,
      priority: input.priority,
      notes: input.notes,
    }),
  }));
}
