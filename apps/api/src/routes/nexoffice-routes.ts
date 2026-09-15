import { timingSafeEqual } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";

const GrowthRequestSchema = z.object({
  actionType: z.string().min(1).max(120).default("growth.opportunity"),
  correlationId: z.string().min(1).max(220),
  commandActionId: z.string().max(120).optional().nullable(),
  goal: z.string().max(1000).optional().nullable(),
  audience: z.string().max(1000).optional().nullable(),
  offer: z.string().max(1200).optional().nullable(),
  context: z.record(z.string(), z.unknown()).default({}),
  signals: z.record(z.string(), z.unknown()).default({}),
});

type BridgeOptions = {
  serviceKey?: string;
};

function safeEqual(received: string, expected: string) {
  if (!received || !expected) return false;
  const a = Buffer.from(received);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

function auth(request: FastifyRequest, expected: string) {
  const key = String(request.headers["x-nexoffice-key"] || "");
  const workspaceId = String(request.headers["x-nexoffice-workspace-id"] || "").trim();
  if (!expected) return { ok: false as const, status: 503, error: "bridge_not_configured" };
  if (!safeEqual(key, expected)) return { ok: false as const, status: 401, error: "unauthorized" };
  if (!workspaceId) return { ok: false as const, status: 400, error: "workspace_required" };
  return { ok: true as const, workspaceId };
}

function unsupportedExecution(actionType: string) {
  return /(publish|publication|post\.send|budget|spend|ads?\.(create|update|launch)|campaign\.launch)/i.test(actionType);
}

function numberSignal(signals: Record<string, unknown>, names: string[]) {
  for (const name of names) {
    const value = Number(signals[name]);
    if (Number.isFinite(value)) return value;
  }
  return 0;
}

function buildProposal(input: z.infer<typeof GrowthRequestSchema>, workspaceId: string) {
  const signals = input.signals || {};
  const openDeals = numberSignal(signals, ["openDeals", "open_deals", "pipelineCount"]);
  const leads = numberSignal(signals, ["leads", "newLeads", "new_leads"]);
  const cancelledSlots = numberSignal(signals, ["cancelledSlots", "cancelled_slots", "availableSlots"]);
  const wonDeals = numberSignal(signals, ["wonDeals", "won_deals", "customers"]);

  let objective = input.goal?.trim() || "Gerar demanda qualificada e acelerar conversão";
  let primaryAngle = "prova de valor com chamada clara para o próximo passo";
  let priority = "normal";
  const reasons: string[] = [];

  if (cancelledSlots > 0) {
    objective = input.goal?.trim() || "Preencher capacidade disponível rapidamente";
    primaryAngle = "disponibilidade limitada + benefício imediato";
    priority = "high";
    reasons.push(`${cancelledSlots} oportunidade(s) de agenda/capacidade disponível`);
  }
  if (leads > Math.max(5, openDeals * 0.5)) {
    primaryAngle = "nutrição e conversão dos leads já captados";
    reasons.push("volume relevante de leads pede ativação antes de ampliar aquisição");
  }
  if (openDeals > 0) reasons.push(`${openDeals} oportunidade(s) abertas no funil`);
  if (wonDeals > 0) reasons.push("base de clientes permite explorar prova social, indicação e reativação");
  if (!reasons.length) reasons.push("sinal operacional recebido do NexOffice");

  const audience = input.audience?.trim() || "segmento prioritário do workspace";
  const offer = input.offer?.trim() || "oferta principal do negócio";
  const channels = cancelledSlots > 0 ? ["WhatsApp", "Instagram Stories", "Google Business Profile"] : ["Instagram", "WhatsApp", "LinkedIn/Google Business Profile conforme perfil B2B/B2C"];

  return {
    id: `modo-${input.correlationId}`,
    workspaceId,
    correlationId: input.correlationId,
    actionType: input.actionType,
    priority,
    objective,
    audience,
    offer,
    thesis: primaryAngle,
    reasons,
    channels,
    content: [
      { format: "post", angle: primaryAngle, cta: "Fale com a equipe / solicite uma proposta" },
      { format: "story/status", angle: "urgência leve + benefício", cta: "Responder agora" },
      { format: "follow-up", angle: "retomar interesse com contexto", cta: "Confirmar interesse" },
    ],
    experiments: [
      { name: "Mensagem A/B", metric: "taxa de resposta", variants: ["benefício direto", "prova social"] },
      { name: "CTA A/B", metric: "conversão em contato", variants: ["falar agora", "receber proposta"] },
    ],
    governance: {
      planningOnly: true,
      published: false,
      budgetChanged: false,
      requiresHumanApprovalBeforeExternalEffect: true,
    },
  };
}

export async function registerNexOfficeRoutes(app: FastifyInstance, options: BridgeOptions = {}) {
  const expectedKey = options.serviceKey || process.env.NEXOFFICE_SERVICE_KEY || "";

  app.get("/api/v1/internal/nexoffice/health", async (request, reply) => {
    const access = auth(request, expectedKey);
    if (!access.ok) return reply.code(access.status).send({ status: "error", error: access.error });
    return {
      status: "ok",
      service: "modo-nexoffice-bridge",
      workspaceId: access.workspaceId,
      capabilities: ["growth.plan", "campaign.propose", "content.suggest"],
      externalEffects: false,
    };
  });

  app.post("/api/v1/internal/nexoffice/growth", async (request, reply) => {
    const access = auth(request, expectedKey);
    if (!access.ok) return reply.code(access.status).send({ success: false, error: access.error });

    const parsed = GrowthRequestSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: "invalid_request", issues: parsed.error.issues });
    if (unsupportedExecution(parsed.data.actionType)) {
      return reply.code(409).send({
        success: false,
        error: "human_approval_and_native_publisher_required",
        message: "O bridge NexOffice → MODO planeja e recomenda; publicação e orçamento exigem fluxo nativo de aprovação do MODO.",
      });
    }

    const proposal = buildProposal(parsed.data, access.workspaceId);
    request.log.info({ workspaceId: access.workspaceId, correlationId: parsed.data.correlationId, actionType: parsed.data.actionType }, "NexOffice growth signal processed by MODO");
    return { success: true, proposal };
  });
}
