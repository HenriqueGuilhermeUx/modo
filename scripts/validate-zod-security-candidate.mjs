import { readFileSync } from "node:fs";

const file = process.argv[2];
if (!file || process.env.GITHUB_ACTIONS !== "true") {
  throw new Error("MODO_ZOD_CI_INPUT_REQUIRED");
}

const report = JSON.parse(readFileSync(file, "utf8"));
if (!report?.metadata?.vulnerabilities ||
    !report.vulnerabilities ||
    typeof report.vulnerabilities !== "object" ||
    Array.isArray(report.vulnerabilities)) {
  throw new Error("MODO_ZOD_AUDIT_INCOMPLETE");
}
const zod = report.vulnerabilities.zod;
if (zod) {
  const refs = (Array.isArray(zod.via) ? zod.via : [])
    .map((v) => typeof v === "object" && v !== null ? v.url || v.title : v)
    .filter(Boolean);
  throw new Error("MODO_ZOD_CANDIDATE_STILL_VULNERABLE: " +
    refs.map(v => String(v).slice(0, 90)).join(" | "));
}
const count = report.metadata.vulnerabilities;
for (const name of ["critical","high","moderate","low","info","total"]) {
  if (!Number.isInteger(count[name]) || count[name] < 0)
    throw new Error("MODO_ZOD_AUDIT_INVALID_COUNT");
}
const pkg = JSON.parse(readFileSync("node_modules/zod/package.json", "utf8"));
if (pkg.version !== "4.6.6") {
  throw new Error("MODO_ZOD_RESOLVED_VERSION_MISMATCH: " + pkg.version);
}
process.stdout.write(JSON.stringify({
  status: "candidate-only",
  directZodVersion: pkg.version,
  apiZodFindingRemoved: true,
  remainingApiAudit: {critical:count.critical,high:count.high,moderate:count.moderate},
  noMergeOrDeploy: true,
}) + "\n");
