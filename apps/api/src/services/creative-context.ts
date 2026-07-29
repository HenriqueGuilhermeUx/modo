import type {
  BrandFoundation,
  ChannelPlanItem,
  RevenueMapUpsert,
} from "@modo/contracts/strategy-network";
import pg, { type Pool } from "pg";

const { Pool: PgPool } = pg;
let pool: Pool | undefined;

function getPool() {
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl) return undefined;
  if (!pool) {
    const sslEnabled = ["true", "1", "yes", "on"].includes(
      (process.env.DATABASE_SSL || "").trim().toLowerCase(),
    );
    pool = new PgPool({
      connectionString: databaseUrl,
      ssl: sslEnabled ? { rejectUnauthorized: false } : undefined,
      max: 2,
    });
  }
  return pool;
}

export interface CreativeGenerationContext {
  memory: {
    peopleAvailable: string[];
    comfortableOnCamera: boolean;
    weeklyMinutesAvailable: number;
    locations: string[];
    productsOrServicesToShow: string[];
    proofAvailable: string[];
    recurringQuestions: string[];
    currentPriorities: string[];
    prohibitedTopics: string[];
    preferredChannels: string[];
    notes: string;
  } | null;
  foundation: BrandFoundation | null;
  channelMap: ChannelPlanItem[];
  revenueMap: RevenueMapUpsert | null;
  performance: {
    channel: string;
    averageScore: number;
    items: number;
    leads: number;
    conversions: number;
    revenueCents: number;
  }[];
  recentLearning: {
    signal: string;
    score: number | null;
    notes: string | null;
  }[];
}

const emptyContext = (): CreativeGenerationContext => ({
  memory: null,
  foundation: null,
  channelMap: [],
  revenueMap: null,
  performance: [],
  recentLearning: [],
});

export async function loadCreativeGenerationContext(
  accountId: string,
  brandId: string,
): Promise<CreativeGenerationContext> {
  const database = getPool();
  if (!database) return emptyContext();

  try {
    const [profileResult, performanceResult, learningResult] = await Promise.all([
      database.query<{
        people_available: string[];
        comfortable_on_camera: boolean;
        weekly_minutes_available: number;
        locations: string[];
        products_or_services_to_show: string[];
        proof_available: string[];
        recurring_questions: string[];
        current_priorities: string[];
        prohibited_topics: string[];
        preferred_channels: string[];
        notes: string;
      }>(
        `SELECT people_available,comfortable_on_camera,weekly_minutes_available,
          locations,products_or_services_to_show,proof_available,recurring_questions,
          current_priorities,prohibited_topics,preferred_channels,notes
         FROM modo_creative_profiles
         WHERE account_id=$1 AND brand_id=$2 LIMIT 1`,
        [accountId, brandId],
      ),
      database.query<{
        channel: string;
        average_score: number;
        items: number;
        leads: number;
        conversions: number;
        revenue_cents: number;
      }>(
        `SELECT channel,
          ROUND(AVG(score))::int AS average_score,
          COUNT(*)::int AS items,
          COALESCE(SUM(leads),0)::int AS leads,
          COALESCE(SUM(conversions),0)::int AS conversions,
          COALESCE(SUM(revenue_cents),0)::int AS revenue_cents
         FROM modo_performance_signals
         WHERE account_id=$1 AND brand_id=$2
         GROUP BY channel
         ORDER BY average_score DESC
         LIMIT 8`,
        [accountId, brandId],
      ),
      database.query<{
        signal: string;
        score: number | null;
        notes: string | null;
      }>(
        `SELECT signal,score,notes
         FROM modo_creative_feedback
         WHERE account_id=$1 AND brand_id=$2
           AND (notes IS NOT NULL OR score IS NOT NULL)
         ORDER BY created_at DESC
         LIMIT 12`,
        [accountId, brandId],
      ),
    ]);

    let foundation: BrandFoundation | null = null;
    let channelMap: ChannelPlanItem[] = [];
    let revenueMap: RevenueMapUpsert | null = null;
    try {
      const [foundationResult, channelResult, revenueResult] = await Promise.all([
        database.query<{ foundation: BrandFoundation }>(
          `SELECT foundation FROM modo_brand_foundations
           WHERE organization_id=$1 AND brand_id=$2 LIMIT 1`,
          [accountId, brandId],
        ),
        database.query<{ channels: ChannelPlanItem[] }>(
          `SELECT channels FROM modo_channel_maps
           WHERE organization_id=$1 AND brand_id=$2 LIMIT 1`,
          [accountId, brandId],
        ),
        database.query<{ payload: RevenueMapUpsert }>(
          `SELECT payload FROM modo_revenue_maps
           WHERE organization_id=$1 AND brand_id=$2 LIMIT 1`,
          [accountId, brandId],
        ),
      ]);
      foundation = foundationResult.rows[0]?.foundation || null;
      channelMap = channelResult.rows[0]?.channels || [];
      revenueMap = revenueResult.rows[0]?.payload || null;
    } catch {
      // Contas e ambientes anteriores continuam gerando mesmo antes das novas tabelas existirem.
    }

    const row = profileResult.rows[0];
    return {
      memory: row
        ? {
            peopleAvailable: row.people_available,
            comfortableOnCamera: row.comfortable_on_camera,
            weeklyMinutesAvailable: row.weekly_minutes_available,
            locations: row.locations,
            productsOrServicesToShow: row.products_or_services_to_show,
            proofAvailable: row.proof_available,
            recurringQuestions: row.recurring_questions,
            currentPriorities: row.current_priorities,
            prohibitedTopics: row.prohibited_topics,
            preferredChannels: row.preferred_channels,
            notes: row.notes,
          }
        : null,
      foundation,
      channelMap,
      revenueMap,
      performance: performanceResult.rows.map((item) => ({
        channel: item.channel,
        averageScore: Number(item.average_score),
        items: Number(item.items),
        leads: Number(item.leads),
        conversions: Number(item.conversions),
        revenueCents: Number(item.revenue_cents),
      })),
      recentLearning: learningResult.rows.map((item) => ({
        signal: item.signal,
        score: item.score === null ? null : Number(item.score),
        notes: item.notes,
      })),
    };
  } catch {
    return emptyContext();
  }
}

export function formatCreativeContext(context: CreativeGenerationContext, requestedChannel?: string) {
  const lines: string[] = [];
  if (context.foundation) {
    const base = context.foundation;
    if (base.audience.priority) lines.push(`PÚBLICO PRIORITÁRIO: ${base.audience.priority}`);
    if (base.audience.pains.length) lines.push(`DORES: ${base.audience.pains.join("; ")}`);
    if (base.audience.desires.length) lines.push(`DESEJOS: ${base.audience.desires.join("; ")}`);
    if (base.audience.objections.length) lines.push(`OBJEÇÕES: ${base.audience.objections.join("; ")}`);
    if (base.worldview.belief) lines.push(`CRENÇA DA MARCA: ${base.worldview.belief}`);
    if (base.worldview.marketProblem) lines.push(`PROBLEMA PERCEBIDO NO MERCADO: ${base.worldview.marketProblem}`);
    if (base.positioning.differentiator) lines.push(`DIFERENCIAL: ${base.positioning.differentiator}`);
    if (base.positioning.forWhom) lines.push(`PARA QUEM É: ${base.positioning.forWhom}`);
    if (base.positioning.notForWhom) lines.push(`PARA QUEM NÃO É: ${base.positioning.notForWhom}`);
    if (base.promise.transformation) lines.push(`TRANSFORMAÇÃO: ${base.promise.transformation}`);
    if (base.promise.mainBenefit) lines.push(`BENEFÍCIO PRINCIPAL: ${base.promise.mainBenefit}`);
    if (base.promise.boundaries) lines.push(`LIMITES DA PROMESSA: ${base.promise.boundaries}`);
    if (base.personality.tone) lines.push(`TOM DE VOZ: ${base.personality.tone}`);
    if (base.personality.attributes.length) lines.push(`PERSONALIDADE: ${base.personality.attributes.join("; ")}`);
    if (base.personality.visualStyle) lines.push(`ESTILO VISUAL: ${base.personality.visualStyle}`);
    if (base.proof.cases.length) lines.push(`CASOS E PROVAS DISPONÍVEIS: ${base.proof.cases.join("; ")}`);
    if (base.proof.numbers.length) lines.push(`NÚMEROS AUTORIZADOS: ${base.proof.numbers.join("; ")}`);
    if (base.humanPresence.spokespersons.length) lines.push(`PORTA-VOZES: ${base.humanPresence.spokespersons.join("; ")}`);
    lines.push(`DISPONIBILIDADE PARA APARECER: ${base.humanPresence.cameraAvailability}`);
  }
  const channel = context.channelMap.find((item) =>
    requestedChannel ? item.channel.toLowerCase() === requestedChannel.toLowerCase() : false,
  );
  if (channel) {
    if (channel.role) lines.push(`FUNÇÃO DE ${channel.channel.toUpperCase()}: ${channel.role}`);
    if (channel.primaryObjective) lines.push(`OBJETIVO DO CANAL: ${channel.primaryObjective}`);
    if (channel.contentPillars.length) lines.push(`PILARES DO CANAL: ${channel.contentPillars.join("; ")}`);
    if (channel.ctaTypes.length) lines.push(`CTAS ADEQUADOS AO CANAL: ${channel.ctaTypes.join("; ")}`);
    if (channel.primaryKpi) lines.push(`INDICADOR PRINCIPAL DO CANAL: ${channel.primaryKpi}`);
  }
  if (context.revenueMap) {
    const revenue = context.revenueMap;
    if (revenue.primaryOffer) lines.push(`OFERTA PRIORITÁRIA: ${revenue.primaryOffer}`);
    if (revenue.priceContext) lines.push(`CONTEXTO DE PREÇO: ${revenue.priceContext}`);
    if (revenue.revenueObjective) lines.push(`OBJETIVO COMERCIAL: ${revenue.revenueObjective}`);
    if (revenue.targetAudience) lines.push(`PÚBLICO DA OFERTA: ${revenue.targetAudience}`);
    if (revenue.primaryConversion) lines.push(`CONVERSÃO PRINCIPAL: ${revenue.primaryConversion}`);
    if (revenue.conversionDestination) lines.push(`DESTINO DA CONVERSÃO: ${revenue.conversionDestination}`);
    if (revenue.notes) lines.push(`RESTRIÇÕES COMERCIAIS: ${revenue.notes}`);
  }
  if (context.memory) {
    const memory = context.memory;
    if (memory.currentPriorities.length) lines.push(`PRIORIDADES ATUAIS: ${memory.currentPriorities.join("; ")}`);
    if (memory.productsOrServicesToShow.length) lines.push(`PRODUTOS/SERVIÇOS: ${memory.productsOrServicesToShow.join("; ")}`);
    if (memory.proofAvailable.length) lines.push(`PROVAS E HISTÓRIAS: ${memory.proofAvailable.join("; ")}`);
    if (memory.recurringQuestions.length) lines.push(`DÚVIDAS E OBJEÇÕES: ${memory.recurringQuestions.join("; ")}`);
    if (memory.peopleAvailable.length) lines.push(`PESSOAS DISPONÍVEIS: ${memory.peopleAvailable.join("; ")}`);
    if (memory.locations.length) lines.push(`LOCAIS E BASTIDORES: ${memory.locations.join("; ")}`);
    if (memory.preferredChannels.length) lines.push(`CANAIS PRIORITÁRIOS: ${memory.preferredChannels.join("; ")}`);
    lines.push(`CONFORTÁVEL EM VÍDEO: ${memory.comfortableOnCamera ? "sim" : "não"}`);
    lines.push(`TEMPO SEMANAL DISPONÍVEL: ${memory.weeklyMinutesAvailable} minutos`);
    if (memory.prohibitedTopics.length) lines.push(`NÃO ABORDAR: ${memory.prohibitedTopics.join("; ")}`);
    if (memory.notes) lines.push(`RESTRIÇÕES E CONTEXTO: ${memory.notes}`);
  }
  if (context.performance.length) {
    lines.push(
      `SINAIS DE DESEMPENHO: ${context.performance
        .map((item) => `${item.channel} nota ${item.averageScore}/100, ${item.leads} leads, ${item.conversions} conversões`)
        .join(" | ")}`,
    );
  }
  const usefulLearning = context.recentLearning
    .filter((item) => item.notes)
    .map((item) => `${item.signal}${item.score === null ? "" : ` (${item.score}/100)`}: ${item.notes}`);
  if (usefulLearning.length) lines.push(`APRENDIZADOS RECENTES: ${usefulLearning.join(" | ")}`);
  return lines.join("\n");
}
