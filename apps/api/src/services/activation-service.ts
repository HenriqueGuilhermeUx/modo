import { randomUUID } from "node:crypto";
import pg, { type Pool } from "pg";
import type { AuthService } from "./auth-service.js";
import type { ContentService } from "./content-service.js";

const { Pool: PgPool } = pg;

export const activationEventNames = [
  "onboarding_started",
  "onboarding_completed",
  "studio_opened",
  "studio_saved",
  "asset_exported",
] as const;

export type ActivationEventName = (typeof activationEventNames)[number];

type ActivationEvent = {
  id: string;
  organizationId: string;
  userId: string;
  name: ActivationEventName;
  metadata: Record<string, string | number | boolean | null>;
  createdAt: string;
};

type ActivationStep = {
  id: "account" | "brand" | "onboarding" | "content" | "approval" | "export";
  label: string;
  description: string;
  completed: boolean;
  completedAt: string | null;
};

interface ActivationServiceOptions {
  auth: AuthService;
  content: ContentService;
  databaseUrl?: string;
  databaseSsl?: boolean;
}

type EventRow = {
  id: string;
  organization_id: string;
  user_id: string;
  event_name: ActivationEventName;
  metadata: Record<string, string | number | boolean | null> | null;
  created_at: Date;
};

function mapEvent(row: EventRow): ActivationEvent {
  return {
    id: row.id,
    organizationId: row.organization_id,
    userId: row.user_id,
    name: row.event_name,
    metadata: row.metadata || {},
    createdAt: row.created_at.toISOString(),
  };
}

export class ActivationService {
  private readonly auth: AuthService;
  private readonly content: ContentService;
  private readonly pool?: Pool;
  private readonly memory: ActivationEvent[] = [];

  constructor(options: ActivationServiceOptions) {
    this.auth = options.auth;
    this.content = options.content;
    if (options.databaseUrl) {
      this.pool = new PgPool({
        connectionString: options.databaseUrl,
        ssl: options.databaseSsl ? { rejectUnauthorized: false } : undefined,
        max: 3,
      });
    }
  }

  get storage(): "memory" | "postgres" {
    return this.pool ? "postgres" : "memory";
  }

  async initialize() {
    if (!this.pool) return;
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS modo_activation_events (
        id TEXT PRIMARY KEY,
        organization_id TEXT NOT NULL REFERENCES modo_organizations(id) ON DELETE CASCADE,
        user_id TEXT NOT NULL REFERENCES modo_users(id) ON DELETE CASCADE,
        event_name TEXT NOT NULL,
        metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS modo_activation_events_org_idx
        ON modo_activation_events(organization_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS modo_activation_events_name_idx
        ON modo_activation_events(organization_id, event_name, created_at DESC);
    `);
  }

  async close() {
    await this.pool?.end();
  }

  async record(input: {
    organizationId: string;
    userId: string;
    name: ActivationEventName;
    metadata?: Record<string, string | number | boolean | null>;
  }) {
    const event: ActivationEvent = {
      id: randomUUID(),
      organizationId: input.organizationId,
      userId: input.userId,
      name: input.name,
      metadata: input.metadata || {},
      createdAt: new Date().toISOString(),
    };

    if (this.pool) {
      const result = await this.pool.query<EventRow>(
        `INSERT INTO modo_activation_events(
          id, organization_id, user_id, event_name, metadata
        ) VALUES($1,$2,$3,$4,$5::jsonb)
        RETURNING *`,
        [event.id, event.organizationId, event.userId, event.name, JSON.stringify(event.metadata)],
      );
      return mapEvent(result.rows[0]);
    }

    this.memory.unshift(event);
    return event;
  }

  private async listEvents(organizationId: string) {
    if (this.pool) {
      const result = await this.pool.query<EventRow>(
        `SELECT * FROM modo_activation_events
         WHERE organization_id=$1
         ORDER BY created_at DESC
         LIMIT 250`,
        [organizationId],
      );
      return result.rows.map(mapEvent);
    }
    return this.memory.filter((event) => event.organizationId === organizationId);
  }

  async summary(organizationId: string) {
    const [brands, requests, events] = await Promise.all([
      this.auth.listBrands(organizationId),
      this.content.list(organizationId),
      this.listEvents(organizationId),
    ]);

    const firstEvent = (name: ActivationEventName) =>
      [...events].reverse().find((event) => event.name === name)?.createdAt || null;
    const latestReady = requests.find((request) => ["ready", "approved"].includes(request.status));
    const latestApproved = requests.find((request) => request.status === "approved");

    const steps: ActivationStep[] = [
      {
        id: "account",
        label: "Conta criada",
        description: "Sua operação já possui acesso e organização próprias.",
        completed: true,
        completedAt: null,
      },
      {
        id: "brand",
        label: "Marca configurada",
        description: "A Modo conhece ao menos uma marca para orientar as entregas.",
        completed: brands.length > 0,
        completedAt: brands[brands.length - 1]?.createdAt || null,
      },
      {
        id: "onboarding",
        label: "Contexto concluído",
        description: "Objetivos, canais, oferta, provas e rotina foram organizados.",
        completed: Boolean(firstEvent("onboarding_completed")),
        completedAt: firstEvent("onboarding_completed"),
      },
      {
        id: "content",
        label: "Primeira entrega pronta",
        description: "A Modo produziu uma peça contextual para revisão.",
        completed: Boolean(latestReady),
        completedAt: latestReady?.updatedAt || null,
      },
      {
        id: "approval",
        label: "Primeira aprovação",
        description: "Uma versão passou pela decisão do cliente e ficou protegida.",
        completed: Boolean(latestApproved),
        completedAt: latestApproved?.approvedAt || latestApproved?.updatedAt || null,
      },
      {
        id: "export",
        label: "Primeiro material exportado",
        description: "Uma entrega saiu do Studio pronta para uso.",
        completed: Boolean(firstEvent("asset_exported")),
        completedAt: firstEvent("asset_exported"),
      },
    ];

    const completedCount = steps.filter((step) => step.completed).length;
    const progress = Math.round((completedCount / steps.length) * 100);
    const nextIncomplete = steps.find((step) => !step.completed);

    let nextAction = {
      label: "Criar nova campanha",
      description: "Sua operação completou o primeiro ciclo da Modo.",
      path: "/app/content",
    };

    if (nextIncomplete?.id === "brand") {
      nextAction = {
        label: "Cadastrar minha marca",
        description: "Comece pelo contexto mínimo da empresa.",
        path: "/app#brands",
      };
    } else if (nextIncomplete?.id === "onboarding") {
      nextAction = {
        label: "Concluir primeiros passos",
        description: "A Modo precisa conhecer seus objetivos e sua rotina.",
        path: "/app/onboarding",
      };
    } else if (nextIncomplete?.id === "content") {
      nextAction = {
        label: "Criar primeira entrega",
        description: "Produza uma peça contextual e acompanhe o resultado.",
        path: "/app/content",
      };
    } else if (nextIncomplete?.id === "approval") {
      nextAction = {
        label: "Revisar e aprovar",
        description: "Decida sobre a primeira versão produzida.",
        path: latestReady ? `/app/content?open=${latestReady.id}` : "/app/content",
      };
    } else if (nextIncomplete?.id === "export") {
      nextAction = {
        label: "Finalizar e exportar",
        description: "Abra a peça aprovada no Studio e baixe o material.",
        path: latestApproved ? `/app/studio/${latestApproved.id}` : "/app/content",
      };
    }

    return {
      activated: completedCount === steps.length,
      progress,
      completedCount,
      totalSteps: steps.length,
      steps,
      nextAction,
      metrics: {
        brands: brands.length,
        requests: requests.length,
        ready: requests.filter((request) => request.status === "ready").length,
        approved: requests.filter((request) => request.status === "approved").length,
        failed: requests.filter((request) => request.status === "failed").length,
        exports: events.filter((event) => event.name === "asset_exported").length,
      },
    };
  }
}
