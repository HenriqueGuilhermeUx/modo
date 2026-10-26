"use strict";

const fs = require("node:fs");

const severity = ["critical", "high", "moderate", "low", "info"];
const expected = [
  "@expo/cli",
  "@expo/code-signing-certificates",
  "expo",
  "node-forge",
  "zod",
  "decode-uri-component",
  "expo-router",
  "query-string",
];

function summarizeAudit(report) {
  if (!report || !report.metadata?.vulnerabilities ||
      !report.vulnerabilities || typeof report.vulnerabilities !== "object") {
    throw new Error("MODO_MOBILE_AUDIT_UNAVAILABLE");
  }
  const counts = Object.fromEntries(severity.map((level) => {
    const value = report.metadata.vulnerabilities[level];
    if (!Number.isInteger(value) || value < 0)
      throw new Error("MODO_MOBILE_INVALID_AUDIT_COUNTS");
    return [level, value];
  }));
  const packages = Object.entries(report.vulnerabilities)
    .map(([name, item]) => {
      if (!name || !severity.includes(item?.severity))
        throw new Error("MODO_MOBILE_INVALID_AUDIT_PACKAGE");
      const evidence = Array.isArray(item.via) ? item.via : [];
      return {
        name,
        severity: item.severity,
        direct: item.isDirect === true,
        affectedRange: typeof item.range === "string" ? item.range.slice(0,200) : null,
        advisoryIds: evidence.filter(v => v && typeof v === "object")
          .flatMap(v => String(v.url || "").match(/GHSA-[a-z0-9-]+/gi) || []).slice(0,12),
      };
    }).sort((a,b) => a.name.localeCompare(b.name));
  if (packages.length !== report.metadata.vulnerabilities.total ||
      Object.values(counts).reduce((a,b) => a+b,0) !== packages.length) {
    throw new Error("MODO_MOBILE_INCONSISTENT_AUDIT_COUNTS");
  }
  const releaseBlocking = packages.filter(p =>
    p.severity === "critical" || p.severity === "high");
  return {
    scope: "MODO mobile npm production dependency tree in isolated GitHub CI",
    status: releaseBlocking.length ? "BLOCKED" : "REVIEW_REQUIRED",
    counts,
    releaseBlocking,
    packages,
    packagesPreviouslyFlagged: expected.filter(name => packages.some(p => p.name === name)),
    // Absence from a dependency audit does not establish security of a built binary.
    shippedAppArtifactAnalyzed: false,
    exploitabilityConfirmed: false,
    automaticallyFixed: false,
    nodeForgeNoPatchedReleaseConfirmedByMaintainer: false,
  };
}

/**
 * Reports declared dependency parents only. This identifies where packages
 * enter the dependency tree, not which code is bundled into the user app.
 */
function declaredParents(lock, vulnerableNames) {
  if (!lock?.packages || !Array.isArray(vulnerableNames))
    throw new Error("MODO_MOBILE_INVALID_LOCK_GRAPH");
  const names = new Set(vulnerableNames);
  const parents = Object.fromEntries(vulnerableNames.map(name => [name, []]));
  for (const [path, entry] of Object.entries(lock.packages)) {
    const deps = entry?.dependencies || {};
    for (const [name, wanted] of Object.entries(deps)) {
      if (!names.has(name)) continue;
      const list = parents[name];
      if (list.length >= 35) continue;
      list.push({declaredBy: path || "(workspace root)",
        versionRange: String(wanted).slice(0,100)});
    }
  }
  return parents;
}

function verifyMobileSdk(lock, manifest) {
  const entries = lock?.packages;
  const installedExpo = entries?.["node_modules/expo"]?.version;
  const installedReactNative = entries?.["node_modules/react-native"]?.version;
  const installedReact = entries?.["node_modules/react"]?.version;
  if (!entries || !/^57[.]0[.][0-9]+$/.test(installedExpo || "") ||
      installedReactNative !== "0.86.3" ||
      installedReact !== "19.2.3" ||
      manifest.dependencies["react-native"] !== "0.86.3" ||
      manifest.dependencies.react !== "19.2.3" ||
      manifest.dependencies.expo !== "~57.0.31") {
    throw new Error("MODO_MOBILE_NATIVE_VERSION_DRIFT");
  }
  return { expo: installedExpo, reactNative: installedReactNative, react: installedReact };
}

function run() {
  const [auditFile, lockFile, mobileFile, outputFile] = process.argv.slice(2);
  if (!auditFile || !lockFile || !mobileFile || !outputFile)
    throw new Error("MODO_MOBILE_AUDIT_ARGS_REQUIRED");
  const audit = JSON.parse(fs.readFileSync(auditFile, "utf8"));
  const lock = JSON.parse(fs.readFileSync(lockFile, "utf8"));
  const pkg = JSON.parse(fs.readFileSync(mobileFile, "utf8"));
  const summary = {
    ...summarizeAudit(audit),
    installedVersions: verifyMobileSdk(lock, pkg),
    declaredDependencyParents: declaredParents(lock,
      Object.keys(audit.vulnerabilities)),
  };
  fs.writeFileSync(outputFile, JSON.stringify(summary,null,2)+"\n",{mode:0o600});
  console.log(JSON.stringify({status:summary.status,counts:summary.counts,
    versions:summary.installedVersions,report:"modo-mobile-security-report.json"}));
}

if (require.main === module) {
  try { run(); } catch(error) {
    console.error(error);process.exitCode=1;
  }
}
module.exports={summarizeAudit,verifyMobileSdk,declaredParents};
