import fs from "node:fs";

function replace(path, before, after) {
  const current = fs.readFileSync(path, "utf8");
  if (!current.includes(before)) {
    throw new Error(`Trecho não encontrado em ${path}: ${before.slice(0, 100)}`);
  }
  fs.writeFileSync(path, current.replace(before, after));
}

function append(path, content) {
  const current = fs.readFileSync(path, "utf8");
  if (!current.includes(content.trim())) fs.writeFileSync(path, `${current.trimEnd()}\n${content.trim()}\n`);
}

replace(
  "apps/api/src/config.ts",
  `    LINKEDIN_TOKEN_ENCRYPTION_SECRET: optionalTrimmedString,\n    LINKEDIN_API_VERSION: z.preprocess(emptyToUndefined, z.string().default("202606")),`,
  `    LINKEDIN_TOKEN_ENCRYPTION_SECRET: optionalTrimmedString,\n    LINKEDIN_API_VERSION: z.preprocess(emptyToUndefined, z.string().default("202606")),\n    CANVA_CLIENT_ID: optionalTrimmedString,\n    CANVA_CLIENT_SECRET: optionalTrimmedString,\n    CANVA_REDIRECT_URI: optionalUrl,\n    CANVA_TOKEN_ENCRYPTION_SECRET: optionalTrimmedString,\n    CANVA_SCOPES: z.preprocess(\n      emptyToUndefined,\n      z.string().default("asset:read asset:write design:content:write design:meta:read"),\n    ),`,
);

replace(
  "apps/api/src/server.ts",
  `  openAiApiKey: config.OPENAI_API_KEY,\n  openAiTextModel: config.OPENAI_TEXT_MODEL,\n  openAiImageModel: config.OPENAI_IMAGE_MODEL,`,
  `  openAiApiKey: config.OPENAI_API_KEY,\n  openAiTextModel: config.OPENAI_TEXT_MODEL,\n  openAiImageModel: config.OPENAI_IMAGE_MODEL,\n  canvaClientId: config.CANVA_CLIENT_ID,\n  canvaClientSecret: config.CANVA_CLIENT_SECRET,\n  canvaRedirectUri: config.CANVA_REDIRECT_URI,\n  canvaEncryptionSecret: config.CANVA_TOKEN_ENCRYPTION_SECRET,\n  canvaScopes: config.CANVA_SCOPES,\n  publicWebUrl: config.PUBLIC_WEB_URL,`,
);

replace(
  "apps/api/src/app.ts",
  `import { registerCreativeIntelligenceRoutes } from "./routes/creative-intelligence-routes.js";`,
  `import { registerCanvaRoutes } from "./routes/canva-routes.js";\nimport { registerCreativeIntelligenceRoutes } from "./routes/creative-intelligence-routes.js";`,
);
replace(
  "apps/api/src/app.ts",
  `import { BillingError, BillingService } from "./services/billing-service.js";`,
  `import { BillingError, BillingService } from "./services/billing-service.js";\nimport { CanvaService } from "./services/canva-service.js";`,
);
replace(
  "apps/api/src/app.ts",
  `  openAiApiKey?: string;\n  openAiTextModel?: string;\n  openAiImageModel?: string;`,
  `  openAiApiKey?: string;\n  openAiTextModel?: string;\n  openAiImageModel?: string;\n  canvaClientId?: string;\n  canvaClientSecret?: string;\n  canvaRedirectUri?: string;\n  canvaEncryptionSecret?: string;\n  canvaScopes?: string;\n  publicWebUrl?: string;`,
);
replace(
  "apps/api/src/app.ts",
  `  const admin = new PlatformAdminService({`,
  `  const canva = new CanvaService({\n    clientId: options.canvaClientId,\n    clientSecret: options.canvaClientSecret,\n    redirectUri: options.canvaRedirectUri,\n    encryptionSecret: options.canvaEncryptionSecret,\n    scopes: options.canvaScopes,\n    webUrl: options.publicWebUrl,\n    databaseUrl: options.databaseUrl,\n    databaseSsl: options.databaseSsl,\n  });\n  const admin = new PlatformAdminService({`,
);
replace(
  "apps/api/src/app.ts",
  `  await content.initialize();\n  await assets.initialize();\n  await payments.initialize();`,
  `  await content.initialize();\n  await assets.initialize();\n  await canva.initialize();\n  await payments.initialize();`,
);
replace(
  "apps/api/src/app.ts",
  `    await Promise.all([billing.close(), auth.close(), content.close(), assets.close(), payments.close(), admin.close()]);`,
  `    await Promise.all([billing.close(), auth.close(), content.close(), assets.close(), canva.close(), payments.close(), admin.close()]);`,
);
replace(
  "apps/api/src/app.ts",
  `  await registerStudioRoutes(app, {\n    auth,\n    content,\n    databaseUrl: options.databaseUrl,\n    databaseSsl: options.databaseSsl,\n  });`,
  `  await registerStudioRoutes(app, {\n    auth,\n    content,\n    databaseUrl: options.databaseUrl,\n    databaseSsl: options.databaseSsl,\n  });\n  await registerCanvaRoutes(app, { auth, content, assets, canva });`,
);
replace(
  "apps/api/src/app.ts",
  `    version: "0.13.0",`,
  `    version: "0.14.0",`,
);
replace(
  "apps/api/src/app.ts",
  `    imageGeneration: automation.imageMode,\n    creativeIntelligence: "enabled",`,
  `    imageGeneration: automation.imageMode,\n    canvaIntegration: canva.configured ? "configured" : "not_configured",\n    canvaStorage: canva.storage,\n    creativeIntelligence: "enabled",`,
);

replace(
  "apps/api/src/services/content-asset-service.ts",
  `  async getPublic(publicToken: string): Promise<{ mimeType: string; data: Buffer } | null> {`,
  `  async getLatestForRequest(organizationId: string, contentRequestId: string): Promise<{ mimeType: string; data: Buffer } | null> {\n    if (this.pool) {\n      const result = await this.pool.query<AssetRow>(\n        \`SELECT id, public_token, organization_id, content_request_id, mime_type, data\n         FROM modo_content_assets\n         WHERE organization_id=$1 AND content_request_id=$2\n         ORDER BY created_at DESC LIMIT 1\`,\n        [organizationId, contentRequestId],\n      );\n      if (!result.rowCount) return null;\n      return { mimeType: result.rows[0].mime_type, data: result.rows[0].data };\n    }\n    const matches = [...this.memory.values()]\n      .filter((asset) => asset.organizationId === organizationId && asset.contentRequestId === contentRequestId);\n    const asset = matches[matches.length - 1];\n    return asset ? { mimeType: asset.mimeType, data: asset.data } : null;\n  }\n\n  async getPublic(publicToken: string): Promise<{ mimeType: string; data: Buffer } | null> {`,
);

replace(
  "apps/api/src/services/canva-service.ts",
  `    this.requireConfigured();\n    const existing = await this.getDesign(input.accountId, input.contentRequestId);`,
  `    this.requireConfigured();\n    if (!["image/png", "image/jpeg", "image/webp"].includes(input.mimeType)) {\n      throw new CanvaError("CANVA_UNSUPPORTED_ASSET", 409, "O formato da imagem aprovada não é compatível com o Canva.");\n    }\n    const existing = await this.getDesign(input.accountId, input.contentRequestId);`,
);

replace(
  "apps/web/src/ContentWorkspace.tsx",
  `import CreativeDirector from "./CreativeDirector";`,
  `import CanvaApprovalAction from "./CanvaApprovalAction";\nimport CreativeDirector from "./CreativeDirector";`,
);
replace(
  "apps/web/src/ContentWorkspace.tsx",
  `{request.status === "approved" && <div className="content-approved"><strong>✓ Conteúdo aprovado</strong><p>Esta versão está pronta para a próxima etapa de publicação.</p></div>}`,
  `{request.status === "approved" && <><div className="content-approved"><strong>✓ Conteúdo aprovado</strong><p>Esta versão está pronta para a etapa de acabamento e publicação.</p></div><CanvaApprovalAction contentRequestId={request.id} /></>}`,
);

append(
  "apps/web/src/workspace.css",
  `.canva-approval-action{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:16px;align-items:center;margin-top:16px;padding:20px;border:1px solid #d8e1f1;border-radius:18px;background:linear-gradient(135deg,#f7f5ff,#eef5ff)}.canva-approval-action.loading{display:flex;color:#5b657a}.canva-approval-action.loading .portal-spinner{width:24px;height:24px}.canva-approval-action.unavailable{grid-template-columns:1fr;background:#f7f9fd}.canva-approval-copy{display:grid;gap:7px}.canva-approval-copy small{color:#7b61ff;font-size:9px;font-weight:900;letter-spacing:.12em}.canva-approval-copy strong{font:750 18px/1.25 Sora,sans-serif;color:#0d1b3e}.canva-approval-copy p{margin:0;color:#5b657a;line-height:1.55;font-size:12px}.canva-approval-actions{display:flex;align-items:center}.canva-governance-note{grid-column:1/-1;margin:0!important;padding-top:12px;border-top:1px solid rgba(31,94,255,.12);color:#68748a!important;font-size:10px!important}.canva-approval-action .portal-error{margin-top:5px}.canva-approval-action .button{white-space:nowrap}@media(max-width:640px){.canva-approval-action{grid-template-columns:1fr}.canva-approval-actions .button{width:100%}}`,
);

replace(
  "render.yaml",
  `      - key: OPENAI_IMAGE_MODEL\n        value: gpt-image-1`,
  `      - key: OPENAI_IMAGE_MODEL\n        value: gpt-image-2-2026-04-21`,
);
append(
  "render.yaml",
  `      - key: CANVA_CLIENT_ID\n        sync: false\n      - key: CANVA_CLIENT_SECRET\n        sync: false\n      - key: CANVA_REDIRECT_URI\n        value: https://modo-api-3m10.onrender.com/api/v1/canva/callback\n      - key: CANVA_TOKEN_ENCRYPTION_SECRET\n        sync: false\n      - key: CANVA_SCOPES\n        value: asset:read asset:write design:content:write design:meta:read`,
);

console.log("Canva approved export v1 aplicado.");
