import type { ContentRequest } from "@modo/contracts/content";
import type { CreativeProfile } from "@modo/contracts/creative-intelligence";
import type {
  DistributionQualityCheck,
  DistributionQualityReport,
} from "@modo/contracts/distribution-quality";

function normalize(value: string) {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function mediaCount(request: ContentRequest) {
  if (!request.output) return 0;
  const visual = request.output.visualAssets.filter(
    (asset) => asset.imageStatus === "generated" && Boolean(asset.imageUrl),
  ).length;
  return visual || (request.output.imageUrl ? 1 : 0);
}

function check(
  key: DistributionQualityCheck["key"],
  label: string,
  score: number,
  maxScore: number,
  status: DistributionQualityCheck["status"],
  message: string,
): DistributionQualityCheck {
  return { key, label, score, maxScore, status, message };
}

export class DistributionQualityService {
  evaluate(request: ContentRequest, profile: CreativeProfile): DistributionQualityReport {
    const output = request.output;
    const checks: DistributionQualityCheck[] = [];

    checks.push(
      request.status === "approved"
        ? check("approval", "Aprovação humana", 15, 15, "pass", "A peça foi aprovada pelo cliente antes da distribuição.")
        : check("approval", "Aprovação humana", 0, 15, "block", "A peça ainda não foi aprovada pelo cliente."),
    );

    const caption = output?.caption?.trim() || "";
    if (caption.length >= 40 && caption.length <= 4500) {
      checks.push(check("copy", "Legenda", 20, 20, "pass", "A legenda tem extensão adequada para distribuição multicanal."));
    } else if (caption.length >= 20 && caption.length <= 5000) {
      checks.push(check("copy", "Legenda", 12, 20, "warning", "A legenda está utilizável, mas merece uma última revisão de clareza ou tamanho."));
    } else {
      checks.push(check("copy", "Legenda", 4, 20, "warning", "A legenda está curta demais ou próxima do limite técnico da MODO."));
    }

    const cta = output?.cta?.trim() || "";
    checks.push(
      cta.length >= 3
        ? check("cta", "Chamada para ação", 10, 10, "pass", "A peça possui CTA explícito.")
        : check("cta", "Chamada para ação", 3, 10, "warning", "A peça não possui uma chamada para ação clara."),
    );

    const hashtags = output?.hashtags || [];
    const normalizedHashtags = hashtags.map((tag) => normalize(tag.replace(/^#+/, ""))).filter(Boolean);
    const uniqueHashtags = new Set(normalizedHashtags);
    if (hashtags.length <= 10 && uniqueHashtags.size === normalizedHashtags.length) {
      checks.push(check("hashtags", "Hashtags", 10, 10, "pass", "Quantidade e diversidade de hashtags estão adequadas."));
    } else {
      checks.push(check("hashtags", "Hashtags", 6, 10, "warning", "Revise excesso ou repetição de hashtags antes da publicação."));
    }

    const assets = mediaCount(request);
    const mediaCritical = request.contentType === "story";
    const mediaRecommended = ["static_post", "carousel", "story"].includes(request.contentType);
    if (!mediaRecommended || assets > 0) {
      checks.push(check("media", "Mídia", 20, 20, "pass", assets > 0 ? `${assets} mídia(s) pronta(s) para envio.` : "Este formato pode ser distribuído sem mídia obrigatória."));
    } else if (mediaCritical) {
      checks.push(check("media", "Mídia", 0, 20, "block", "Stories precisam de mídia pronta antes da distribuição."));
    } else {
      checks.push(check("media", "Mídia", 8, 20, "warning", "Este formato funciona melhor com uma arte pronta; alguns canais podem exigir mídia."));
    }

    const corpus = normalize([
      output?.hook || "",
      output?.title || "",
      caption,
      cta,
      request.brief,
    ].join("\n"));
    const prohibitedMatches = (profile.prohibitedTopics || [])
      .map((topic) => ({ original: topic, normalized: normalize(topic) }))
      .filter((topic) => topic.normalized.length >= 3 && corpus.includes(topic.normalized))
      .map((topic) => topic.original);

    checks.push(
      prohibitedMatches.length === 0
        ? check("brand_safety", "Segurança da marca", 20, 20, "pass", "Nenhum tópico proibido do perfil da marca foi encontrado.")
        : check(
            "brand_safety",
            "Segurança da marca",
            0,
            20,
            "block",
            `Foram encontrados tópicos proibidos: ${prohibitedMatches.join(", ")}.`,
          ),
    );

    const structureReady = Boolean(output?.hook?.trim() && output?.title?.trim());
    checks.push(
      structureReady
        ? check("structure", "Estrutura", 5, 5, "pass", "Gancho e título estão presentes.")
        : check("structure", "Estrutura", 2, 5, "warning", "Revise gancho e título antes de distribuir."),
    );

    const score = Math.max(0, Math.min(100, checks.reduce((total, item) => total + item.score, 0)));
    const blockers = checks.filter((item) => item.status === "block").map((item) => item.message);
    const warnings = checks.filter((item) => item.status === "warning").map((item) => item.message);
    const status: DistributionQualityReport["status"] = blockers.length
      ? "blocked"
      : score >= 85
        ? "recommended"
        : "review";

    return {
      contentRequestId: request.id,
      brandId: request.brandId,
      score,
      status,
      publishAllowed: blockers.length === 0,
      blockers,
      warnings,
      checks,
      evaluatedAt: new Date().toISOString(),
    };
  }
}
