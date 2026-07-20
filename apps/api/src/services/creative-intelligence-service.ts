import type { Brand } from "@modo/contracts";
import type {
  CreativeFeedback,
  CreativePlan,
  CreativeProfile,
  CreativeProfileUpsert,
  CreativeRecommendation,
  CreativeRecommendationKind,
  CreativeChannel,
} from "@modo/contracts/creative-intelligence";
import { randomUUID } from "node:crypto";
import pg, { type Pool } from "pg";

const { Pool: PgPool } = pg;

interface Options {
  databaseUrl?: string;
  databaseSsl?: boolean;
}

interface ProfileRow {
  account_id: string;
  brand_id: string;
  people_available: string[];
  comfortable_on_camera: boolean;
  weekly_minutes_available: number;
  locations: string[];
  products_or_services_to_show: string[];
  proof_available: string[];
  recurring_questions: string[];
  current_priorities: string[];
  prohibited_topics: string[];
  preferred_channels: CreativeChannel[];
  notes: string;
  updated_at: Date;
}

interface RecommendationRow {
  id: string;
  account_id: string;
  brand_id: string;
  kind: CreativeRecommendationKind;
  status: CreativeRecommendation["status"];
  title: string;
  rationale: string;
  objective: CreativeRecommendation["objective"];
  channels: CreativeChannel[];
  effort_minutes: number;
  expected_outcome: string;
  brief: string;
  capture_mission: CreativeRecommendation["captureMission"];
  derivative_assets: string[];
  priority_score: number;
  created_at: Date;
  updated_at: Date;
}

const defaultProfile = (accountId: string, brandId: string): CreativeProfile => ({
  accountId,
  brandId,
  peopleAvailable: [],
  comfortableOnCamera: false,
  weeklyMinutesAvailable: 20,
  locations: [],
  productsOrServicesToShow: [],
  proofAvailable: [],
  recurringQuestions: [],
  currentPriorities: [],
  prohibitedTopics: [],
  preferredChannels: ["instagram", "linkedin"],
  notes: "",
  updatedAt: new Date().toISOString(),
});

function mapProfile(row: ProfileRow): CreativeProfile {
  return {
    accountId: row.account_id,
    brandId: row.brand_id,
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
    updatedAt: row.updated_at.toISOString(),
  };
}

function mapRecommendation(row: RecommendationRow): CreativeRecommendation {
  return {
    id: row.id,
    accountId: row.account_id,
    brandId: row.brand_id,
    kind: row.kind,
    status: row.status,
    title: row.title,
    rationale: row.rationale,
    objective: row.objective,
    channels: row.channels,
    effortMinutes: row.effort_minutes,
    expectedOutcome: row.expected_outcome,
    brief: row.brief,
    captureMission: row.capture_mission,
    derivativeAssets: row.derivative_assets,
    priorityScore: row.priority_score,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

export class CreativeIntelligenceError extends Error {
  constructor(
    public readonly code: string,
    public readonly statusCode: number,
    message: string,
  ) {
    super(message);
    this.name = "CreativeIntelligenceError";
  }
}

export class CreativeIntelligenceService {
  private readonly pool?: Pool;
  private readonly profiles = new Map<string, CreativeProfile>();
  private readonly recommendations: CreativeRecommendation[] = [];
  private readonly feedback: CreativeFeedback[] = [];

  constructor(options: Options = {}) {
    if (options.databaseUrl) {
      this.pool = new PgPool({
        connectionString: options.databaseUrl,
        ssl: options.databaseSsl ? { rejectUnauthorized: false } : undefined,
        max: 4,
      });
    }
  }

  async initialize() {
    if (!this.pool) return;
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS modo_creative_profiles (
        account_id TEXT NOT NULL REFERENCES modo_organizations(id) ON DELETE CASCADE,
        brand_id TEXT NOT NULL REFERENCES modo_brands(id) ON DELETE CASCADE,
        people_available TEXT[] NOT NULL DEFAULT '{}',
        comfortable_on_camera BOOLEAN NOT NULL DEFAULT FALSE,
        weekly_minutes_available INTEGER NOT NULL DEFAULT 20,
        locations TEXT[] NOT NULL DEFAULT '{}',
        products_or_services_to_show TEXT[] NOT NULL DEFAULT '{}',
        proof_available TEXT[] NOT NULL DEFAULT '{}',
        recurring_questions TEXT[] NOT NULL DEFAULT '{}',
        current_priorities TEXT[] NOT NULL DEFAULT '{}',
        prohibited_topics TEXT[] NOT NULL DEFAULT '{}',
        preferred_channels TEXT[] NOT NULL DEFAULT ARRAY['instagram','linkedin'],
        notes TEXT NOT NULL DEFAULT '',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY(account_id, brand_id)
      );

      CREATE TABLE IF NOT EXISTS modo_creative_recommendations (
        id TEXT PRIMARY KEY,
        account_id TEXT NOT NULL REFERENCES modo_organizations(id) ON DELETE CASCADE,
        brand_id TEXT NOT NULL REFERENCES modo_brands(id) ON DELETE CASCADE,
        kind TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'suggested',
        title TEXT NOT NULL,
        rationale TEXT NOT NULL,
        objective TEXT NOT NULL,
        channels TEXT[] NOT NULL,
        effort_minutes INTEGER NOT NULL,
        expected_outcome TEXT NOT NULL,
        brief TEXT NOT NULL,
        capture_mission JSONB,
        derivative_assets TEXT[] NOT NULL DEFAULT '{}',
        priority_score INTEGER NOT NULL DEFAULT 50,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS modo_creative_recommendations_brand_idx
        ON modo_creative_recommendations(account_id, brand_id, created_at DESC);

      CREATE TABLE IF NOT EXISTS modo_creative_feedback (
        id TEXT PRIMARY KEY,
        account_id TEXT NOT NULL REFERENCES modo_organizations(id) ON DELETE CASCADE,
        brand_id TEXT NOT NULL REFERENCES modo_brands(id) ON DELETE CASCADE,
        recommendation_id TEXT,
        content_request_id TEXT,
        signal TEXT NOT NULL,
        score NUMERIC,
        notes TEXT,
        metrics JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS modo_creative_feedback_brand_idx
        ON modo_creative_feedback(account_id, brand_id, created_at DESC);
    `);
  }

  async close() {
    await this.pool?.end();
  }

  async getProfile(accountId: string, brandId: string): Promise<CreativeProfile> {
    if (this.pool) {
      const result = await this.pool.query<ProfileRow>(
        "SELECT * FROM modo_creative_profiles WHERE account_id=$1 AND brand_id=$2 LIMIT 1",
        [accountId, brandId],
      );
      return result.rowCount ? mapProfile(result.rows[0]) : defaultProfile(accountId, brandId);
    }
    return this.profiles.get(`${accountId}:${brandId}`) ?? defaultProfile(accountId, brandId);
  }

  async upsertProfile(accountId: string, input: CreativeProfileUpsert): Promise<CreativeProfile> {
    const current = await this.getProfile(accountId, input.brandId);
    const next: CreativeProfile = {
      ...current,
      ...input,
      accountId,
      updatedAt: new Date().toISOString(),
    };

    if (this.pool) {
      const result = await this.pool.query<ProfileRow>(
        `INSERT INTO modo_creative_profiles(
          account_id,brand_id,people_available,comfortable_on_camera,weekly_minutes_available,
          locations,products_or_services_to_show,proof_available,recurring_questions,
          current_priorities,prohibited_topics,preferred_channels,notes,updated_at
        ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,NOW())
        ON CONFLICT(account_id,brand_id) DO UPDATE SET
          people_available=EXCLUDED.people_available,
          comfortable_on_camera=EXCLUDED.comfortable_on_camera,
          weekly_minutes_available=EXCLUDED.weekly_minutes_available,
          locations=EXCLUDED.locations,
          products_or_services_to_show=EXCLUDED.products_or_services_to_show,
          proof_available=EXCLUDED.proof_available,
          recurring_questions=EXCLUDED.recurring_questions,
          current_priorities=EXCLUDED.current_priorities,
          prohibited_topics=EXCLUDED.prohibited_topics,
          preferred_channels=EXCLUDED.preferred_channels,
          notes=EXCLUDED.notes,
          updated_at=NOW()
        RETURNING *`,
        [
          accountId,
          next.brandId,
          next.peopleAvailable,
          next.comfortableOnCamera,
          next.weeklyMinutesAvailable,
          next.locations,
          next.productsOrServicesToShow,
          next.proofAvailable,
          next.recurringQuestions,
          next.currentPriorities,
          next.prohibitedTopics,
          next.preferredChannels,
          next.notes,
        ],
      );
      return mapProfile(result.rows[0]);
    }

    this.profiles.set(`${accountId}:${next.brandId}`, next);
    return next;
  }

  async listRecommendations(accountId: string, brandId: string) {
    if (this.pool) {
      const result = await this.pool.query<RecommendationRow>(
        `SELECT * FROM modo_creative_recommendations
         WHERE account_id=$1 AND brand_id=$2
         ORDER BY priority_score DESC, created_at DESC LIMIT 50`,
        [accountId, brandId],
      );
      return result.rows.map(mapRecommendation);
    }
    return this.recommendations
      .filter((item) => item.accountId === accountId && item.brandId === brandId)
      .sort((a, b) => b.priorityScore - a.priorityScore);
  }

  async generatePlan(accountId: string, brand: Brand): Promise<CreativePlan> {
    const profile = await this.getProfile(accountId, brand.id);
    const learned = await this.learningWeights(accountId, brand.id);
    const channels: CreativeChannel[] = profile.preferredChannels.length
      ? profile.preferredChannels
      : ["instagram", "linkedin"];
    const person = profile.peopleAvailable[0] || "fundador, especialista ou pessoa responsável pela marca";
    const location = profile.locations[0] || "ambiente real de trabalho, com luz frontal e pouco ruído";
    const question = profile.recurringQuestions[0] || "a dúvida que mais impede o cliente de avançar";
    const proof = profile.proofAvailable[0] || "um caso, resultado, processo ou evidência concreta";
    const priority = profile.currentPriorities[0] || "o principal produto, serviço ou objetivo comercial do momento";

    const drafts: Omit<CreativeRecommendation, "id" | "createdAt" | "updatedAt" | "status">[] = [
      {
        accountId,
        brandId: brand.id,
        kind: "campaign",
        title: `Campanha de 7 dias para ${priority}`,
        rationale: "Uma campanha coordenada cria repetição estratégica e reduz a dependência de publicações isoladas.",
        objective: "demanda",
        channels,
        effortMinutes: Math.min(90, Math.max(25, profile.weeklyMinutesAvailable)),
        expectedOutcome: "Aumentar reconhecimento, compreensão da oferta e conversas comerciais.",
        brief: `Crie uma campanha multicanal de sete dias para ${brand.name}, centrada em ${priority}. Combine educação, prova, objeção, bastidor e chamada comercial sem repetir o mesmo texto entre canais.`,
        captureMission: null,
        derivativeAssets: ["post de autoridade", "carrossel educativo", "stories de objeção", "post de prova", "CTA comercial"],
        priorityScore: 94 + learned.campaign,
      },
      {
        accountId,
        brandId: brand.id,
        kind: "capture",
        title: "Grave uma história real que só sua empresa pode contar",
        rationale: "Histórias próprias criam diferenciação, humanidade e matéria-prima impossível de copiar.",
        objective: "relacionamento",
        channels: ["reels", "linkedin", "stories"].filter((item) => channels.includes(item as CreativeChannel) || item === "reels") as CreativeChannel[],
        effortMinutes: profile.comfortableOnCamera ? 12 : 18,
        expectedOutcome: "Aproximar a marca, gerar confiança e alimentar vários conteúdos derivados.",
        brief: `Transforme uma decisão, erro, mudança ou aprendizado real de ${brand.name} em uma história com contexto, tensão, decisão, aprendizado e conselho prático.`,
        captureMission: {
          person,
          estimatedMinutes: profile.comfortableOnCamera ? 12 : 18,
          location,
          duration: "45 a 75 segundos",
          framing: "Plano médio, câmera vertical na altura dos olhos, olhar direto para a lente.",
          openingLine: "Teve uma decisão na nossa empresa que mudou completamente a forma como trabalhamos.",
          structure: [
            "Explique rapidamente o contexto.",
            "Conte qual era o risco ou dificuldade.",
            "Mostre a decisão tomada.",
            "Compartilhe o aprendizado sem transformar em propaganda.",
            "Feche com um conselho ou pergunta.",
          ],
          bRoll: ["equipe trabalhando", "detalhe do processo", "ambiente da empresa", "produto ou tela relacionada"],
          checklist: ["celular na vertical", "luz de frente", "ambiente silencioso", "gravar duas versões", "não decorar palavra por palavra"],
        },
        derivativeAssets: ["Reel", "post de LinkedIn", "carrossel de aprendizado", "3 stories", "legenda curta"],
        priorityScore: (profile.comfortableOnCamera ? 93 : 84) + learned.capture,
      },
      {
        accountId,
        brandId: brand.id,
        kind: "create",
        title: `Responda: ${question}`,
        rationale: "Responder dúvidas reais reduz insegurança e aproxima pessoas com intenção de compra.",
        objective: "educacao",
        channels,
        effortMinutes: 5,
        expectedOutcome: "Aumentar clareza, salvamentos e avanço na decisão.",
        brief: `Crie um conteúdo para ${brand.name} respondendo com clareza: ${question}. Use uma abertura que mostre por que essa dúvida importa, resposta prática e CTA coerente.`,
        captureMission: null,
        derivativeAssets: ["post", "carrossel", "stories de perguntas", "versão curta para LinkedIn"],
        priorityScore: 89 + learned.create,
      },
      {
        accountId,
        brandId: brand.id,
        kind: "create",
        title: `Transforme prova em confiança: ${proof}`,
        rationale: "Prova concreta torna a promessa menos abstrata e reduz o risco percebido.",
        objective: "conversao",
        channels,
        effortMinutes: 8,
        expectedOutcome: "Fortalecer credibilidade e gerar contatos mais qualificados.",
        brief: `Transforme ${proof} em conteúdo para ${brand.name}. Mostre ponto de partida, processo, decisão e resultado sem exageros ou promessas não comprovadas.`,
        captureMission: null,
        derivativeAssets: ["case curto", "documento LinkedIn", "carrossel", "story de prova"],
        priorityScore: 87 + learned.create,
      },
      {
        accountId,
        brandId: brand.id,
        kind: "capture",
        title: "Mostre um bastidor que revela qualidade",
        rationale: "O público costuma ver o resultado, mas não enxerga as escolhas que sustentam a qualidade.",
        objective: "autoridade",
        channels: ["stories", "reels", "instagram", "facebook"] as CreativeChannel[],
        effortMinutes: 7,
        expectedOutcome: "Materializar diferenciais e aumentar percepção de valor.",
        brief: `Mostre um processo real de ${brand.name} e explique uma escolha que melhora a entrega para o cliente.`,
        captureMission: {
          person,
          estimatedMinutes: 7,
          location,
          duration: "20 a 40 segundos",
          framing: "Comece com detalhes do processo e finalize com a pessoa explicando a decisão.",
          openingLine: "Esse detalhe parece pequeno, mas muda o resultado final.",
          structure: ["Mostre o detalhe", "explique por que ele existe", "conecte com o benefício para o cliente"],
          bRoll: ["mãos executando", "ferramentas ou tela", "antes e depois", "checagem final"],
          checklist: ["gravar cenas de 3 a 5 segundos", "evitar zoom digital", "captar som ambiente", "mostrar algo real"],
        },
        derivativeAssets: ["Reel curto", "sequência de stories", "post de bastidor", "foto com legenda"],
        priorityScore: 82 + learned.capture,
      },
      {
        accountId,
        brandId: brand.id,
        kind: "repurpose",
        title: "Transforme uma única matéria-prima em cinco conteúdos",
        rationale: "Reaproveitamento inteligente aumenta consistência sem exigir novas ideias todos os dias.",
        objective: "autoridade",
        channels,
        effortMinutes: 10,
        expectedOutcome: "Aumentar volume e consistência com menor esforço do cliente.",
        brief: `Escolha um vídeo, áudio, reunião, artigo, apresentação ou resposta de especialista de ${brand.name} e transforme em cinco peças complementares, adaptadas à linguagem de cada canal.`,
        captureMission: null,
        derivativeAssets: ["post de opinião", "carrossel", "roteiro curto", "stories", "documento LinkedIn"],
        priorityScore: 80 + learned.repurpose,
      },
    ];

    const now = new Date().toISOString();
    const recommendations = drafts
      .map((item) => ({
        ...item,
        id: randomUUID(),
        status: "suggested" as const,
        priorityScore: Math.min(100, item.priorityScore),
        createdAt: now,
        updatedAt: now,
      }))
      .sort((a, b) => b.priorityScore - a.priorityScore);

    await this.saveRecommendations(recommendations);
    return {
      brandId: brand.id,
      headline: `Próximos movimentos criativos para ${brand.name}`,
      rationale: "A MODO combinou contexto da marca, disponibilidade do cliente, canais escolhidos e sinais de uso para criar um plano executável.",
      recommendations,
      generatedAt: now,
    };
  }

  async setRecommendationStatus(
    accountId: string,
    id: string,
    status: CreativeRecommendation["status"],
  ) {
    if (this.pool) {
      const result = await this.pool.query<RecommendationRow>(
        `UPDATE modo_creative_recommendations SET status=$3,updated_at=NOW()
         WHERE id=$1 AND account_id=$2 RETURNING *`,
        [id, accountId, status],
      );
      if (!result.rowCount) throw this.notFound();
      return mapRecommendation(result.rows[0]);
    }
    const index = this.recommendations.findIndex((item) => item.id === id && item.accountId === accountId);
    if (index < 0) throw this.notFound();
    this.recommendations[index] = { ...this.recommendations[index], status, updatedAt: new Date().toISOString() };
    return this.recommendations[index];
  }

  async recordFeedback(accountId: string, brandId: string, feedback: CreativeFeedback) {
    if (this.pool) {
      await this.pool.query(
        `INSERT INTO modo_creative_feedback(
          id,account_id,brand_id,recommendation_id,content_request_id,signal,score,notes,metrics
        ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)`,
        [
          randomUUID(),
          accountId,
          brandId,
          feedback.recommendationId ?? null,
          feedback.contentRequestId ?? null,
          feedback.signal,
          feedback.score ?? null,
          feedback.notes ?? null,
          JSON.stringify(feedback.metrics ?? {}),
        ],
      );
    } else {
      this.feedback.push(feedback);
    }
    return { recorded: true };
  }

  private async saveRecommendations(items: CreativeRecommendation[]) {
    if (this.pool) {
      for (const item of items) {
        await this.pool.query(
          `INSERT INTO modo_creative_recommendations(
            id,account_id,brand_id,kind,status,title,rationale,objective,channels,
            effort_minutes,expected_outcome,brief,capture_mission,derivative_assets,priority_score
          ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb,$14,$15)`,
          [
            item.id,
            item.accountId,
            item.brandId,
            item.kind,
            item.status,
            item.title,
            item.rationale,
            item.objective,
            item.channels,
            item.effortMinutes,
            item.expectedOutcome,
            item.brief,
            item.captureMission ? JSON.stringify(item.captureMission) : null,
            item.derivativeAssets,
            item.priorityScore,
          ],
        );
      }
      return;
    }
    this.recommendations.unshift(...items);
  }

  private async learningWeights(accountId: string, brandId: string) {
    const weights = { create: 0, capture: 0, campaign: 0, repurpose: 0 };
    if (!this.pool) return weights;
    const result = await this.pool.query<{ kind: CreativeRecommendationKind; score: number }>(
      `SELECT r.kind,
        COALESCE(SUM(CASE
          WHEN f.signal IN ('accepted','approved','published','performed_well') THEN 2
          WHEN f.signal IN ('dismissed','performed_poorly') THEN -2
          WHEN f.signal='revision_requested' THEN -1
          ELSE 0 END),0)::int AS score
       FROM modo_creative_recommendations r
       LEFT JOIN modo_creative_feedback f ON f.recommendation_id=r.id
       WHERE r.account_id=$1 AND r.brand_id=$2
       GROUP BY r.kind`,
      [accountId, brandId],
    );
    for (const row of result.rows) weights[row.kind] = Math.max(-8, Math.min(6, Number(row.score)));
    return weights;
  }

  private notFound() {
    return new CreativeIntelligenceError(
      "RECOMMENDATION_NOT_FOUND",
      404,
      "Recomendação criativa não encontrada.",
    );
  }
}
