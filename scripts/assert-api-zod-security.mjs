import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";

const fromApi = createRequire(resolve("apps/api/package.json"));
const installed = fromApi("zod/package.json");
const requested = JSON.parse(readFileSync("apps/api/package.json", "utf8"));
if (requested.dependencies?.zod !== "4.6.7") {
  throw new Error("MODO_API_ZOD_MANIFEST_NOT_PINNED");
}
if (installed.version !== "4.6.7") {
  throw new Error("MODO_API_ZOD_VERSION_MISMATCH:" + installed.version);
}
if (!process.env.MODO_API_ZOD_AUDIT_FILE)
  throw new Error("MODO_API_ZOD_AUDIT_MISSING");
const audit = JSON.parse(readFileSync(process.env.MODO_API_ZOD_AUDIT_FILE, "utf8"));
if (audit.error || !audit.vulnerabilities ||
    !audit.metadata?.vulnerabilities || typeof audit.vulnerabilities !== "object") {
  throw new Error("MODO_API_ZOD_AUDIT_INVALID");
}
if (Object.hasOwn(audit.vulnerabilities, "zod")) {
  const finding = audit.vulnerabilities.zod;
  const nodes = Array.isArray(finding.nodes) ? finding.nodes : [];
  console.error("API_ZOD_AUDIT_DIAGNOSTIC", JSON.stringify({
    declaredAPI: requested.dependencies.zod,
    resolvedAPI: installed.version,
    vulnerableNodes: nodes.filter(n=>typeof n === "string").slice(0,30),
    affectedRange: typeof finding.range === "string" ? finding.range.slice(0,100) : null,
    viaPackages: (Array.isArray(finding.via)?finding.via:[])
      .filter(v=>typeof v === "string").slice(0,12),
  }));
  throw new Error("MODO_API_ZOD_ADVISORY_STILL_PRESENT");
}
console.log(JSON.stringify({
  status: "PASS", package: "zod", installedVersion: installed.version,
  securityScope: "api-runtime-dependencies",
  remainingHigh: audit.metadata.vulnerabilities.high,
  remainingCritical: audit.metadata.vulnerabilities.critical,
  otherVulnerabilitiesReviewed: false,
  released: false,
}));
