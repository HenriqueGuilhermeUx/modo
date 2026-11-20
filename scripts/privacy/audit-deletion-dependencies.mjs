#!/usr/bin/env node
/**
 * Static privacy dependency discovery for human review, never a deletion plan.
 * Reads tracked source files only; no database, credentials or network access.
 * Output lists schema and integration identifiers, not personal data.
 */
import { execFileSync } from "node:child_process";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

const paths = execFileSync("git", ["ls-files", "apps/api/src", "apps/web/src", "apps/mobile"], { encoding: "utf8" })
  .split("\n").filter(p => /\.(ts|tsx|js|mjs|sql)$/.test(p) && !/\.test\.|__snapshots__|node_modules/.test(p));
const tableNames = new Set();
const foreignKeys = new Set();
const sourcesByTable = new Map();
const linkedDomains = [];
const patterns = [
  [/\b(woovi|openpix|payment|subscription|billing)\b/i, "payments"],
  [/\b(instagram|linkedin|oauth|metricool|canva|postiz)\b/i, "social_or_creative_providers"],
  [/\b(storage|s3|asset|upload|media|video|blob)\b/i, "storage_and_media"],
  [/\b(webhook|n8n|render|netlify|smartbots)\b/i, "external_delivery_or_operations"],
  [/\b(google.ads|openai|apify|scrapling)\b/i, "external_analytics_or_ai"],
];
const categories = Object.fromEntries(patterns.map(([, label]) => [label, []]));
for (const path of paths) {
  const src = readFileSync(path, "utf8");
  for (const match of src.matchAll(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:public\.)?([a-z][a-z0-9_]*)/gi)) {
    if (match[1].startsWith("modo_")) {
      tableNames.add(match[1]);
      const found = sourcesByTable.get(match[1]) || new Set();
      found.add(path);
      sourcesByTable.set(match[1], found);
    }
  }
  for (const match of src.matchAll(/REFERENCES\s+(?:public\.)?([a-z][a-z0-9_]*)/gi)) {
    if (match[1].startsWith("modo_")) foreignKeys.add(match[1]);
  }
  for (const [pattern, label] of patterns) {
    if (pattern.test(path) || (path.startsWith("apps/api/src/") && pattern.test(src))) {
      categories[label].push(path);
    }
  }
}
const required = [
  "modo_users", "modo_organizations", "modo_memberships", "modo_sessions",
  "modo_brands", "modo_account_deletion_requests",
  "modo_subscriptions", "modo_credit_ledger", "modo_content_requests",
  "modo_content_assets", "modo_activation_events",
];
const discovered = [...tableNames].sort();
// Heuristics are NOT legal retention decisions and never authorize automatic erasure.
const rules = [
  [/audit|log|security|fraud|compliance|incident/i, "security_audit", "SECURITY_AND_LEGAL_REVIEW"],
  [/payment|transaction|subscription|invoice|credit|ledger|billing|checkout|discount|charge|woovi/i, "financial", "FINANCE_AND_RETENTION_REVIEW"],
  [/organization|membership|team|invitation|staff|user|session|auth|profile/i, "identity_or_access", "SHARED_ORGANIZATION_REVIEW"],
  [/oauth|token|instagram|linkedin|canva|social|publisher|smartbots|integration/i, "external_integration", "PROVIDER_AND_TOKEN_REVOCATION_REVIEW"],
  [/asset|media|video|file|content|creative|upload/i, "content_or_media", "REMOTE_ASSET_AND_RIGHTS_REVIEW"],
  [/lead|diagnostic|intelligence|analytics|tracking|activation|event/i, "analytics_and_leads", "LAWFUL_BASIS_AND_RETENTION_REVIEW"],
];
const tableRows = discovered.map(table => {
  const match = rules.find(([regex]) => regex.test(table));
  return {
    table,
    inferredDomain: match?.[1] || "unclassified",
    mandatoryReview: match?.[2] || "OWNER_AND_SCHEMA_REVIEW",
    sourceFiles: [...(sourcesByTable.get(table) || [])].sort().join(";"),
    action: "REVIEW_REQUIRED",
    retentionPeriod: "UNDETERMINED",
    lawfulBasis: "UNDETERMINED",
    externalProcessorVerified: "NO",
    sharedOrganizationSafe: "UNVERIFIED",
    deletionAutomationAllowed: "NO",
  };
});
const toCsv = cells => cells.map(value => {
  const str = String(value ?? "");
  return /[",\r\n]/.test(str) ? '"' + str.replaceAll('"','""') + '"' : str;
}).join(",");
const csvFile = process.env.MODO_PRIVACY_MATRIX_PATH || "tmp/modo-privacy-table-review-matrix.csv";
mkdirSync(dirname(csvFile), { recursive: true });
const columns = ["table","inferredDomain","mandatoryReview","sourceFiles","action","retentionPeriod","lawfulBasis","externalProcessorVerified","sharedOrganizationSafe","deletionAutomationAllowed"];
writeFileSync(csvFile,[toCsv(columns), ...tableRows.map(row => toCsv(columns.map(col => row[col])))].join("\n")+"\n");
if (tableRows.length !== discovered.length || tableRows.some(r => r.action !== "REVIEW_REQUIRED" || r.deletionAutomationAllowed !== "NO" || r.retentionPeriod !== "UNDETERMINED")) {
  throw new Error("Privacy safety gate: inventory matrix is incomplete or claims approval prematurely");
}
const report = {
  kind: "static_code_inventory_not_a_deletion_plan",
  includesCustomerData: false,
  completedDataInventory: false,
  safeToDeleteAutomatically: false,
  generatedAt: new Date().toISOString(),
  trackedSourceFilesScanned: paths.length,
  discoveredModoTables: discovered,
  tableReviewMatrixPath: csvFile,
  tableReviewRows: tableRows.length,
  tableReviewCompleted: false,
  referencedModoTables: [...foreignKeys].sort(),
  knownCriticalTablesMissingFromScan: required.filter(x => !tableNames.has(x)),
  externalIntegrationSourceFiles: Object.fromEntries(
    Object.entries(categories).map(([k, v]) => [k, [...new Set(v)].slice(0, 45)]),
  ),
  blockers: [
    "Source code scanning does not prove actual database schema, untracked files or external processors",
    "Shared organizations, payment/credit ledger and statutory retention require human review",
    "OAuth/provider tokens, external assets, AI providers and backups are not inventoried completely",
    "No data should be deleted or request marked completed from this report",
  ],
};
const dest = process.env.MODO_PRIVACY_REPORT_PATH || "tmp/modo-privacy-source-inventory.json";
mkdirSync(dirname(dest), { recursive: true });
writeFileSync(dest, JSON.stringify(report, null, 2) + "\n");
console.log("Privacy static audit", JSON.stringify({
  scanned: paths.length, tables: discovered.length, missingKnown: report.knownCriticalTablesMissingFromScan,
  integrations: Object.fromEntries(Object.entries(report.externalIntegrationSourceFiles).map(([k,v])=>[k,v.length])),
}));
console.log("REPORT: " + dest);
console.log("MATRIX: " + csvFile + " (all tables require individual review)");
console.log("BLOCKED: not a complete data inventory; automatic deletion forbidden");
if (report.knownCriticalTablesMissingFromScan.length) process.exitCode = 1;
