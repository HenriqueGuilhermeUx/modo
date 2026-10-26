import { readFile, writeFile, readdir, stat } from "node:fs/promises";
import { resolve, relative, join } from "node:path";

const SEVERITIES = ["critical", "high", "moderate", "low", "info"];
const TYPES = Object.freeze({
  "@expo/cli": "build-and-development-toolchain",
  "@expo/code-signing-certificates": "development-and-signing-toolchain",
  "node-forge": "transitive-cryptography-in-toolchain",
  "expo": "application-framework-and-toolchain",
  "expo-router": "application-routing-framework",
  "zod": "unknown-requires-import-graph-review",
  "query-string": "unknown-requires-import-graph-review",
  "decode-uri-component": "unknown-requires-import-graph-review",
});

export function classifyMobileAudit(report) {
  if (!report || !report.metadata?.vulnerabilities ||
      !report.vulnerabilities || typeof report.vulnerabilities !== "object" ||
      Array.isArray(report.vulnerabilities)) {
    throw new Error("MODO_MOBILE_AUDIT_UNAVAILABLE");
  }
  const counts = {};
  for (const severity of SEVERITIES) {
    const value = report.metadata.vulnerabilities[severity];
    if (!Number.isInteger(value) || value < 0)
      throw new Error("MODO_MOBILE_AUDIT_BAD_COUNT");
    counts[severity] = value;
  }
  const total = SEVERITIES.reduce((sum, key) => sum + counts[key], 0);
  if (report.metadata.vulnerabilities.total !== total ||
      Object.keys(report.vulnerabilities).length !== total) {
    throw new Error("MODO_MOBILE_AUDIT_COUNT_MISMATCH");
  }
  const findings = Object.entries(report.vulnerabilities).map(([name, data]) => {
    if (!name || !data || !SEVERITIES.includes(data.severity))
      throw new Error("MODO_MOBILE_AUDIT_BAD_PACKAGE");
    return {
      name,
      severity: data.severity,
      category: TYPES[name] || "unreviewed-transitive",
      source: data.isDirect === true ? "direct" : "transitive",
      affectedRange: typeof data.range === "string" ? data.range.slice(0, 180) : null,
      fixAvailable: data.fixAvailable === false ? "no" :
        data.fixAvailable === true ? "npm-suggests" : "requires-compatibility-review",
      advisoryIds: [...new Set((Array.isArray(data.via) ? data.via : [])
        .filter(x => x && typeof x === "object")
        .flatMap(x => typeof x.url === "string" ?
          (x.url.match(/GHSA-[a-z0-9-]+/gi) || []) : []))].slice(0, 8),
    };
  }).sort((a,b) => SEVERITIES.indexOf(a.severity)-SEVERITIES.indexOf(b.severity) ||
    a.name.localeCompare(b.name));
  return {
    scope: "MODO Expo mobile isolated dependency tree",
    counts, findings,
    releaseBlocked: counts.critical + counts.high > 0,
    actualShippedBundleExposureVerified: false,
    safeToDowngradeExpo: false,
    patchedNodeForgeKnown: false,
    npmFixApplied: false,
    productionDeploymentModified: false,
    nextGate: "review source-map module graph, native app bundle, signing and advisories",
  };
}

export async function collectExportEvidence(root) {
  const result = { expoAndroidExportGenerated: false, fileCount: 0,
    sourceMapCount: 0, jsBundleCount: 0, potentialNodeForgePathHits: [],
    sourceMapsComplete: false, absenceProvesSafety: false };
  const resolved=resolve(root);
  let scanned=0;
  async function walk(dir) {
    if (++scanned > 2000) throw new Error("MODO_MOBILE_EXPORT_TOO_LARGE");
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const abs=join(dir,entry.name);
      if (entry.isDirectory()) {await walk(abs);continue;}
      if (!entry.isFile()) continue;
      const rel=relative(resolved,abs);
      result.fileCount++;
      if (rel.endsWith(".map")) {
        result.sourceMapCount++;
        const size=(await stat(abs)).size;
        if (size > 15_000_000) continue;
        try {
          const payload=JSON.parse(await readFile(abs, "utf8"));
          if (Array.isArray(payload.sources)) {
            for (const src of payload.sources) {
              if (src.includes("node-forge") || src.includes("@expo/code-signing-certificates")) {
                result.potentialNodeForgePathHits.push(src.slice(0,220));
              }
            }
          }
        } catch { /* malformed source map is not evidence of safety */ }
      }
      if (rel.endsWith(".js") || rel.endsWith(".hbc")) result.jsBundleCount++;
    }
  }
  await walk(resolved);
  result.expoAndroidExportGenerated = result.fileCount > 0 && result.jsBundleCount > 0;
  result.sourceMapsComplete = result.sourceMapCount > 0;
  result.potentialNodeForgePathHits=result.potentialNodeForgePathHits.slice(0,15);
  return result;
}

async function main() {
  if (process.env.GITHUB_ACTIONS !== "true" || process.argv.length !== 5)
    throw new Error("MODO_MOBILE_TRIAGE_CI_ONLY");
  const [input,exportDir,output]=process.argv.slice(2);
  if (!input.endsWith(".json") || !output.endsWith(".json") ||
      !resolve(output).startsWith(resolve(process.env.RUNNER_TEMP || "/unconfigured")+"/"))
    throw new Error("MODO_MOBILE_TRIAGE_INVALID_PATH");
  const audit=classifyMobileAudit(JSON.parse(await readFile(input,"utf8")));
  let bundle;
  try { bundle=await collectExportEvidence(exportDir); }
  catch(error){ bundle={expoAndroidExportGenerated:false,error:String(error)}; }
  const result={...audit,bundleEvidence:bundle,
    approvedForRelease:false,
    policy:"No production deployment based on this diagnostic."};
  await writeFile(output,JSON.stringify(result,null,2),{mode:0o600});
  console.log(JSON.stringify({counts:result.counts,releaseBlocked:result.releaseBlocked,
    exportReady:bundle.expoAndroidExportGenerated,
    potentialForgeBundlePaths:bundle.potentialNodeForgePathHits?.length||0,
    artifact:"modo-mobile-security-triage.json"}));
}

if (process.argv[1]?.endsWith("modo-mobile-security-triage.mjs")) {
  main().catch(error=>{console.error(error);process.exitCode=1;});
}
