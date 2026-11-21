#!/usr/bin/env node
/**
 * Compare code-discovered tables against disposable CI PostgreSQL.
 * No production credentials, no customer-row reads, no writes.
 * A partial runtime schema is expected: service modules have different init paths.
 */
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import pg from "pg";

const connectionString = process.env.MODO_DELETION_TEST_DATABASE_URL;
if (!connectionString) throw new Error("Missing CI-only database URL");
const address = new URL(connectionString);
if (!["localhost", "127.0.0.1"].includes(address.hostname) || address.pathname !== "/modo_deletion_ci" || (address.port && address.port !== "5432")) {
  throw new Error("Refusing database outside isolated CI localhost/modo_deletion_ci");
}
const inventory = JSON.parse(readFileSync("tmp/modo-privacy-source-inventory.json", "utf8"));
if (!Array.isArray(inventory.discoveredModoTables) || inventory.discoveredModoTables.length === 0) throw new Error("No static inventory");
const client = new pg.Client({ connectionString, connectionTimeoutMillis: 3000 });
await client.connect();
try {
  await client.query("BEGIN READ ONLY");
  const result = await client.query(`SELECT tablename
    FROM pg_catalog.pg_tables
    WHERE schemaname = 'public' AND tablename LIKE 'modo\\_%' ESCAPE '\\'
    ORDER BY tablename`);
  await client.query("COMMIT");
  const runtime = result.rows.map(row => row.tablename).sort();
  const statics = inventory.discoveredModoTables;
  const unmatchedSource = statics.filter(name => !runtime.includes(name));
  const unmatchedDatabase = runtime.filter(name => !statics.includes(name));
  const overlap = statics.filter(name => runtime.includes(name));
  const critical = [
    "modo_users", "modo_organizations", "modo_memberships", "modo_sessions",
    "modo_account_deletion_requests", "modo_brands"
  ];
  const missingCritical = critical.filter(name => !runtime.includes(name));
  const tableDetail = new Map((inventory.tableReviewDetails ?? []).map(item => [item.table, item]));
  const missingModuleReviews = unmatchedSource.map(table => ({
    table,
    sourceEvidence: tableDetail.get(table)?.sourceFiles ?? [],
    inferredDomain: tableDetail.get(table)?.inferredDomain ?? "unclassified",
    mandatoryReview: tableDetail.get(table)?.mandatoryReview ?? "OWNER_AND_SCHEMA_REVIEW",
    reason: "Not initialized by this CI fixture; production absence NOT established",
    deletionAutomationAllowed: false,
  }));
  const report = {
    kind: "ephemeral_postgresql_schema_diff_not_production",
    containsCustomerRows: false, customerDataRead: false, deletionOperationsPerformed: false,
    connectedDatabase: "localhost/modo_deletion_ci",
    codeDiscoveredTableCount: statics.length, disposableDatabaseTableCount: runtime.length,
    matchedCount: overlap.length,
    sourceOnlyTables: unmatchedSource,
    sourceOnlyReviewDetails: missingModuleReviews,
    runtimeOnlyTables: unmatchedDatabase,
    missingCritical,
    fullyInitializedProductionEquivalent: false,
    automaticDeletionAllowed: false,
    limitations: [
      "Local CI initializes only services exercised in tests",
      "No production/staging corporate schema was queried",
      "Static code tables may be created by optional feature initialization",
      "External providers, retention and user/organization rights remain unverified",
    ],
  };
  const path = process.env.MODO_PRIVACY_SCHEMA_DIFF_PATH || "tmp/modo-privacy-ci-schema-diff.json";
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(report, null, 2) + "\n");
  console.log("CI_SCHEMA_DIFF " + JSON.stringify({
    static: statics.length, ephemeral: runtime.length, overlap: overlap.length,
    sourceOnly: unmatchedSource.length, runtimeOnly: unmatchedDatabase.length,
    missingCritical,
  }));
  if (missingCritical.length > 0) process.exitCode = 1;
} finally {
  await client.end();
}
