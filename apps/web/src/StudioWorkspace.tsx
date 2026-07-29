import type { Dashboard } from "@modo/contracts";
import type { ContentRequest, GeneratedContent } from "@modo/contracts/content";
import { useEffect, useMemo, useState } from "react";
import { trackActivationEvent } from "./activation-api";
import { getContentRequest, getDashboard, getSessionToken } from "./api";
import { saveStudioOutput } from "./studio-api";

type StudioTheme = "light" | "dark" | "blue" | "warm";
type StudioLayout = "editorial" | "numbered" | "split" | "image_focus" | "minimal";

type ThemeDefinition = {
  background: string;
  text: string;
  accent: string;
  soft: string;
  surface: string;
};

type ExportItem = {
  title: string;
  body: string;
  interaction?: string;
  imageUrl?: string | null;
};

const themes: Record<StudioTheme, ThemeDefinition> = {
  light: { background: "#f4f1e8", text: "#13213f", accent: "#1f5eff", soft: "#dce6f8", surface: "#ffffff" },
  dark: { background: "#0d1b3e", text: "#ffffff", accent: "#2ed19a", soft: "#25365c", surface: "#17284e" },
  blue: { background: "#1f5eff", text: "#ffffff", accent: "#2ed19a", soft: "#5481ff", surface: "#174bd3" },
  warm: { background: "#f6ead8", text: "#351f1a", accent: "#d94a86", soft: "#efd0dc", surface: "#fff9ef" },
};

const layoutLabels: Record<StudioLayout, { title: string; copy: string }> = {
  editorial: { title: "Editorial", copy: "Hierarquia forte, leitura e espaço em branco." },
  numbered: { title: "Numerado", copy: "Passos, listas, métodos e sequências." },
  split: { title: "Dividido", copy: "Título e argumento em áreas contrastantes." },
  image_focus: { title: "Imagem", copy: "Fotografia contextual como protagonista." },
  minimal: { title: "Minimal", copy: "Mensagem curta, limpa e com alto contraste." },
};

function download(filename: string, content: BlobPart, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1500);
}

function plainText(output: GeneratedContent) {
  const sections = [
    `GANCHO\n${output.hook}`,
    `TÍTULO\n${output.title}`,
    `LEGENDA\n${output.caption}`,
    `CTA\n${output.cta}`,
    `DIREÇÃO VISUAL\n${output.visualDirection}`,
  ];
  if (output.slides.length) sections.push(`CARROSSEL\n${output.slides.map((slide, index) => `${index + 1}. ${slide.title}\n${slide.body}`).join("\n\n")}`);
  if (output.script.length) sections.push(`ROTEIRO\n${output.script.map((scene, index) => `${index + 1}. ${scene.scene}\nVisual: ${scene.visual}\nFala: ${scene.voiceover}`).join("\n\n")}`);
  if (output.storyFrames.length) sections.push(`STORIES\n${output.storyFrames.map((frame, index) => `${index + 1}. ${frame.headline}\n${frame.body}\n${frame.interaction}`).join("\n\n")}`);
  sections.push(`HASHTAGS\n${output.hashtags.join(" ")}`);
  return sections.join("\n\n---\n\n");
}

function wrapText(context: CanvasRenderingContext2D, text: string, maxWidth: number) {
  const words = text.trim().split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const test = line ? `${line} ${word}` : word;
    if (context.measureText(test).width > maxWidth && line) {
      lines.push(line);
      line = word;
    } else {
      line = test;
    }
  }
  if (line) lines.push(line);
  return lines;
}

function fittedLines(
  context: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  maxLines: number,
  startSize: number,
  minSize: number,
  weight: number,
) {
  for (let size = startSize; size >= minSize; size -= 2) {
    context.font = `${weight} ${size}px Arial`;
    const lines = wrapText(context, text, maxWidth);
    if (lines.length <= maxLines) return { lines, size };
  }
  context.font = `${weight} ${minSize}px Arial`;
  const lines = wrapText(context, text, maxWidth).slice(0, maxLines);
  if (lines.length) {
    const last = lines.length - 1;
    lines[last] = `${lines[last].replace(/[.,;:]?$/, "")}…`;
  }
  return { lines, size: minSize };
}

function drawLines(
  context: CanvasRenderingContext2D,
  lines: string[],
  x: number,
  y: number,
  lineHeight: number,
) {
  lines.forEach((line, index) => context.fillText(line, x, y + index * lineHeight));
}

function hexToRgb(hex: string) {
  const normalized = hex.replace("#", "");
  const value = Number.parseInt(normalized.length === 3 ? normalized.split("").map((item) => item + item).join("") : normalized, 16);
  return { r: (value >> 16) & 255, g: (value >> 8) & 255, b: value & 255 };
}

function contrastText(background: string) {
  const { r, g, b } = hexToRgb(background);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.62 ? "#0d1b3e" : "#ffffff";
}

async function loadImage(url?: string | null): Promise<HTMLImageElement | undefined> {
  if (!url) return undefined;
  const blob = await fetch(url).then((response) => {
    if (!response.ok) throw new Error("Não foi possível carregar uma das imagens geradas.");
    return response.blob();
  });
  const objectUrl = URL.createObjectURL(blob);
  const image = await new Promise<HTMLImageElement>((resolve, reject) => {
    const element = new Image();
    element.onload = () => resolve(element);
    element.onerror = () => reject(new Error("Não foi possível abrir uma das imagens geradas."));
    element.src = objectUrl;
  });
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 8000);
  return image;
}

function drawCoverImage(context: CanvasRenderingContext2D, image: HTMLImageElement, width: number, height: number) {
  const scale = Math.max(width / image.naturalWidth, height / image.naturalHeight);
  const imageWidth = image.naturalWidth * scale;
  const imageHeight = image.naturalHeight * scale;
  context.drawImage(image, (width - imageWidth) / 2, (height - imageHeight) / 2, imageWidth, imageHeight);
}

function drawBrandBar(
  context: CanvasRenderingContext2D,
  brandName: string,
  index: number,
  total: number,
  width: number,
  textColor: string,
  accent: string,
) {
  context.fillStyle = accent;
  context.fillRect(72, 70, 90, 11);
  context.font = "700 27px Arial";
  context.fillStyle = textColor;
  context.fillText(brandName.toUpperCase().slice(0, 34), 72, 132);
  context.textAlign = "right";
  context.fillStyle = accent;
  context.fillText(`${String(index).padStart(2, "0")}/${String(total).padStart(2, "0")}`, width - 72, 132);
  context.textAlign = "left";
}

function drawFooter(context: CanvasRenderingContext2D, width: number, height: number, textColor: string, soft: string) {
  context.fillStyle = soft;
  context.fillRect(72, height - 112, width - 144, 2);
  context.font = "700 23px Arial";
  context.fillStyle = textColor;
  context.globalAlpha = 0.72;
  context.fillText("MODO · presença com direção", 72, height - 62);
  context.globalAlpha = 1;
}

function renderCard(options: {
  brandName: string;
  item: ExportItem;
  index: number;
  total: number;
  themeName: StudioTheme;
  layout: StudioLayout;
  accentColor: string;
  backgroundColor: string;
  backgroundImage?: HTMLImageElement;
  story: boolean;
}) {
  const { brandName, item, index, total, themeName, layout, accentColor, backgroundColor, backgroundImage, story } = options;
  const theme = themes[themeName];
  const canvas = document.createElement("canvas");
  canvas.width = 1080;
  canvas.height = story ? 1920 : 1350;
  const context = canvas.getContext("2d");
  if (!context) return canvas;
  const width = canvas.width;
  const height = canvas.height;
  const accent = accentColor || theme.accent;
  const baseBackground = backgroundColor || theme.background;
  const baseText = contrastText(baseBackground);
  const imageLayout = layout === "image_focus" && backgroundImage;

  context.fillStyle = baseBackground;
  context.fillRect(0, 0, width, height);

  if (imageLayout && backgroundImage) {
    drawCoverImage(context, backgroundImage, width, height);
    const gradient = context.createLinearGradient(0, 0, 0, height);
    gradient.addColorStop(0, "rgba(4,10,25,.16)");
    gradient.addColorStop(.48, "rgba(4,10,25,.34)");
    gradient.addColorStop(1, "rgba(4,10,25,.92)");
    context.fillStyle = gradient;
    context.fillRect(0, 0, width, height);
  } else if (backgroundImage && layout === "split") {
    drawCoverImage(context, backgroundImage, width, Math.round(height * .46));
    context.fillStyle = "rgba(4,10,25,.28)";
    context.fillRect(0, 0, width, Math.round(height * .46));
  } else if (backgroundImage && layout === "editorial") {
    const imageWidth = Math.round(width * .38);
    context.save();
    context.beginPath();
    context.roundRect(width - imageWidth - 56, 200, imageWidth, Math.round(height * .55), 28);
    context.clip();
    context.translate(width - imageWidth - 56, 200);
    drawCoverImage(context, backgroundImage, imageWidth, Math.round(height * .55));
    context.restore();
  }

  const textColor = imageLayout ? "#ffffff" : baseText;
  drawBrandBar(context, brandName, index, total, width, textColor, accent);

  if (layout === "numbered") {
    context.font = `900 ${story ? 310 : 260}px Arial`;
    context.fillStyle = accent;
    context.globalAlpha = .18;
    context.fillText(String(index).padStart(2, "0"), 55, story ? 520 : 470);
    context.globalAlpha = 1;
    const title = fittedLines(context, item.title, width - 170, 5, story ? 92 : 82, 48, 800);
    context.fillStyle = textColor;
    context.font = `800 ${title.size}px Arial`;
    drawLines(context, title.lines, 84, story ? 650 : 560, title.size * 1.12);
    const bodyY = (story ? 650 : 560) + title.lines.length * title.size * 1.12 + 70;
    const body = fittedLines(context, item.body, width - 170, story ? 12 : 8, 42, 28, 400);
    context.font = `400 ${body.size}px Arial`;
    context.globalAlpha = .88;
    drawLines(context, body.lines, 84, bodyY, body.size * 1.42);
    context.globalAlpha = 1;
  } else if (layout === "split") {
    const divider = Math.round(height * .46);
    const topText = backgroundImage ? "#ffffff" : textColor;
    if (!backgroundImage) {
      context.fillStyle = accent;
      context.fillRect(0, 0, width, divider);
    }
    const title = fittedLines(context, item.title, width - 150, 4, story ? 90 : 82, 46, 800);
    context.fillStyle = backgroundImage ? topText : contrastText(accent);
    context.font = `800 ${title.size}px Arial`;
    drawLines(context, title.lines, 75, divider - title.lines.length * title.size * 1.1 - 55, title.size * 1.12);
    const body = fittedLines(context, item.body, width - 160, story ? 13 : 9, 44, 28, 400);
    context.fillStyle = textColor;
    context.font = `400 ${body.size}px Arial`;
    drawLines(context, body.lines, 80, divider + 145, body.size * 1.45);
  } else if (layout === "minimal") {
    context.fillStyle = accent;
    context.beginPath();
    context.arc(width - 150, story ? 300 : 260, 88, 0, Math.PI * 2);
    context.fill();
    const title = fittedLines(context, item.title, width - 160, story ? 7 : 6, story ? 112 : 98, 54, 800);
    context.fillStyle = textColor;
    context.font = `800 ${title.size}px Arial`;
    const titleY = story ? 650 : 470;
    drawLines(context, title.lines, 80, titleY, title.size * 1.08);
    if (item.body) {
      const body = fittedLines(context, item.body, width - 200, story ? 8 : 5, 38, 26, 400);
      context.globalAlpha = .76;
      context.font = `400 ${body.size}px Arial`;
      drawLines(context, body.lines, 84, titleY + title.lines.length * title.size * 1.08 + 85, body.size * 1.4);
      context.globalAlpha = 1;
    }
  } else if (layout === "image_focus" && backgroundImage) {
    const title = fittedLines(context, item.title, width - 160, story ? 6 : 5, story ? 94 : 82, 48, 800);
    context.fillStyle = "#ffffff";
    context.font = `800 ${title.size}px Arial`;
    const titleY = height - (story ? 650 : 510);
    drawLines(context, title.lines, 80, titleY, title.size * 1.1);
    const body = fittedLines(context, item.body, width - 160, story ? 7 : 5, 36, 26, 400);
    context.globalAlpha = .88;
    context.font = `400 ${body.size}px Arial`;
    drawLines(context, body.lines, 82, titleY + title.lines.length * title.size * 1.1 + 65, body.size * 1.42);
    context.globalAlpha = 1;
  } else {
    const hasSideImage = Boolean(backgroundImage);
    const contentWidth = hasSideImage ? Math.round(width * .53) : width - 160;
    const title = fittedLines(context, item.title, contentWidth, story ? 7 : 6, story ? 96 : 82, 46, 800);
    context.fillStyle = textColor;
    context.font = `800 ${title.size}px Arial`;
    drawLines(context, title.lines, 76, story ? 450 : 360, title.size * 1.1);
    const bodyY = (story ? 450 : 360) + title.lines.length * title.size * 1.1 + 70;
    const body = fittedLines(context, item.body, contentWidth, story ? 13 : 9, 40, 27, 400);
    context.font = `400 ${body.size}px Arial`;
    context.globalAlpha = .84;
    drawLines(context, body.lines, 78, bodyY, body.size * 1.42);
    context.globalAlpha = 1;
  }

  if (item.interaction) {
    context.fillStyle = accent;
    context.beginPath();
    context.roundRect(76, height - 230, width - 152, 78, 39);
    context.fill();
    context.font = "700 27px Arial";
    context.fillStyle = contrastText(accent);
    context.fillText(item.interaction.slice(0, 70), 112, height - 180);
  }

  drawFooter(context, width, height, textColor, imageLayout ? "rgba(255,255,255,.45)" : theme.soft);
  return canvas;
}

async function downloadCanvas(canvas: HTMLCanvasElement, filename: string) {
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png", 0.95));
  if (blob) download(filename, blob, "image/png");
}

function buildExportItems(request: ContentRequest, output: GeneratedContent): ExportItem[] {
  if (request.contentType === "story" && output.storyFrames.length) {
    return output.storyFrames.map((frame, index) => ({
      title: frame.headline,
      body: frame.body,
      interaction: frame.interaction,
      imageUrl: output.visualAssets.find((asset) => asset.kind === "story_frame" && asset.index === index + 1)?.imageUrl,
    }));
  }
  if (output.slides.length) {
    return output.slides.map((slide, index) => ({
      title: slide.title,
      body: slide.body,
      imageUrl: output.visualAssets.find((asset) => asset.kind === "carousel_slide" && asset.index === index + 1)?.imageUrl,
    }));
  }
  return [{ title: output.hook || output.title, body: output.caption.slice(0, 700), imageUrl: output.imageUrl }];
}

export default function StudioWorkspace() {
  const id = window.location.pathname.split("/").filter(Boolean).pop() || "";
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [request, setRequest] = useState<ContentRequest | null>(null);
  const [output, setOutput] = useState<GeneratedContent | null>(null);
  const [theme, setTheme] = useState<StudioTheme>("light");
  const [layout, setLayout] = useState<StudioLayout>("editorial");
  const [accentColor, setAccentColor] = useState(themes.light.accent);
  const [backgroundColor, setBackgroundColor] = useState(themes.light.background);
  const [previewIndex, setPreviewIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  useEffect(() => {
    if (!getSessionToken()) {
      window.location.href = "/app";
      return;
    }
    Promise.all([getDashboard(), getContentRequest(id)])
      .then(([currentDashboard, currentRequest]) => {
        setDashboard(currentDashboard);
        setRequest(currentRequest);
        setOutput(currentRequest.output);
        const stored = window.localStorage.getItem(`modo.studio-preset:${currentRequest.brandId}`);
        if (stored) {
          try {
            const preset = JSON.parse(stored) as { theme?: StudioTheme; layout?: StudioLayout; accentColor?: string; backgroundColor?: string };
            if (preset.theme && themes[preset.theme]) setTheme(preset.theme);
            if (preset.layout && layoutLabels[preset.layout]) setLayout(preset.layout);
            if (preset.accentColor) setAccentColor(preset.accentColor);
            if (preset.backgroundColor) setBackgroundColor(preset.backgroundColor);
          } catch {
            window.localStorage.removeItem(`modo.studio-preset:${currentRequest.brandId}`);
          }
        }
        void trackActivationEvent("studio_opened", { contentRequestId: id }).catch(() => undefined);
      })
      .catch((caught) => setError(caught instanceof Error ? caught.message : "Não foi possível abrir o Studio."))
      .finally(() => setLoading(false));
  }, [id]);

  useEffect(() => {
    if (!request) return;
    window.localStorage.setItem(`modo.studio-preset:${request.brandId}`, JSON.stringify({ theme, layout, accentColor, backgroundColor }));
  }, [request, theme, layout, accentColor, backgroundColor]);

  useEffect(() => {
    const nextTheme = themes[theme];
    setAccentColor(nextTheme.accent);
    setBackgroundColor(nextTheme.background);
  }, [theme]);

  const brand = useMemo(
    () => dashboard?.brands.find((item) => item.id === request?.brandId),
    [dashboard, request],
  );

  const exportItems = useMemo(
    () => request && output ? buildExportItems(request, output) : [],
    [request, output],
  );
  const previewItem = exportItems[Math.min(previewIndex, Math.max(0, exportItems.length - 1))];
  const story = request?.contentType === "story";
  const textRisk = previewItem
    ? previewItem.title.length > 115 || previewItem.body.length > (story ? 430 : 330)
    : false;

  function patch<K extends keyof GeneratedContent>(key: K, value: GeneratedContent[K]) {
    setOutput((current) => current ? { ...current, [key]: value } : current);
  }

  async function save() {
    if (!output) return;
    setSaving(true);
    setError("");
    setSuccess("");
    try {
      const updated = await saveStudioOutput(id, output);
      setRequest(updated);
      setOutput(updated.output);
      setSuccess("Versão salva. A edição já faz parte do conteúdo da Modo.");
      void trackActivationEvent("studio_saved", { contentRequestId: id }).catch(() => undefined);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Não foi possível salvar.");
    } finally {
      setSaving(false);
    }
  }

  async function copy() {
    if (!output) return;
    await navigator.clipboard.writeText(plainText(output));
    setSuccess("Conteúdo copiado.");
  }

  async function exportImages() {
    if (!output || !request) return;
    setExporting(true);
    setError("");
    setSuccess("");
    try {
      const imageMap = new Map<number, HTMLImageElement | undefined>();
      await Promise.all(exportItems.map(async (item, index) => {
        imageMap.set(index, await loadImage(item.imageUrl || (index === 0 ? output.imageUrl : null)));
      }));
      for (let index = 0; index < exportItems.length; index += 1) {
        const canvas = renderCard({
          brandName: brand?.name || "Marca",
          item: exportItems[index],
          index: index + 1,
          total: exportItems.length,
          themeName: theme,
          layout,
          accentColor,
          backgroundColor,
          backgroundImage: imageMap.get(index),
          story,
        });
        await downloadCanvas(canvas, `modo-${id.slice(0, 8)}-${String(index + 1).padStart(2, "0")}.png`);
        await new Promise((resolve) => window.setTimeout(resolve, 180));
      }
      setSuccess(`${exportItems.length} peça(s) exportada(s) em alta resolução.`);
      void trackActivationEvent("asset_exported", {
        contentRequestId: id,
        assets: exportItems.length,
        format: "png",
        layout,
        theme,
      }).catch(() => undefined);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Não foi possível exportar as imagens.");
    } finally {
      setExporting(false);
    }
  }

  if (loading) return <main className="portal-loading"><img src="/logo.svg" alt="MODO" /><div className="portal-spinner" /><p>Abrindo o Studio...</p></main>;
  if (!dashboard || !request || !output || !previewItem) return <main className="portal-loading"><p>{error || "Este conteúdo ainda não está pronto para o Studio."}</p><a className="button button-primary" href="/app/content">Voltar para produção</a></main>;

  const previewBackground = layout === "image_focus" && previewItem.imageUrl
    ? { backgroundImage: `linear-gradient(180deg,rgba(5,12,30,.15),rgba(5,12,30,.88)),url(${previewItem.imageUrl})`, backgroundColor }
    : { backgroundColor, color: contrastText(backgroundColor) };

  return (
    <div className="studio-shell composer-enabled">
      <header className="workspace-header">
        <a href="/app"><img src="/logo.svg" alt="MODO" /></a>
        <nav><a href="/app">Painel</a><a href="/app/base">Base estratégica</a><a href="/app/content">Criar</a><a className="active" href={`/app/studio/${id}`}>Studio</a><a href="/app/especialista">Apoio humano</a></nav>
        <div className="workspace-balance"><small>Marca</small><strong>{brand?.name || "MODO"}</strong><span>{request.channel}</span></div>
      </header>

      <main className="studio-main">
        <section className="studio-heading"><div><div className="section-kicker">MODO VISUAL COMPOSER</div><h1>Transforme estratégia em peças editoriais prontas.</h1><p>Escolha uma estrutura, ajuste a identidade e exporte o kit completo sem programar ou começar da tela em branco.</p></div><div className="studio-heading-actions"><button className="button button-outline" onClick={() => window.print()}>Salvar como PDF</button><button className="button button-primary" disabled={saving} onClick={() => void save()}>{saving ? "Salvando..." : "Salvar versão"}</button></div></section>

        {error && <div className="portal-error">{error}</div>}
        {success && <div className="workspace-success">{success}</div>}

        <div className="studio-grid composer-grid">
          <section className="studio-editor">
            <div className="studio-section-title"><small>TEXTO PRINCIPAL</small><h2>Mensagem</h2></div>
            <label>Gancho<textarea value={output.hook} onChange={(event) => patch("hook", event.target.value)} /></label>
            <label>Título<input value={output.title} onChange={(event) => patch("title", event.target.value)} /></label>
            <label>Legenda<textarea className="large" value={output.caption} onChange={(event) => patch("caption", event.target.value)} /></label>
            <label>Chamada para ação<textarea value={output.cta} onChange={(event) => patch("cta", event.target.value)} /></label>
            <label>Direção visual<textarea value={output.visualDirection} onChange={(event) => patch("visualDirection", event.target.value)} /></label>
            <label>Hashtags<input value={output.hashtags.join(" ")} onChange={(event) => patch("hashtags", event.target.value.split(/\s+|,/).map((item) => item.trim()).filter(Boolean).slice(0, 15))} /></label>

            {output.slides.length > 0 && <section className="studio-list-editor"><div className="studio-section-title"><small>CARROSSEL</small><h2>Páginas</h2></div>{output.slides.map((slide, index) => <article className={previewIndex === index ? "active" : ""} key={index} onClick={() => setPreviewIndex(index)}><span>{String(index + 1).padStart(2, "0")}</span><div><input value={slide.title} onChange={(event) => patch("slides", output.slides.map((item, itemIndex) => itemIndex === index ? { ...item, title: event.target.value } : item))} /><textarea value={slide.body} onChange={(event) => patch("slides", output.slides.map((item, itemIndex) => itemIndex === index ? { ...item, body: event.target.value } : item))} /></div></article>)}</section>}

            {output.storyFrames.length > 0 && <section className="studio-list-editor"><div className="studio-section-title"><small>STORIES</small><h2>Frames</h2></div>{output.storyFrames.map((frame, index) => <article className={previewIndex === index ? "active" : ""} key={index} onClick={() => setPreviewIndex(index)}><span>{String(index + 1).padStart(2, "0")}</span><div><input value={frame.headline} onChange={(event) => patch("storyFrames", output.storyFrames.map((item, itemIndex) => itemIndex === index ? { ...item, headline: event.target.value } : item))} /><textarea value={frame.body} onChange={(event) => patch("storyFrames", output.storyFrames.map((item, itemIndex) => itemIndex === index ? { ...item, body: event.target.value } : item))} /><input value={frame.interaction} placeholder="Interação ou CTA" onChange={(event) => patch("storyFrames", output.storyFrames.map((item, itemIndex) => itemIndex === index ? { ...item, interaction: event.target.value } : item))} /></div></article>)}</section>}

            {output.script.length > 0 && <section className="studio-list-editor"><div className="studio-section-title"><small>VÍDEO</small><h2>Roteiro</h2></div>{output.script.map((scene, index) => <article key={index}><span>{String(index + 1).padStart(2, "0")}</span><div><input value={scene.scene} onChange={(event) => patch("script", output.script.map((item, itemIndex) => itemIndex === index ? { ...item, scene: event.target.value } : item))} /><textarea value={scene.visual} onChange={(event) => patch("script", output.script.map((item, itemIndex) => itemIndex === index ? { ...item, visual: event.target.value } : item))} /><textarea value={scene.voiceover} onChange={(event) => patch("script", output.script.map((item, itemIndex) => itemIndex === index ? { ...item, voiceover: event.target.value } : item))} /></div></article>)}</section>}
          </section>

          <aside className="studio-preview composer-panel">
            <div className="studio-section-title"><small>COMPOSIÇÃO E EXPORTAÇÃO</small><h2>Direção visual</h2></div>

            <div className="composer-control"><strong>Estrutura</strong><div className="composer-layout-grid">{(Object.keys(layoutLabels) as StudioLayout[]).map((item) => <button className={layout === item ? "selected" : ""} onClick={() => setLayout(item)} key={item}><span>{layoutLabels[item].title}</span><small>{layoutLabels[item].copy}</small></button>)}</div></div>

            <div className="composer-control"><strong>Identidade</strong><div className="studio-theme-picker four"><button className={theme === "light" ? "selected" : ""} onClick={() => setTheme("light")}>Claro</button><button className={theme === "dark" ? "selected" : ""} onClick={() => setTheme("dark")}>Escuro</button><button className={theme === "blue" ? "selected" : ""} onClick={() => setTheme("blue")}>Azul</button><button className={theme === "warm" ? "selected" : ""} onClick={() => setTheme("warm")}>Editorial</button></div><div className="composer-colors"><label>Cor de destaque<input type="color" value={accentColor} onChange={(event) => setAccentColor(event.target.value)} /></label><label>Fundo<input type="color" value={backgroundColor} onChange={(event) => setBackgroundColor(event.target.value)} /></label></div></div>

            <div className={`composer-preview-frame ${story ? "story" : "feed"}`} style={previewBackground}>
              <div className="composer-preview-brand"><i style={{ backgroundColor: accentColor }} /><small>{brand?.name}</small><span>{String(previewIndex + 1).padStart(2, "0")}/{String(exportItems.length).padStart(2, "0")}</span></div>
              {layout === "numbered" && <b className="composer-big-number" style={{ color: accentColor }}>{String(previewIndex + 1).padStart(2, "0")}</b>}
              <div className="composer-preview-copy"><strong>{previewItem.title}</strong><p>{previewItem.body}</p>{previewItem.interaction && <em style={{ backgroundColor: accentColor, color: contrastText(accentColor) }}>{previewItem.interaction}</em>}</div>
            </div>

            {exportItems.length > 1 && <div className="composer-page-tabs">{exportItems.map((item, index) => <button title={item.title} className={previewIndex === index ? "active" : ""} onClick={() => setPreviewIndex(index)} key={index}>{index + 1}</button>)}</div>}

            {textRisk && <div className="composer-warning"><strong>Texto denso nesta página</strong><p>A Modo reduzirá a fonte até o limite seguro. Para melhor leitura, resuma ou divida o conteúdo.</p></div>}

            <div className={`studio-image-status ${output.imageStatus}`}><strong>{output.visualAssets.length ? `${output.visualAssets.filter((asset) => asset.imageStatus === "generated").length} imagens contextuais disponíveis` : output.imageUrl ? "Imagem contextual gerada" : "Composição editorial sem fotografia"}</strong><p>O Composer usa uma imagem diferente em cada página quando o kit visual possui ativos individuais.</p></div>
            <button className="button button-primary button-full" disabled={exporting} onClick={() => void exportImages()}>{exporting ? "Preparando arquivos..." : exportItems.length > 1 ? `Baixar kit com ${exportItems.length} PNGs` : "Baixar peça em PNG"}</button>
            <button className="button button-outline button-full" onClick={() => void copy()}>Copiar conteúdo completo</button>
            <button className="button button-outline button-full" onClick={() => download(`modo-${id.slice(0, 8)}.txt`, plainText(output), "text/plain;charset=utf-8")}>Baixar texto</button>
            <button className="button button-outline button-full" onClick={() => download(`modo-${id.slice(0, 8)}.json`, JSON.stringify(output, null, 2), "application/json")}>Baixar estrutura</button>
            <div className="studio-note"><strong>Layout controlado, não HTML arbitrário.</strong><p>A Modo usa componentes testados, limites de legibilidade e exportação previsível. O conteúdo continua editável e pode seguir para o Canva depois da aprovação.</p></div>
          </aside>
        </div>
      </main>
    </div>
  );
}
