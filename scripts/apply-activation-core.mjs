import fs from "node:fs";

function replaceExact(path, before, after) {
  const current = fs.readFileSync(path, "utf8");
  if (!current.includes(before)) {
    throw new Error(`Trecho não encontrado em ${path}: ${before.slice(0, 140)}`);
  }
  fs.writeFileSync(path, current.replace(before, after));
}

replaceExact(
  "apps/api/src/app.ts",
  'import { registerCanvaRoutes } from "./routes/canva-routes.js";',
  'import { registerActivationRoutes } from "./routes/activation-routes.js";\nimport { registerCanvaRoutes } from "./routes/canva-routes.js";',
);

replaceExact(
  "apps/api/src/app.ts",
  'import { AuthError, AuthService } from "./services/auth-service.js";',
  'import { ActivationService } from "./services/activation-service.js";\nimport { AuthError, AuthService } from "./services/auth-service.js";',
);

replaceExact(
  "apps/api/src/app.ts",
  '  const assets = new ContentAssetService({\n    databaseUrl: options.databaseUrl,\n    databaseSsl: options.databaseSsl,\n    publicApiUrl: options.publicApiUrl,\n  });',
  '  const assets = new ContentAssetService({\n    databaseUrl: options.databaseUrl,\n    databaseSsl: options.databaseSsl,\n    publicApiUrl: options.publicApiUrl,\n  });\n  const activation = new ActivationService({\n    auth,\n    content,\n    databaseUrl: options.databaseUrl,\n    databaseSsl: options.databaseSsl,\n  });',
);

replaceExact(
  "apps/api/src/app.ts",
  '  await content.initialize();\n  await assets.initialize();',
  '  await content.initialize();\n  await assets.initialize();\n  await activation.initialize();',
);

replaceExact(
  "apps/api/src/app.ts",
  '    await Promise.all([billing.close(), auth.close(), content.close(), assets.close(), canva.close(), payments.close(), admin.close()]);',
  '    await Promise.all([billing.close(), auth.close(), content.close(), assets.close(), activation.close(), canva.close(), payments.close(), admin.close()]);',
);

replaceExact(
  "apps/api/src/app.ts",
  '  await registerCreativeIntelligenceRoutes(app, {',
  '  await registerActivationRoutes(app, { auth, activation });\n  await registerCreativeIntelligenceRoutes(app, {',
);

replaceExact(
  "apps/api/src/app.ts",
  '    version: "0.14.1",',
  '    version: "0.15.0",',
);

replaceExact(
  "apps/api/src/app.ts",
  '    assetStorage: assets.storage,\n    contentProvider: automation.mode,',
  '    assetStorage: assets.storage,\n    activationTracking: "enabled",\n    activationStorage: activation.storage,\n    contentProvider: automation.mode,',
);

replaceExact(
  "apps/web/src/main.tsx",
  'import "./campaign.css";',
  'import "./campaign.css";\nimport "./activation.css";',
);

replaceExact(
  "apps/web/src/Portal.tsx",
  'import {\n  createBrand,',
  'import ActivationChecklist from "./ActivationChecklist";\nimport {\n  createBrand,',
);

replaceExact(
  "apps/web/src/Portal.tsx",
  '        {error && <div className="portal-error portal-error-wide">{error}</div>}\n\n        <section className="portal-overview" id="overview">',
  '        {error && <div className="portal-error portal-error-wide">{error}</div>}\n\n        <ActivationChecklist />\n\n        <section className="portal-overview" id="overview">',
);

replaceExact(
  "apps/web/src/OnboardingWorkspace.tsx",
  'import { generateCreativePlan, saveCreativeProfile } from "./director-api";',
  'import { trackActivationEvent } from "./activation-api";\nimport { generateCreativePlan, saveCreativeProfile } from "./director-api";',
);

replaceExact(
  "apps/web/src/OnboardingWorkspace.tsx",
  '    if (!getSessionToken()) {\n      window.location.href = "/app";\n      return;\n    }\n    getDashboard()',
  '    if (!getSessionToken()) {\n      window.location.href = "/app";\n      return;\n    }\n    void trackActivationEvent("onboarding_started").catch(() => undefined);\n    getDashboard()',
);

replaceExact(
  "apps/web/src/OnboardingWorkspace.tsx",
  '      await generateCreativePlan(brandId);\n      if (dashboard) {',
  '      await generateCreativePlan(brandId);\n      await trackActivationEvent("onboarding_completed", {\n        brandId,\n        objectives: objectives.length,\n        channels: channels.length,\n        weeklyMinutes,\n      }).catch(() => undefined);\n      if (dashboard) {',
);

replaceExact(
  "apps/web/src/StudioWorkspace.tsx",
  'import { getContentRequest, getDashboard, getSessionToken } from "./api";',
  'import { trackActivationEvent } from "./activation-api";\nimport { getContentRequest, getDashboard, getSessionToken } from "./api";',
);

replaceExact(
  "apps/web/src/StudioWorkspace.tsx",
  '        setRequest(currentRequest);\n        setOutput(currentRequest.output);',
  '        setRequest(currentRequest);\n        setOutput(currentRequest.output);\n        void trackActivationEvent("studio_opened", { contentRequestId: id }).catch(() => undefined);',
);

replaceExact(
  "apps/web/src/StudioWorkspace.tsx",
  '      setSuccess("Versão salva. A edição já faz parte do conteúdo da MODO.");',
  '      setSuccess("Versão salva. A edição já faz parte do conteúdo da MODO.");\n      void trackActivationEvent("studio_saved", { contentRequestId: id }).catch(() => undefined);',
);

replaceExact(
  "apps/web/src/StudioWorkspace.tsx",
  '    setSuccess(`${slides.length} imagem(ns) preparada(s) para download.`);',
  '    setSuccess(`${slides.length} imagem(ns) preparada(s) para download.`);\n    void trackActivationEvent("asset_exported", {\n      contentRequestId: id,\n      assets: slides.length,\n      format: "png",\n    }).catch(() => undefined);',
);

fs.rmSync("scripts/apply-activation-core.mjs");
fs.rmSync(".github/workflows/apply-activation-core.yml");
console.log("Modo Activation Core aplicado.");
