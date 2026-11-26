import type { ContentRequest, ContentVisualAsset, GeneratedContent } from "@modo/contracts";

/**
 * Regras da revisão de conteúdo.
 *
 * - O pedido do cliente e a versão anterior vão para o modelo (antes a
 *   revisão gerava tudo de novo e ignorava o pedido).
 * - As imagens só são refeitas quando o pedido fala do visual. Imagem é o que
 *   mais custa: um carrossel refaz até 7 imagens por revisão.
 */

/** Palavras que indicam pedido de mudança visual. */
const VISUAL_CHANGE_PATTERN =
  /(?<!\p{L})(imagem|imagens|foto|fotos|visual|visuais|cor|cores|fundo|arte|artes|design|ilustração|ilustrações|ilustracao|figura|layout|enquadramento|cenário|cenario|logo|logotipo|paleta|estética|estetica)(?!\p{L})/iu;

export function wantsNewVisuals(instructions: string | null | undefined) {
  return VISUAL_CHANGE_PATTERN.test(instructions ?? "");
}

/** Revisão = há um pedido de revisão e uma versão anterior pronta. */
export function isRevision(request: Pick<ContentRequest, "revisionInstructions" | "output">) {
  return Boolean(request.revisionInstructions?.trim() && request.output);
}

/** Versão anterior sem URLs de imagem, limitada para não inflar o prompt. */
function previousVersionText(output: GeneratedContent) {
  const {
    imageUrl: _imageUrl,
    visualAssets: _visualAssets,
    adaptationNotes: _notes,
    ...text
  } = output;
  return JSON.stringify(text).slice(0, 6000);
}

/** Bloco extra do prompt para revisões. Vazio quando não é revisão. */
export function revisionPromptBlock(
  request: Pick<ContentRequest, "revisionInstructions" | "output">,
) {
  if (!isRevision(request) || !request.output) return "";
  return [
    "REVISÃO SOLICITADA PELO CLIENTE — PRIORIDADE MÁXIMA:",
    request.revisionInstructions!.trim(),
    "Aplique o pedido acima sobre a versão anterior. Mantenha o que o cliente não pediu para mudar.",
    `VERSÃO ANTERIOR (JSON):\n${previousVersionText(request.output)}`,
  ].join("\n");
}

/** Imagem anterior reaproveitável na posição `index`, ou null. */
export function reusableVisual(
  previous: GeneratedContent | null | undefined,
  index: number,
): Pick<ContentVisualAsset, "imageUrl" | "imageStatus"> | null {
  const asset = previous?.visualAssets?.[index];
  if (asset?.imageStatus === "generated" && asset.imageUrl) {
    return { imageUrl: asset.imageUrl, imageStatus: "generated" };
  }
  return null;
}

/** Imagem única anterior reaproveitável (post, Reel), ou null. */
export function reusableMainImage(previous: GeneratedContent | null | undefined) {
  if (previous?.imageStatus === "generated" && previous.imageUrl) return previous.imageUrl;
  return null;
}

export const KEPT_VISUALS_NOTE =
  "Revisão aplicada ao texto; as imagens anteriores foram mantidas. Para trocar a imagem, peça uma mudança visual na revisão.";
