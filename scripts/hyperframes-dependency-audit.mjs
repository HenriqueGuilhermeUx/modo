import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

async function main() {
  if (process.env.GITHUB_ACTIONS !== "true" || !process.argv[2])
    throw new Error("MODO_AUDIT_CI_ONLY");
  const path = process.argv[2];
  const report = JSON.parse(await readFile(path, "utf8"));
  const vulnerabilities = report.vulnerabilities || {};
  const summary = {
    provenance: "npm audit --json",
    appliesTo: "MODO repo isolated CI install, not a production system scan",
    vulnerabilities: Object.entries(vulnerabilities)
      .map(([name, detail]) => ({
        package: name,
        severity: detail.severity,
        isDirect: detail.isDirect === true,
        fixAvailable: detail.fixAvailable === true,
      }))
      .sort((a, b) => a.package.localeCompare(b.package)),
    counts: report.metadata?.vulnerabilities || null,
    automaticallyFixed: false,
    productionDependencyVersionsChanged: false,
  };
  const destination = join(dirname(path), "modo-audit-summary.json");
  await writeFile(destination, JSON.stringify(summary, null, 2), { mode: 0o600 });
  process.stdout.write(JSON.stringify({ counts: summary.counts,
    packagesFlagged: summary.vulnerabilities.length,
    report: "modo-audit-summary.json",
    remediation: "manual compatibility review required",
  }) + "\n");
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
