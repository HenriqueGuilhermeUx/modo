from pathlib import Path


def replace_once(path: str, old: str, new: str):
    file = Path(path)
    text = file.read_text()
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{path}: expected one match, found {count}")
    file.write_text(text.replace(old, new, 1))


replace_once(
    "apps/api/src/app.ts",
    'import { ContentError, ContentService } from "./services/content-service.js";\n',
    'import { ContentAssetService } from "./services/content-asset-service.js";\nimport { ContentError, ContentService } from "./services/content-service.js";\n',
)

replace_once(
    "apps/api/src/app.ts",
    '''  contentProvider?: "demo" | "n8n";
  contentWebhookUrl?: string;
  contentSecret?: string;
  publicApiUrl?: string;
  contentDemoDelayMs?: number;
''',
    '''  contentProvider?: "native" | "openai" | "demo" | "n8n";
  contentWebhookUrl?: string;
  contentSecret?: string;
  publicApiUrl?: string;
  contentDemoDelayMs?: number;
  openAiApiKey?: string;
  openAiTextModel?: string;
  openAiImageModel?: string;
''',
)

replace_once(
    "apps/api/src/app.ts",
    '''  const content = new ContentService({
    databaseUrl: options.databaseUrl,
    databaseSsl: options.databaseSsl,
  });
  const admin = new PlatformAdminService({
''',
    '''  const content = new ContentService({
    databaseUrl: options.databaseUrl,
    databaseSsl: options.databaseSsl,
  });
  const assets = new ContentAssetService({
    databaseUrl: options.databaseUrl,
    databaseSsl: options.databaseSsl,
    publicApiUrl: options.publicApiUrl,
  });
  const admin = new PlatformAdminService({
''',
)

replace_once(
    "apps/api/src/app.ts",
    '''  const automation = new ContentAutomationService({
    provider: options.contentProvider,
    webhookUrl: options.contentWebhookUrl,
    secret: options.contentSecret,
    publicApiUrl: options.publicApiUrl,
    demoDelayMs: options.contentDemoDelayMs,
    content,
  });
''',
    '''  const automation = new ContentAutomationService({
    provider: options.contentProvider === "openai" ? "openai" : "native",
    secret: options.contentSecret,
    content,
    assets,
    openAiApiKey: options.openAiApiKey,
    openAiTextModel: options.openAiTextModel,
    openAiImageModel: options.openAiImageModel,
  });
''',
)

replace_once(
    "apps/api/src/app.ts",
    '''  await content.initialize();
  await payments.initialize();
''',
    '''  await content.initialize();
  await assets.initialize();
  await payments.initialize();
''',
)

replace_once(
    "apps/api/src/app.ts",
    '''    await Promise.all([billing.close(), auth.close(), content.close(), payments.close(), admin.close()]);
''',
    '''    await Promise.all([billing.close(), auth.close(), content.close(), assets.close(), payments.close(), admin.close()]);
''',
)

replace_once(
    "apps/api/src/app.ts",
    '''  await app.register(rateLimit, { max: 80, timeWindow: "1 minute" });
  await registerCreativeIntelligenceRoutes(app, {
''',
    '''  await app.register(rateLimit, { max: 80, timeWindow: "1 minute" });
  app.get("/api/v1/public/content-assets/:token", async (request, reply) => {
    const token = (request.params as { token: string }).token;
    const asset = await assets.getPublic(token);
    if (!asset) return reply.code(404).send({ message: "Imagem não encontrada." });
    return reply
      .header("content-type", asset.mimeType)
      .header("cache-control", "public, max-age=31536000, immutable")
      .send(asset.data);
  });
  await registerCreativeIntelligenceRoutes(app, {
''',
)

replace_once(
    "apps/api/src/app.ts",
    '''    version: "0.12.0",
    billingStorage: billing.storage,
    accountStorage: auth.storage,
    contentStorage: content.storage,
    contentProvider: automation.mode,
''',
    '''    version: "0.13.0",
    buildCommit: (process.env.RENDER_GIT_COMMIT || "local").slice(0, 12),
    gitBranch: process.env.RENDER_GIT_BRANCH || "local",
    billingStorage: billing.storage,
    accountStorage: auth.storage,
    contentStorage: content.storage,
    assetStorage: assets.storage,
    contentProvider: automation.mode,
    imageGeneration: automation.imageMode,
''',
)

studio = Path("apps/web/src/StudioWorkspace.tsx")
text = studio.read_text()
text = text.replace(
    '''function renderCard(
  brandName: string,
  title: string,
  body: string,
  index: number,
  total: number,
  themeName: StudioTheme,
) {
''',
    '''function renderCard(
  brandName: string,
  title: string,
  body: string,
  index: number,
  total: number,
  themeName: StudioTheme,
  backgroundImage?: CanvasImageSource,
) {
''',
    1,
)
text = text.replace(
    '''  context.fillStyle = theme.background;
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = theme.accent;
''',
    '''  if (backgroundImage) {
    const sourceWidth = "naturalWidth" in backgroundImage ? backgroundImage.naturalWidth : backgroundImage.width;
    const sourceHeight = "naturalHeight" in backgroundImage ? backgroundImage.naturalHeight : backgroundImage.height;
    const scale = Math.max(canvas.width / sourceWidth, canvas.height / sourceHeight);
    const width = sourceWidth * scale;
    const height = sourceHeight * scale;
    context.drawImage(backgroundImage, (canvas.width - width) / 2, (canvas.height - height) / 2, width, height);
    const gradient = context.createLinearGradient(0, 0, 0, canvas.height);
    gradient.addColorStop(0, "rgba(5,12,30,.18)");
    gradient.addColorStop(.52, "rgba(5,12,30,.32)");
    gradient.addColorStop(1, "rgba(5,12,30,.86)");
    context.fillStyle = gradient;
    context.fillRect(0, 0, canvas.width, canvas.height);
  } else {
    context.fillStyle = theme.background;
    context.fillRect(0, 0, canvas.width, canvas.height);
  }
  const textColor = backgroundImage ? "#ffffff" : theme.text;
  context.fillStyle = theme.accent;
''',
    1,
)
text = text.replace('  context.fillStyle = theme.text;\n  context.fillText(brandName.toUpperCase()', '  context.fillStyle = textColor;\n  context.fillText(brandName.toUpperCase()', 1)
text = text.replace('  context.fillStyle = theme.text;\n  const titleLines', '  context.fillStyle = textColor;\n  const titleLines', 1)
text = text.replace('  context.fillStyle = theme.text;\n  context.globalAlpha = 0.86;', '  context.fillStyle = textColor;\n  context.globalAlpha = 0.9;', 1)
text = text.replace('  context.fillStyle = theme.text;\n  context.globalAlpha = 0.72;', '  context.fillStyle = textColor;\n  context.globalAlpha = 0.78;', 1)

text = text.replace(
    '''  async function exportImages() {
    if (!output) return;
    const slides = output.slides.length
      ? output.slides
      : [{ title: output.hook || output.title, body: output.caption.slice(0, 700) }];
    for (let index = 0; index < slides.length; index += 1) {
      const slide = slides[index];
      const canvas = renderCard(brand?.name || "Marca", slide.title, slide.body, index + 1, slides.length, theme);
''',
    '''  async function exportImages() {
    if (!output) return;
    const slides = output.slides.length
      ? output.slides
      : [{ title: output.hook || output.title, body: output.caption.slice(0, 700) }];
    let generatedImage: HTMLImageElement | undefined;
    if (output.imageUrl) {
      const blob = await fetch(output.imageUrl).then((response) => {
        if (!response.ok) throw new Error("Não foi possível carregar a imagem gerada.");
        return response.blob();
      });
      const objectUrl = URL.createObjectURL(blob);
      generatedImage = await new Promise<HTMLImageElement>((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = () => reject(new Error("Não foi possível abrir a imagem gerada."));
        image.src = objectUrl;
      });
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 5000);
    }
    for (let index = 0; index < slides.length; index += 1) {
      const slide = slides[index];
      const canvas = renderCard(
        brand?.name || "Marca",
        slide.title,
        slide.body,
        index + 1,
        slides.length,
        theme,
        index === 0 ? generatedImage : undefined,
      );
''',
    1,
)

old_preview = '''            <div className={`studio-card-preview ${theme}`}><small>{brand?.name}</small><strong>{output.slides[0]?.title || output.hook}</strong><p>{output.slides[0]?.body || output.caption.slice(0, 240)}</p><span>01/{String(Math.max(1, output.slides.length)).padStart(2, "0")}</span></div>
'''
new_preview = '''            <div
              className={`studio-card-preview ${theme} ${output.imageUrl ? "generated" : ""}`}
              style={output.imageUrl ? { backgroundImage: `linear-gradient(180deg,rgba(5,12,30,.12),rgba(5,12,30,.82)),url(${output.imageUrl})` } : undefined}
            ><small>{brand?.name}</small><strong>{output.slides[0]?.title || output.hook}</strong><p>{output.slides[0]?.body || output.caption.slice(0, 240)}</p><span>01/{String(Math.max(1, output.slides.length)).padStart(2, "0")}</span></div>
            <div className={`studio-image-status ${output.imageStatus}`}>
              <strong>{output.imageUrl ? "Imagem contextual gerada" : "Imagem aguardando configuração"}</strong>
              <p>{output.imageUrl ? output.imageAlt : "A copy e a direção visual estão prontas. A imagem será criada automaticamente quando o motor visual estiver ativo."}</p>
            </div>
'''
if old_preview not in text:
    raise SystemExit("Studio preview marker not found")
text = text.replace(old_preview, new_preview, 1)
studio.write_text(text)

css = Path("apps/web/src/studio.css")
css.write_text(css.read_text() + '''\n.studio-card-preview.generated{background-size:cover;background-position:center;color:#fff}.studio-card-preview.generated p{opacity:.94}.studio-image-status{border-radius:14px;padding:13px 14px;margin:4px 0 12px;background:#f4f7fb;border:1px solid #dfe6f1}.studio-image-status.generated{background:#ecfbf5;border-color:#bdebd9}.studio-image-status.failed{background:#fff7e8;border-color:#f0d59a}.studio-image-status strong{display:block;font-size:11px}.studio-image-status p{font-size:10px;line-height:1.5;color:#5b657a;margin:5px 0 0}\n''')

render = Path("render.yaml")
render_text = render.read_text()
render_text = render_text.replace(
    '''      - key: CONTENT_PROVIDER
        sync: false
''',
    '''      - key: CONTENT_PROVIDER
        value: openai
''',
    1,
)
render_text = render_text.replace(
    '''      - key: N8N_CONTENT_SECRET
        sync: false
''',
    '''      - key: N8N_CONTENT_SECRET
        sync: false
      - key: OPENAI_API_KEY
        sync: false
      - key: OPENAI_TEXT_MODEL
        value: gpt-5-mini
      - key: OPENAI_IMAGE_MODEL
        value: gpt-image-1
''',
    1,
)
render.write_text(render_text)

Path("scripts/apply-content-engine-wiring.py").unlink(missing_ok=True)
Path(".github/workflows/apply-content-engine-wiring.yml").unlink(missing_ok=True)
Path(".github/content-engine-wiring-trigger.txt").unlink(missing_ok=True)
