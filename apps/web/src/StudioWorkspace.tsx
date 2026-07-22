import type { Dashboard } from "@modo/contracts";
import type { ContentRequest, GeneratedContent } from "@modo/contracts/content";
import { useEffect, useMemo, useState } from "react";
import { getContentRequest, getDashboard, getSessionToken } from "./api";
import { saveStudioOutput } from "./studio-api";

type StudioTheme = "light" | "dark" | "blue";

const themes: Record<StudioTheme, { background: string; text: string; accent: string; soft: string }> = {
  light: { background: "#f4f7fb", text: "#0d1b3e", accent: "#1f5eff", soft: "#dce6f8" },
  dark: { background: "#0d1b3e", text: "#ffffff", accent: "#2ed19a", soft: "#25365c" },
  blue: { background: "#1f5eff", text: "#ffffff", accent: "#2ed19a", soft: "#5481ff" },
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
  const words = text.split(/\s+/);
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

function drawLines(
  context: CanvasRenderingContext2D,
  lines: string[],
  x: number,
  y: number,
  lineHeight: number,
  maxLines: number,
) {
  lines.slice(0, maxLines).forEach((line, index) => context.fillText(line, x, y + index * lineHeight));
}

async function downloadCanvas(canvas: HTMLCanvasElement, filename: string) {
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png", 0.95));
  if (blob) download(filename, blob, "image/png");
}

function renderCard(
  brandName: string,
  title: string,
  body: string,
  index: number,
  total: number,
  themeName: StudioTheme,
) {
  const theme = themes[themeName];
  const canvas = document.createElement("canvas");
  canvas.width = 1080;
  canvas.height = 1350;
  const context = canvas.getContext("2d");
  if (!context) return canvas;

  context.fillStyle = theme.background;
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = theme.accent;
  context.fillRect(72, 76, 88, 12);
  context.font = "700 30px Arial";
  context.fillStyle = theme.text;
  context.fillText(brandName.toUpperCase().slice(0, 34), 72, 145);
  context.textAlign = "right";
  context.fillStyle = theme.accent;
  context.fillText(`${String(index).padStart(2, "0")}/${String(total).padStart(2, "0")}`, 1008, 145);
  context.textAlign = "left";

  context.font = "800 76px Arial";
  context.fillStyle = theme.text;
  const titleLines = wrapText(context, title, 920);
  drawLines(context, titleLines, 72, 350, 88, 6);
  const bodyStart = 350 + Math.min(6, titleLines.length) * 88 + 65;
  context.font = "400 38px Arial";
  context.fillStyle = theme.text;
  context.globalAlpha = 0.86;
  drawLines(context, wrapText(context, body, 900), 72, bodyStart, 54, 9);
  context.globalAlpha = 1;

  context.fillStyle = theme.soft;
  context.fillRect(72, 1225, 936, 2);
  context.font = "700 25px Arial";
  context.fillStyle = theme.text;
  context.globalAlpha = 0.72;
  context.fillText("MODO · presença com direção", 72, 1280);
  context.globalAlpha = 1;
  return canvas;
}

export default function StudioWorkspace() {
  const id = window.location.pathname.split("/").filter(Boolean).pop() || "";
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [request, setRequest] = useState<ContentRequest | null>(null);
  const [output, setOutput] = useState<GeneratedContent | null>(null);
  const [theme, setTheme] = useState<StudioTheme>("light");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
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
      })
      .catch((caught) => setError(caught instanceof Error ? caught.message : "Não foi possível abrir o Studio."))
      .finally(() => setLoading(false));
  }, [id]);

  const brand = useMemo(
    () => dashboard?.brands.find((item) => item.id === request?.brandId),
    [dashboard, request],
  );

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
      setSuccess("Versão salva. A edição já faz parte do conteúdo da MODO.");
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
    if (!output) return;
    const slides = output.slides.length
      ? output.slides
      : [{ title: output.hook || output.title, body: output.caption.slice(0, 700) }];
    for (let index = 0; index < slides.length; index += 1) {
      const slide = slides[index];
      const canvas = renderCard(brand?.name || "Marca", slide.title, slide.body, index + 1, slides.length, theme);
      await downloadCanvas(canvas, `modo-${id.slice(0, 8)}-${String(index + 1).padStart(2, "0")}.png`);
      await new Promise((resolve) => window.setTimeout(resolve, 180));
    }
    setSuccess(`${slides.length} imagem(ns) preparada(s) para download.`);
  }

  if (loading) return <main className="portal-loading"><img src="/logo.svg" alt="MODO" /><div className="portal-spinner" /><p>Abrindo o Studio...</p></main>;
  if (!dashboard || !request || !output) return <main className="portal-loading"><p>{error || "Este conteúdo ainda não está pronto para o Studio."}</p><a className="button button-primary" href="/app/content">Voltar para produção</a></main>;

  return (
    <div className="studio-shell">
      <header className="workspace-header">
        <a href="/app"><img src="/logo.svg" alt="MODO" /></a>
        <nav><a href="/app">Painel</a><a href="/app/week">Minha semana</a><a href="/app/director">Diretor</a><a href="/app/content">Criar</a><a className="active" href={`/app/studio/${id}`}>Studio</a><a href="/app/linkedin">LinkedIn</a></nav>
        <div className="workspace-balance"><small>Marca</small><strong>{brand?.name || "MODO"}</strong><span>{request.channel}</span></div>
      </header>

      <main className="studio-main">
        <section className="studio-heading"><div><div className="section-kicker">MODO STUDIO LITE</div><h1>Refine e leve o conteúdo para o mundo.</h1><p>Edite a entrega, salve a versão e exporte sem abrir outra ferramenta.</p></div><div className="studio-heading-actions"><button className="button button-outline" onClick={() => window.print()}>Salvar como PDF</button><button className="button button-primary" disabled={saving} onClick={() => void save()}>{saving ? "Salvando..." : "Salvar versão"}</button></div></section>

        {error && <div className="portal-error">{error}</div>}
        {success && <div className="workspace-success">{success}</div>}

        <div className="studio-grid">
          <section className="studio-editor">
            <div className="studio-section-title"><small>TEXTO PRINCIPAL</small><h2>Mensagem</h2></div>
            <label>Gancho<textarea value={output.hook} onChange={(event) => patch("hook", event.target.value)} /></label>
            <label>Título<input value={output.title} onChange={(event) => patch("title", event.target.value)} /></label>
            <label>Legenda<textarea className="large" value={output.caption} onChange={(event) => patch("caption", event.target.value)} /></label>
            <label>Chamada para ação<textarea value={output.cta} onChange={(event) => patch("cta", event.target.value)} /></label>
            <label>Direção visual<textarea value={output.visualDirection} onChange={(event) => patch("visualDirection", event.target.value)} /></label>
            <label>Hashtags<input value={output.hashtags.join(" ")} onChange={(event) => patch("hashtags", event.target.value.split(/\s+|,/).map((item) => item.trim()).filter(Boolean).slice(0, 15))} /></label>

            {output.slides.length > 0 && <section className="studio-list-editor"><div className="studio-section-title"><small>CARROSSEL</small><h2>Páginas</h2></div>{output.slides.map((slide, index) => <article key={index}><span>{String(index + 1).padStart(2, "0")}</span><div><input value={slide.title} onChange={(event) => patch("slides", output.slides.map((item, itemIndex) => itemIndex === index ? { ...item, title: event.target.value } : item))} /><textarea value={slide.body} onChange={(event) => patch("slides", output.slides.map((item, itemIndex) => itemIndex === index ? { ...item, body: event.target.value } : item))} /></div></article>)}</section>}

            {output.script.length > 0 && <section className="studio-list-editor"><div className="studio-section-title"><small>VÍDEO</small><h2>Roteiro</h2></div>{output.script.map((scene, index) => <article key={index}><span>{String(index + 1).padStart(2, "0")}</span><div><input value={scene.scene} onChange={(event) => patch("script", output.script.map((item, itemIndex) => itemIndex === index ? { ...item, scene: event.target.value } : item))} /><textarea value={scene.visual} onChange={(event) => patch("script", output.script.map((item, itemIndex) => itemIndex === index ? { ...item, visual: event.target.value } : item))} /><textarea value={scene.voiceover} onChange={(event) => patch("script", output.script.map((item, itemIndex) => itemIndex === index ? { ...item, voiceover: event.target.value } : item))} /></div></article>)}</section>}
          </section>

          <aside className="studio-preview">
            <div className="studio-section-title"><small>PREVIEW E EXPORTAÇÃO</small><h2>Saída prática</h2></div>
            <div className="studio-theme-picker"><button className={theme === "light" ? "selected" : ""} onClick={() => setTheme("light")}>Claro</button><button className={theme === "dark" ? "selected" : ""} onClick={() => setTheme("dark")}>Escuro</button><button className={theme === "blue" ? "selected" : ""} onClick={() => setTheme("blue")}>Azul</button></div>
            <div className={`studio-card-preview ${theme}`}><small>{brand?.name}</small><strong>{output.slides[0]?.title || output.hook}</strong><p>{output.slides[0]?.body || output.caption.slice(0, 240)}</p><span>01/{String(Math.max(1, output.slides.length)).padStart(2, "0")}</span></div>
            <button className="button button-primary button-full" onClick={() => void exportImages()}>{output.slides.length ? "Baixar páginas em PNG" : "Baixar imagem em PNG"}</button>
            <button className="button button-outline button-full" onClick={() => void copy()}>Copiar conteúdo completo</button>
            <button className="button button-outline button-full" onClick={() => download(`modo-${id.slice(0, 8)}.txt`, plainText(output), "text/plain;charset=utf-8")}>Baixar texto</button>
            <button className="button button-outline button-full" onClick={() => download(`modo-${id.slice(0, 8)}.json`, JSON.stringify(output, null, 2), "application/json")}>Baixar estrutura</button>
            <div className="studio-note"><strong>Design simples, resultado utilizável.</strong><p>Os PNGs usam um template editorial da MODO. A evolução futura adicionará identidade visual própria da marca e mais modelos, sem transformar a experiência em um editor complicado.</p></div>
          </aside>
        </div>
      </main>
    </div>
  );
}
