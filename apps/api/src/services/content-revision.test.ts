import { GeneratedContentSchema, type GeneratedContent } from "@modo/contracts/content";
import { describe, expect, it } from "vitest";
import {
  isRevision,
  reusableMainImage,
  reusableVisual,
  revisionPromptBlock,
  wantsNewVisuals,
} from "./content-revision.js";

const previous: GeneratedContent = GeneratedContentSchema.parse({
  hook: "Gancho antigo",
  title: "Título antigo",
  caption: "Legenda antiga",
  cta: "Agende",
  hashtags: ["#clinica"],
  visualDirection: "Foto da recepção",
  imageUrl: "https://cdn.example.com/main.webp",
  imageStatus: "generated",
  visualAssets: [
    {
      kind: "carousel_slide",
      index: 1,
      label: "Slide 1",
      imagePrompt: "p1",
      imageAlt: "a1",
      imageUrl: "https://cdn.example.com/s1.webp",
      imageStatus: "generated",
    },
    {
      kind: "carousel_slide",
      index: 2,
      label: "Slide 2",
      imagePrompt: "p2",
      imageAlt: "a2",
      imageUrl: null,
      imageStatus: "failed",
    },
  ],
});

describe("content-revision", () => {
  it("detects visual change requests in Portuguese", () => {
    expect(wantsNewVisuals("Troque a imagem por uma foto mais clara")).toBe(true);
    expect(wantsNewVisuals("Muda as cores do fundo")).toBe(true);
    expect(wantsNewVisuals("Deixe o texto mais curto e mude o CTA")).toBe(false);
    expect(wantsNewVisuals("Encurte a legenda, sem colorir demais o tom")).toBe(false);
    expect(wantsNewVisuals(null)).toBe(false);
  });

  it("treats only a request with instructions and a previous output as a revision", () => {
    expect(isRevision({ revisionInstructions: "mais curto", output: previous })).toBe(true);
    expect(isRevision({ revisionInstructions: null, output: previous })).toBe(false);
    expect(isRevision({ revisionInstructions: "mais curto", output: null })).toBe(false);
  });

  it("sends the client's request and the previous text, without image URLs", () => {
    const block = revisionPromptBlock({ revisionInstructions: "Mais curto", output: previous });
    expect(block).toContain("Mais curto");
    expect(block).toContain("Legenda antiga");
    expect(block).not.toContain("cdn.example.com");
    expect(revisionPromptBlock({ revisionInstructions: null, output: previous })).toBe("");
  });

  it("reuses only images that were generated", () => {
    expect(reusableVisual(previous, 0)).toEqual({
      imageUrl: "https://cdn.example.com/s1.webp",
      imageStatus: "generated",
    });
    expect(reusableVisual(previous, 1)).toBeNull();
    expect(reusableVisual(previous, 5)).toBeNull();
    expect(reusableMainImage(previous)).toBe("https://cdn.example.com/main.webp");
    expect(reusableMainImage(null)).toBeNull();
  });
});
