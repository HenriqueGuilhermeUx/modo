import type {
  IntelligenceBrandContext,
  IntelligenceCallback,
  IntelligenceMission,
  IntelligenceMissionCreate,
  IntelligenceMissionStatus,
  IntelligencePlaybook,
  IntelligenceProvider,
} from "@modo/contracts/intelligence";
import { randomUUID } from "node:crypto";
import pg, { type Pool } from "pg";

const { Pool: PgPool } = pg;

interface Options {
  databaseUrl?: string;
  databaseSsl?: boolean;
  provider?: IntelligenceProvider;
  apifyBaseUrl?: string;
  apifyToken?: string;
  n8nWebhookUrl?: string;
  n8nSecret?: string;
  publicApiUrl?: string;
  callbackSecret?: string;
  requestTimeoutMs?: number;
  taskIds?: Partial<Record<IntelligencePlaybook, string>>;
}

type MissionRow = {
  id: string;
  organization_id: string;
  user_id: string;
  brand_id: string;
  name: string;
  playbook: IntelligencePlaybook;
  objective: string;
  input: IntelligenceMissionCreate | string;
  provider: IntelligenceProvider;
  status: IntelligenceMissionStatus;
  task_id: string;
  provider_run_id: string;
  provider_dataset_id: string;
  provider_message: string;
  result_count: number;
  result_preview: Record<string, unknown>[] | string;
  created_at: Date;
  updated_at: Date;
};

type ApifyRun = {
  id?: string;
  status?: string;
  defaultDatasetId?: string;
};

function parseJson<T>(value: T | string, fallback: T): T {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function mapRow(row: MissionRow): IntelligenceMission {
  const input = parseJson<IntelligenceMissionCreate>(row.input, {
    brandId: row.brand_id,
    name: row.name,
    playbook: row.playbook,
    objective: row.objective,
    regions: [],
    keywords: [],
    competitors: [],
    products: [],
    maxItems: 100,
  });
  return {
    ...input,
    id: row.id,
    organizationId: row.organization_id,
    userId: row.user_id,
    provider: row.provider,
    status: row.status,
    taskId: row.task_id || "",
    providerRunId: row.provider_run_id || "",
    providerDatasetId: row.provider_dataset_id || "",
    providerMessage: row.provider_message || "",
    resultCount: Number(row.result_count || 0),
    resultPreview: parseJson<Record<string, unknown>[]>(row.result_preview, []),
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

function actorInput(
  mission: IntelligenceMission,
  brand: IntelligenceBrandContext,
): Record<string, unknown> {
  return {
    modoMissionId: mission.id,
    playbook: mission.playbook,
    objective: mission.objective,
    brand,
    regions: mission.regions,
    keywords: mission.keywords,
    competitors: mission.competitors,
    products: mission.products,
    maxItems: mission.maxItems,
  };
}

function mapApifyStatus(value = ""): IntelligenceMissionStatus {
  if (value === "SUCCEEDED") return "succeeded";
  if (["FAILED", "ABORTED", "TIMED-OUT"].includes(value)) return "failed";
  return "running";
}

function textValue(value: unknown, maxLength: number) {
  if (typeof value !== "string") return "";
  return value.trim().replace(/\s+/g, " ").slice(0, maxLength);
}

function publicUrl(value: unknown) {
  const text = textValue(value, 1000);
  if (!text) return "";
  try {
    const url = new URL(text);
    return ["http:", "https:"].includes(url.protocol) ? url.toString() : "";
  } catch {
    return "";
  }
}

function dateValue(value: unknown) {
  if (typeof value === "string" || value instanceof Date) {
    const date = new Date(value);
    if (!Number.isNaN(date.getTime())) return date.toISOString();
  }
  return new Date().toISOString();
}

function recordValue(value: unknown): Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

export function normalizeMarketRadarItems(
  items: Record<string, unknown>[],
  limit = 100,
) {
  const seen = new Set<string>();
  const normalized: Record<string, unknown>[] = [];

  for (const item of items) {
    const source = textValue(item.source ?? item.platform ?? item.provider, 120) || "public_web";
    const name = textValue(
      item.name ?? item.title ?? item.companyName ?? item.businessName ?? item.advertiserName,
      240,
    ) || "Resultado coletado";
    const url = publicUrl(
      item.url ?? item.website ?? item.websiteUrl ?? item.profileUrl ?? item.sourceUrl,
    );
    const summary = textValue(
      item.summary ?? item.description ?? item.text ?? item.about ?? item.snippet,
      2000,
    );
    const signals = recordValue(item.signals ?? item.metrics ?? item.metadata);
    const collectedAt = dateValue(item.collectedAt ?? item.scrapedAt ?? item.createdAt);
    const key = `${source.toLowerCase()}|${url || name.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    normalized.push({ source, name, url, summary, signals, collectedAt });
    if (normalized.length >= limit) break;
  }

  return normalized;
}

function normalizeItems(
  playbook: IntelligencePlaybook,
  items: Record<string, unknown>[],
  limit: number,
) {
  if (playbook === "market_radar") return normalizeMarketRadarItems(items, limit);
  return items
    .filter((item) => Boolean(item) && typeof item === "object" && !Array.isArray(item))
    .slice(0, limit);
}

export class IntelligenceError extends Error {
  constructor(
    public readonly code: string,
    public readonly statusCode: number,
    message: string,
  ) {
    super(message);
  }
}

export class IntelligenceService {
  private readonly pool?: Pool;
  private readonly memory = new Map<string, IntelligenceMission>();
  private readonly brandMemory = new Map<string, IntelligenceBrandContext>();
  private readonly apifyBaseUrl: string;
  private readonly apifyToken?: string;
  private readonly n8nWebhookUrl?: string;
  private readonly n8nSecret?: string;
  private readonly publicApiUrl: string;
  private readonly callbackSecret?: string;
  private readonly requestTimeoutMs: number;
  private readonly taskIds: Partial<Record<IntelligencePlaybook, string>>;
  public readonly mode: IntelligenceProvider;
  public readonly storage: "postgres" | "memory";

  constructor(options: Options = {}) {
    this.mode = options.provider ?? "queue";
    this.apifyBaseUrl = (options.apifyBaseUrl || "https://api.apify.com/v2").replace(/\/$/, "");
    this.apifyToken = options.apifyToken?.trim() || undefined;
    this.n8nWebhookUrl = options.n8nWebhookUrl?.trim() || undefined;
    this.n8nSecret = options.n8nSecret?.trim() || undefined;
    this.publicApiUrl = (options.publicApiUrl || "http://localhost:4000").replace(/\/$/, "");
    this.callbackSecret = options.callbackSecret?.trim() || undefined;
    this.requestTimeoutMs = Math.min(120_000, Math.max(1_000, Number(options.requestTimeoutMs || 30_000)));
    this.taskIds = options.taskIds ?? {};

    if (this.mode === "apify" && !this.apifyToken) {
      throw new Error("APIFY_API_TOKEN é obrigatório quando INTELLIGENCE_PROVIDER=apify.");
    }
    if (this.mode === "n8n" && (!this.n8nWebhookUrl || !this.n8nSecret || !this.callbackSecret)) {
      throw new Error(
        "N8N_INTELLIGENCE_WEBHOOK_URL, N8N_INTELLIGENCE_SECRET e INTELLIGENCE_CALLBACK_SECRET são obrigatórios quando INTELLIGENCE_PROVIDER=n8n.",
      );
    }

    if (options.databaseUrl) {
      this.pool = new PgPool({
        connectionString: options.databaseUrl,
        ssl: options.databaseSsl ? { rejectUnauthorized: false } : undefined,
        max: 4,
      });
    }
    this.storage = this.pool ? "postgres" : "memory";
  }

  async initialize() {
    if (!this.pool) return;
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS modo_intelligence_missions (
        id TEXT PRIMARY KEY,
        organization_id TEXT NOT NULL REFERENCES modo_organizations(id) ON DELETE CASCADE,
        user_id TEXT NOT NULL,
        brand_id TEXT NOT NULL,
        name TEXT NOT NULL,
        playbook TEXT NOT NULL,
        objective TEXT NOT NULL,
        input JSONB NOT NULL,
        provider TEXT NOT NULL DEFAULT 'queue',
        status TEXT NOT NULL DEFAULT 'queued',
        task_id TEXT NOT NULL DEFAULT '',
        provider_run_id TEXT NOT NULL DEFAULT '',
        provider_dataset_id TEXT NOT NULL DEFAULT '',
        provider_message TEXT NOT NULL DEFAULT '',
        result_count INTEGER NOT NULL DEFAULT 0,
        result_preview JSONB NOT NULL DEFAULT '[]'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS modo_intelligence_missions_org_idx
        ON modo_intelligence_missions(organization_id, updated_at DESC);
      CREATE INDEX IF NOT EXISTS modo_intelligence_missions_status_idx
        ON modo_intelligence_missions(status, updated_at DESC);
    `);
  }

  async close() {
    await this.pool?.end();
  }

  configuredPlaybooks() {
    return {
      market_radar: Boolean(this.taskIds.market_radar),
      b2b_prospecting: Boolean(this.taskIds.b2b_prospecting),
      price_monitoring: Boolean(this.taskIds.price_monitoring),
    };
  }

  private providerFor(playbook: IntelligencePlaybook): IntelligenceProvider {
    if (this.mode === "apify" && !this.taskIds[playbook]?.trim()) return "queue";
    return this.mode;
  }

  async create(
    organizationId: string,
    userId: string,
    input: IntelligenceMissionCreate,
    brand: IntelligenceBrandContext,
  ) {
    const id = randomUUID();
    const now = new Date().toISOString();
    const taskId = this.taskIds[input.playbook]?.trim() || "";
    const provider = this.providerFor(input.playbook);
    const mission: IntelligenceMission = {
      ...input,
      id,
      organizationId,
      userId,
      provider,
      status: "queued",
      taskId,
      providerRunId: "",
      providerDatasetId: "",
      providerMessage: provider === "queue"
        ? "Missão salva na fila interna. A coleta externa deste playbook ainda não foi ativada."
        : "Missão pronta para execução.",
      resultCount: 0,
      resultPreview: [],
      createdAt: now,
      updatedAt: now,
    };

    await this.save(mission);
    this.brandMemory.set(mission.id, brand);
    return this.dispatch(mission, brand);
  }

  async list(organizationId: string) {
    if (this.pool) {
      const result = await this.pool.query<MissionRow>(
        `SELECT * FROM modo_intelligence_missions
         WHERE organization_id=$1 ORDER BY updated_at DESC LIMIT 200`,
        [organizationId],
      );
      return result.rows.map(mapRow).map((mission) => ({
        ...mission,
        resultPreview: normalizeItems(mission.playbook, mission.resultPreview, 100),
      }));
    }
    return [...this.memory.values()]
      .filter((item) => item.organizationId === organizationId)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async get(id: string, organizationId: string, refresh = true) {
    const mission = await this.getStored(id);
    if (!mission || mission.organizationId !== organizationId) {
      throw new IntelligenceError("INTELLIGENCE_MISSION_NOT_FOUND", 404, "Missão de inteligência não encontrada.");
    }
    if (refresh && mission.provider === "apify" && mission.status === "running" && mission.providerRunId) {
      return this.refreshApifyRun(mission);
    }
    return {
      ...mission,
      resultPreview: normalizeItems(mission.playbook, mission.resultPreview, 100),
    };
  }

  async retry(id: string, organizationId: string, brand: IntelligenceBrandContext) {
    const mission = await this.get(id, organizationId, false);
    const provider = this.providerFor(mission.playbook);
    const taskId = this.taskIds[mission.playbook]?.trim() || "";
    const queued = await this.update(id, {
      provider,
      status: "queued",
      taskId,
      providerRunId: "",
      providerDatasetId: "",
      providerMessage: provider === "queue"
        ? "Missão mantida na fila interna; a automação deste playbook ainda não foi ativada."
        : "Missão preparada para nova execução.",
      resultCount: 0,
      resultPreview: [],
    });
    this.brandMemory.set(id, brand);
    return this.dispatch(queued, brand);
  }

  async results(id: string, organizationId: string, limit = 100) {
    const mission = await this.get(id, organizationId);
    const safeLimit = Math.min(500, Math.max(1, limit));
    if (mission.provider === "apify" && mission.providerDatasetId && mission.status === "succeeded") {
      return {
        mission,
        items: await this.fetchDatasetItems(mission.providerDatasetId, safeLimit, mission.playbook),
      };
    }
    return {
      mission,
      items: normalizeItems(mission.playbook, mission.resultPreview, safeLimit),
    };
  }

  validateCallbackSecret(value: string) {
    if (!this.callbackSecret || value !== this.callbackSecret) {
      throw new IntelligenceError("INTELLIGENCE_CALLBACK_UNAUTHORIZED", 401, "Callback de inteligência não autorizado.");
    }
  }

  async applyCallback(id: string, callback: IntelligenceCallback) {
    const mission = await this.getStored(id);
    if (!mission) {
      throw new IntelligenceError("INTELLIGENCE_MISSION_NOT_FOUND", 404, "Missão de inteligência não encontrada.");
    }
    const normalizedPreview = normalizeItems(
      mission.playbook,
      callback.resultPreview,
      Math.min(100, Math.max(1, callback.resultPreview.length || 1)),
    );
    return this.update(id, {
      status: callback.status === "completed" ? "succeeded" : "failed",
      providerRunId: callback.providerRunId || mission.providerRunId,
      providerDatasetId: callback.providerDatasetId || mission.providerDatasetId,
      providerMessage: callback.status === "completed"
        ? `Coleta concluída com ${callback.resultCount} registro(s).`
        : callback.error || "A coleta não pôde ser concluída.",
      resultCount: callback.resultCount,
      resultPreview: normalizedPreview,
    });
  }

  private async dispatch(mission: IntelligenceMission, brand: IntelligenceBrandContext) {
    if (mission.provider === "queue") return mission;
    if (mission.provider === "n8n") return this.dispatchN8n(mission, brand);
    if (!mission.taskId) {
      return this.update(mission.id, {
        provider: "queue",
        status: "queued",
        providerMessage: `Playbook ${mission.playbook} mantido na fila interna porque nenhuma Task do Apify foi configurada.`,
      });
    }
    return this.dispatchApify(mission, brand);
  }

  private async dispatchApify(mission: IntelligenceMission, brand: IntelligenceBrandContext) {
    try {
      const response = await fetch(
        `${this.apifyBaseUrl}/actor-tasks/${encodeURIComponent(mission.taskId)}/runs`,
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${this.apifyToken}`,
            "content-type": "application/json",
          },
          body: JSON.stringify(actorInput(mission, brand)),
          signal: AbortSignal.timeout(this.requestTimeoutMs),
        },
      );
      const payload = (await response.json().catch(() => ({}))) as { data?: ApifyRun; error?: { message?: string } };
      if (!response.ok || !payload.data?.id) {
        throw new Error(payload.error?.message || `Apify respondeu ${response.status}.`);
      }
      return this.update(mission.id, {
        status: mapApifyStatus(payload.data.status),
        providerRunId: payload.data.id,
        providerDatasetId: payload.data.defaultDatasetId || "",
        providerMessage: "Coleta iniciada no Apify.",
      });
    } catch (error) {
      return this.update(mission.id, {
        status: "failed",
        providerMessage: error instanceof Error ? error.message.slice(0, 2000) : "Falha ao iniciar a coleta no Apify.",
      });
    }
  }

  private async dispatchN8n(mission: IntelligenceMission, brand: IntelligenceBrandContext) {
    try {
      const response = await fetch(this.n8nWebhookUrl!, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-modo-secret": this.n8nSecret!,
          "idempotency-key": mission.id,
        },
        body: JSON.stringify({
          missionId: mission.id,
          playbook: mission.playbook,
          taskId: mission.taskId,
          actorInput: actorInput(mission, brand),
          callbackUrl: `${this.publicApiUrl}/api/v1/internal/intelligence/missions/${mission.id}/result`,
        }),
        signal: AbortSignal.timeout(this.requestTimeoutMs),
      });
      const detail = (await response.text().catch(() => "")).slice(0, 1000);
      if (!response.ok) throw new Error(detail || `n8n respondeu ${response.status}.`);
      return this.update(mission.id, {
        status: "running",
        providerMessage: detail || "Missão encaminhada ao n8n.",
      });
    } catch (error) {
      return this.update(mission.id, {
        status: "failed",
        providerMessage: error instanceof Error ? error.message.slice(0, 2000) : "Falha ao encaminhar a missão ao n8n.",
      });
    }
  }

  private async refreshApifyRun(mission: IntelligenceMission) {
    try {
      const response = await fetch(`${this.apifyBaseUrl}/actor-runs/${encodeURIComponent(mission.providerRunId)}`, {
        headers: { authorization: `Bearer ${this.apifyToken}` },
        signal: AbortSignal.timeout(this.requestTimeoutMs),
      });
      const payload = (await response.json().catch(() => ({}))) as { data?: ApifyRun; error?: { message?: string } };
      if (!response.ok || !payload.data) {
        throw new Error(payload.error?.message || `Apify respondeu ${response.status}.`);
      }
      const status = mapApifyStatus(payload.data.status);
      const datasetId = payload.data.defaultDatasetId || mission.providerDatasetId;
      if (status !== "succeeded") {
        return this.update(mission.id, {
          status,
          providerDatasetId: datasetId,
          providerMessage: status === "failed" ? `A execução terminou com status ${payload.data.status}.` : "Coleta em andamento.",
        });
      }
      const preview = datasetId
        ? await this.fetchDatasetItems(datasetId, 100, mission.playbook)
        : [];
      return this.update(mission.id, {
        status: "succeeded",
        providerDatasetId: datasetId,
        providerMessage: `Coleta concluída com ${preview.length} registro(s) carregado(s) na prévia.`,
        resultCount: preview.length,
        resultPreview: preview,
      });
    } catch (error) {
      return this.update(mission.id, {
        providerMessage: error instanceof Error ? error.message.slice(0, 2000) : "Não foi possível atualizar a execução.",
      });
    }
  }

  private async fetchDatasetItems(
    datasetId: string,
    limit: number,
    playbook: IntelligencePlaybook,
  ) {
    const response = await fetch(
      `${this.apifyBaseUrl}/datasets/${encodeURIComponent(datasetId)}/items?clean=true&format=json&limit=${limit}`,
      {
        headers: { authorization: `Bearer ${this.apifyToken}` },
        signal: AbortSignal.timeout(this.requestTimeoutMs),
      },
    );
    const payload = await response.json().catch(() => []);
    if (!response.ok) throw new Error(`Não foi possível carregar o dataset do Apify (${response.status}).`);
    if (!Array.isArray(payload)) return [];
    const records = payload.filter(
      (item): item is Record<string, unknown> => Boolean(item) && typeof item === "object" && !Array.isArray(item),
    );
    return normalizeItems(playbook, records, limit);
  }

  private async save(mission: IntelligenceMission) {
    if (this.pool) {
      await this.pool.query(
        `INSERT INTO modo_intelligence_missions(
          id,organization_id,user_id,brand_id,name,playbook,objective,input,provider,status,
          task_id,provider_run_id,provider_dataset_id,provider_message,result_count,result_preview
        ) VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10,$11,$12,$13,$14,$15,$16::jsonb)`,
        [
          mission.id,
          mission.organizationId,
          mission.userId,
          mission.brandId,
          mission.name,
          mission.playbook,
          mission.objective,
          JSON.stringify({
            brandId: mission.brandId,
            name: mission.name,
            playbook: mission.playbook,
            objective: mission.objective,
            regions: mission.regions,
            keywords: mission.keywords,
            competitors: mission.competitors,
            products: mission.products,
            maxItems: mission.maxItems,
          }),
          mission.provider,
          mission.status,
          mission.taskId,
          mission.providerRunId,
          mission.providerDatasetId,
          mission.providerMessage,
          mission.resultCount,
          JSON.stringify(mission.resultPreview),
        ],
      );
      return;
    }
    this.memory.set(mission.id, mission);
  }

  private async getStored(id: string): Promise<IntelligenceMission | null> {
    if (this.pool) {
      const result = await this.pool.query<MissionRow>(
        `SELECT * FROM modo_intelligence_missions WHERE id=$1 LIMIT 1`,
        [id],
      );
      return result.rows[0] ? mapRow(result.rows[0]) : null;
    }
    return this.memory.get(id) ?? null;
  }

  private async update(
    id: string,
    patch: Partial<Pick<
      IntelligenceMission,
      | "provider"
      | "status"
      | "taskId"
      | "providerRunId"
      | "providerDatasetId"
      | "providerMessage"
      | "resultCount"
      | "resultPreview"
    >>,
  ) {
    const current = await this.getStored(id);
    if (!current) throw new IntelligenceError("INTELLIGENCE_MISSION_NOT_FOUND", 404, "Missão de inteligência não encontrada.");
    const updated: IntelligenceMission = {
      ...current,
      ...patch,
      updatedAt: new Date().toISOString(),
    };

    if (this.pool) {
      const result = await this.pool.query<MissionRow>(
        `UPDATE modo_intelligence_missions SET
          provider=$2,status=$3,task_id=$4,provider_run_id=$5,provider_dataset_id=$6,
          provider_message=$7,result_count=$8,result_preview=$9::jsonb,updated_at=NOW()
         WHERE id=$1 RETURNING *`,
        [
          id,
          updated.provider,
          updated.status,
          updated.taskId,
          updated.providerRunId,
          updated.providerDatasetId,
          updated.providerMessage,
          updated.resultCount,
          JSON.stringify(updated.resultPreview),
        ],
      );
      return mapRow(result.rows[0]);
    }

    this.memory.set(id, updated);
    return updated;
  }
}
