/**
 * HyperFrames export prototype. Does not change the Remotion renderer or publish videos.
 * Produces a standalone, seekable index.html composition to validate in an isolated worker.
 */
export type HyperframesPilotScene = {
  headline: string;
  caption?: string;
  durationSeconds: number;
};

export type HyperframesPilotInput = {
  brandName: string;
  accentColor: string;
  format: "reel" | "landscape" | "square";
  scenes: HyperframesPilotScene[];
};

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function validColor(input: string): string {
  if (!/^#[0-9a-fA-F]{6}$/.test(input)) throw new Error("HYPERFRAMES_INVALID_COLOR");
  return input;
}

export function buildHyperframesPilot(input: HyperframesPilotInput) {
  if (!input || !input.brandName || input.brandName.length > 100) {
    throw new Error("HYPERFRAMES_INVALID_BRAND");
  }
  if (!Array.isArray(input.scenes) || input.scenes.length < 1 || input.scenes.length > 8) {
    throw new Error("HYPERFRAMES_INVALID_SCENES");
  }
  if (!["reel", "landscape", "square"].includes(input.format)) {
    throw new Error("HYPERFRAMES_INVALID_FORMAT");
  }
  const dimensions = input.format === "reel" ? [1080, 1920] :
    input.format === "square" ? [1080, 1080] : [1920, 1080];
  const color = validColor(input.accentColor);
  let cursor = 0;
  const clips: string[] = [];
  for (const [index, scene] of input.scenes.entries()) {
    if (!scene || typeof scene.headline !== "string" || !scene.headline.trim() ||
        scene.headline.length > 180 || (scene.caption || "").length > 280 ||
        !Number.isFinite(scene.durationSeconds) ||
        scene.durationSeconds < 1 || scene.durationSeconds > 12) {
      throw new Error("HYPERFRAMES_INVALID_SCENE");
    }
    const start = Number(cursor.toFixed(3));
    const duration = Number(scene.durationSeconds.toFixed(3));
    clips.push(
      '<section id="scene-' + (index + 1) + '" class="clip scene" data-start="' + start +
      '" data-duration="' + duration + '" data-track-index="0">' +
      '<div class="brand">' + escapeHtml(input.brandName) + '</div>' +
      '<h1>' + escapeHtml(scene.headline) + '</h1>' +
      '<p>' + escapeHtml(scene.caption || "") + '</p>' +
      '</section>'
    );
    cursor += duration;
  }
  if (cursor > 60) throw new Error("HYPERFRAMES_DURATION_LIMIT");
  const html = [
    '<!DOCTYPE html><html lang="pt-BR"><head><meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    '<style>',
    '*{box-sizing:border-box}html,body{margin:0;padding:0;background:#090e17;font-family:Arial,sans-serif;}',
    '#root{position:relative;overflow:hidden;background:#090e17;color:#fff;isolation:isolate;}',
    '.clip{position:absolute;inset:0;width:100%;height:100%;}',
    '.scene{display:flex;flex-direction:column;justify-content:center;align-items:flex-start;padding:9%;gap:3%;}',
    '.brand{color:' + color + ';font-weight:800;text-transform:uppercase;font-size:34px;letter-spacing:4px;}',
    'h1{font-size:86px;line-height:1.09;margin:0;max-width:95%;overflow-wrap:break-word;}',
    'p{font-size:40px;line-height:1.25;max-width:92%;margin:0;opacity:.85;overflow-wrap:break-word;}',
    '</style></head><body>',
    '<div id="root" data-composition-id="root" data-start="0" data-fps="30" data-width="' + dimensions[0] +
    '" data-height="' + dimensions[1] + '">',
    clips.join("\n"),
    '</div></body></html>',
  ].join("\n");
  return {
    filename: "index.html" as const,
    html,
    width: dimensions[0],
    height: dimensions[1],
    fps: 30,
    durationSeconds: Number(cursor.toFixed(3)),
    renderer: "hyperframes" as const,
    status: "export-only" as const,
  };
}
