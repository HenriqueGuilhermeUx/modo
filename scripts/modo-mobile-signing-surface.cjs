"use strict";

const fs = require("node:fs");

const EXPECTED = Object.freeze({
  androidPackage: "br.com.alternativeventures.modo",
  iosBundle: "br.com.alternativeventures.modo",
  runtimePolicy: "appVersion",
  version: "1.1.0",
  androidVersionCode: 6,
  iosBuildNumber: "5",
});

/**
 * Checks the current app configuration and its expected signing/update
 * boundaries. This does NOT validate EAS credentials, app signing, OTA code
 * authenticity or package exploitability.
 */
function inspectMobileSigningSurface(appFile, easFile) {
  const app = appFile?.expo;
  const builds = easFile?.build;
  if (!app || !builds || !builds.production)
    throw new Error("MODO_MOBILE_SIGNING_CONFIG_UNAVAILABLE");
  if (app.android?.package !== EXPECTED.androidPackage ||
      app.ios?.bundleIdentifier !== EXPECTED.iosBundle ||
      app.version !== EXPECTED.version ||
      app.android?.versionCode !== EXPECTED.androidVersionCode ||
      app.ios?.buildNumber !== EXPECTED.iosBuildNumber ||
      app.runtimeVersion?.policy !== EXPECTED.runtimePolicy) {
    throw new Error("MODO_MOBILE_RELEASE_IDENTIFIERS_DRIFT");
  }
  if (app.android?.usesCleartextTraffic === true ||
      app.ios?.infoPlist?.NSAppTransportSecurity?.NSAllowsArbitraryLoads === true ||
      app.ios?.infoPlist?.NSAppTransportSecurity?.NSAllowsArbitraryLoadsInWebContent === true) {
    throw new Error("MODO_MOBILE_INSECURE_TRANSPORT_CONFIG");
  }
  if (app.updates?.codeSigningCertificate || app.updates?.codeSigningMetadata ||
      app.updates?.url || app.updates?.enabled === true ||
      app.plugins?.some((p) =>
        p === "expo-updates" || (Array.isArray(p) && p[0] === "expo-updates"))) {
    throw new Error("MODO_MOBILE_NEW_OTA_SIGNING_SURFACE_REQUIRES_REVIEW");
  }
  const e = builds.production.env || {};
  if (e.EXPO_PUBLIC_API_URL !== "https://modo-api-3m10.onrender.com" ||
      app.extra?.apiUrl !== "https://modo-api-3m10.onrender.com" ||
      Object.keys(e).some(k => /SECRET|TOKEN|PASSWORD|PRIVATE_KEY|CERTIFICATE/i.test(k)) ||
      typeof easFile?.submit?.production?.android?.releaseStatus !== "string" ||
      easFile.submit.production.android.releaseStatus !== "draft") {
    throw new Error("MODO_MOBILE_RELEASE_ENVIRONMENT_DRIFT");
  }
  const report = {
    scope: "Static Expo/EAS config, not app binary or external EAS account",
    configurationStable: true,
    configuredSignedOtaUpdates: false,
    newRemoteUpdatesChannelConfigured: false,
    cleartextTransportOptIn: false,
    productionSubmissionStatus: "draft",
    installedNodeForgeAuditedAsSafe: false,
    nativeCryptoAndSigningAudited: false,
    mobileReleaseApproved: false,
  };
  return Object.freeze(report);
}

if (require.main === module) {
  try {
    const [appPath, easPath, output] = process.argv.slice(2);
    if (!appPath || !easPath || !output)
      throw new Error("MODO_MOBILE_SIGNING_CONFIG_ARGS_REQUIRED");
    const app = JSON.parse(fs.readFileSync(appPath, "utf8"));
    const eas = JSON.parse(fs.readFileSync(easPath, "utf8"));
    const report = inspectMobileSigningSurface(app, eas);
    fs.writeFileSync(output, JSON.stringify(report, null, 2) + "\n", { mode: 0o600 });
    process.stdout.write(JSON.stringify({
      configurationStable: report.configurationStable,
      mobileReleaseApproved: false,
      nativeCryptoAndSigningAudited: false,
    }) + "\n");
  } catch(error) { console.error(error); process.exitCode = 1; }
}

module.exports = { inspectMobileSigningSurface };
