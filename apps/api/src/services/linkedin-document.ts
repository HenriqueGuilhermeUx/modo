import type { GeneratedContent } from "@modo/contracts/content";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

function wrap(text: string, maxCharacters: number) {
  const words = text.replace(/\s+/g, " ").trim().split(" ");
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length > maxCharacters && current) {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current) lines.push(current);
  return lines;
}

export async function renderLinkedInDocument(output: GeneratedContent) {
  const document = await PDFDocument.create();
  const regular = await document.embedFont(StandardFonts.Helvetica);
  const bold = await document.embedFont(StandardFonts.HelveticaBold);
  const slides = output.slides.length > 0
    ? output.slides
    : [{ title: output.title, body: output.caption }];

  const addSlide = (title: string, body: string, index: number, total: number) => {
    const page = document.addPage([800, 1000]);
    page.drawRectangle({ x: 0, y: 0, width: 800, height: 1000, color: rgb(0.96, 0.97, 0.99) });
    page.drawRectangle({ x: 0, y: 0, width: 30, height: 1000, color: rgb(0.12, 0.37, 1) });
    page.drawText("MODO LINKEDIN", { x: 70, y: 925, size: 15, font: bold, color: rgb(0.12, 0.37, 1) });
    page.drawText(`${String(index).padStart(2, "0")} / ${String(total).padStart(2, "0")}`, { x: 650, y: 925, size: 12, font: regular, color: rgb(0.36, 0.4, 0.48) });
    let y = 820;
    for (const line of wrap(title, 36)) {
      page.drawText(line, { x: 70, y, size: 34, font: bold, color: rgb(0.05, 0.11, 0.24) });
      y -= 44;
    }
    y -= 25;
    for (const line of wrap(body, 65)) {
      if (y < 90) break;
      page.drawText(line, { x: 70, y, size: 19, font: regular, color: rgb(0.22, 0.27, 0.36) });
      y -= 29;
    }
    page.drawText("Sua marca em modo presença.", { x: 70, y: 48, size: 12, font: bold, color: rgb(0.12, 0.37, 1) });
  };

  addSlide(output.hook, output.title, 1, slides.length + 1);
  slides.forEach((slide, index) => addSlide(slide.title, slide.body, index + 2, slides.length + 1));
  return document.save();
}
