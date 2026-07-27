import { readFileSync, writeFileSync, unlinkSync } from "node:fs";

function replaceOnce(source, search, replacement, label) {
  const count = source.split(search).length - 1;
  if (count !== 1) throw new Error(`${label}: expected one match, found ${count}`);
  return source.replace(search, replacement);
}

const workspacePath = "apps/web/src/ContentWorkspace.tsx";
let workspace = readFileSync(workspacePath, "utf8");
workspace = replaceOnce(
  workspace,
  `    <div className="content-output">\n      <section className="content-output-lead"><small>GANCHO</small><h3>{output.hook}</h3></section>`,
  `    <div className="content-output">\n      {output.imageUrl ? (\n        <section className="content-generated-asset">\n          <div className="content-generated-asset-heading">\n            <div><small>CRIATIVO GERADO</small><strong>Imagem contextual pronta</strong></div>\n            <span>IA + contexto da marca</span>\n          </div>\n          <img src={output.imageUrl} alt={output.imageAlt || output.title} loading="lazy" />\n          <div className="content-generated-asset-footer">\n            <p>{output.imageAlt || "Imagem produzida a partir do briefing e da direção visual."}</p>\n            <a className="button button-outline" href={output.imageUrl} target="_blank" rel="noreferrer">Abrir imagem original</a>\n          </div>\n        </section>\n      ) : (\n        <section className={\`content-image-state \${output.imageStatus}\`}>\n          <small>CRIATIVO VISUAL</small>\n          <strong>{output.imageStatus === "failed" ? "A copy está pronta, mas a imagem não foi concluída" : output.imageStatus === "fallback" ? "Peça pronta com composição segura da MODO" : "Imagem ainda não gerada"}</strong>\n          <p>{output.imageStatus === "failed" ? "Abra o Studio para manter a copy e solicitar uma nova imagem sem perder o trabalho." : "A direção visual abaixo orienta a composição final no Studio."}</p>\n        </section>\n      )}\n      <section className="content-output-lead"><small>GANCHO</small><h3>{output.hook}</h3></section>`,
  "insert generated image panel",
);
writeFileSync(workspacePath, workspace);

const cssPath = "apps/web/src/workspace.css";
let css = readFileSync(cssPath, "utf8");
css += `.content-generated-asset{padding:0!important;overflow:hidden;background:#07152f!important;border-color:#102a5d!important;color:#fff}.content-generated-asset-heading{display:flex;align-items:center;justify-content:space-between;gap:14px;padding:18px 18px 14px}.content-generated-asset-heading>div{display:grid;gap:4px}.content-generated-asset-heading small{margin:0!important;color:#72ffd0!important}.content-generated-asset-heading strong{font:800 18px/1.2 Sora,sans-serif}.content-generated-asset-heading>span{border-radius:999px;background:rgba(114,255,208,.12);color:#72ffd0;padding:7px 10px;font-size:9px;font-weight:900;letter-spacing:.06em;text-transform:uppercase}.content-generated-asset>img{display:block;width:100%;max-height:720px;aspect-ratio:4/5;object-fit:cover;background:#e8edf7}.content-generated-asset-footer{display:flex;align-items:center;gap:16px;padding:15px 18px 18px}.content-generated-asset-footer p{color:#d6e0f5!important;font-size:11px;line-height:1.55!important;margin-right:auto!important}.content-generated-asset-footer .button{flex:none}.content-image-state{display:grid;gap:7px}.content-image-state strong{font:800 17px/1.3 Sora,sans-serif}.content-image-state.failed{background:#fff8e8!important;border-color:#f0d798!important}.content-image-state.fallback{background:#eef9ff!important;border-color:#b8e2f6!important}@media(max-width:640px){.content-generated-asset-heading,.content-generated-asset-footer{align-items:flex-start;flex-direction:column}.content-generated-asset-footer .button{width:100%}.content-generated-asset>img{max-height:520px}}`;
writeFileSync(cssPath, css);

unlinkSync("scripts/apply-show-generated-images-in-history.mjs");
unlinkSync(".github/workflows/apply-show-generated-images-in-history.yml");
console.log("Generated image history patch applied.");
