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

export async function loadCreativeGenerationContext(
  accountId: string,
  brandId: string,
): Promise<CreativeGenerationContext> {
  const database = getPool();
  if (!database) return { memory: null, performance: [], recentLearning: [] };

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
    return { memory: null, performance: [], recentLearning: [] };
  }
}

export function formatCreativeContext(context: CreativeGenerationContext) {
  const lines: string[] = [];
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
