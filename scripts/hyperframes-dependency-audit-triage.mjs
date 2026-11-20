import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

const labels = Object.freeze({
  all: "Monorepo completo (inclui dev/teste)",
  api: "API de vídeo (dependências de execução)",
  web: "Web (dependências de execução)",
  mobile: "Mobile (dependências de execução)",
});
const severities = ["critical", "high", "moderate", "low", "info"];

export function summarizeAudit(input, scope) {
  if (!Object.hasOwn(labels, scope) ||
      !input || !input.metadata || !input.metadata.vulnerabilities ||
      !input.vulnerabilities || typeof input.vulnerabilities !== "object" ||
      Array.isArray(input.vulnerabilities)) {
    throw new Error("MODO_AUDIT_REPORT_INVALID");
  }
  const counts = {};
  for (const level of severities) {
    const count = input.metadata.vulnerabilities[level];
    if (!Number.isInteger(count) || count < 0) throw new Error("MODO_AUDIT_COUNT_INVALID");
    counts[level] = count;
  }
  if (input.metadata.vulnerabilities.total !== severities.reduce((n,k)=>n+counts[k],0))
    throw new Error("MODO_AUDIT_COUNT_MISMATCH");
  const entries = Object.entries(input.vulnerabilities).map(([name, item]) => {
    if (!name || !item || !severities.includes(item.severity))
      throw new Error("MODO_AUDIT_PACKAGE_INVALID");
    return {
      package: name,
      severity: item.severity,
      direct: item.isDirect === true,
      // npm's fixAvailable can be an object, including breaking upgrades:
      // never pretend a "fix" is a compatible upgrade.
      fixAvailable: item.fixAvailable === false ? "not_reported" :
        item.fixAvailable === true ? "npm_suggests" : "requires_review",
      affectedRange: typeof item.range === "string" && item.range.length < 160 ?
        item.range : null,
      suggestedVersion: item.fixAvailable && typeof item.fixAvailable === "object" &&
        item.fixAvailable.name === name && typeof item.fixAvailable.version === "string" &&
        /^[0-9a-zA-Z.+-]{1,40}$/.test(item.fixAvailable.version)
          ? { version: item.fixAvailable.version,
              semverMajor: item.fixAvailable.isSemVerMajor === true } : null,
      advisories: (Array.isArray(item.via) ? item.via : [])
        .filter(v=>v && typeof v === "object")
        .map(v=>{
          const link = typeof v.url === "string" &&
            /^https:\/\/(?:github.com\/advisories\/GHSA-[a-z0-9-]+|github.com\/.*\/security\/advisories\/GHSA-[a-z0-9-]+|www.npmjs.com\/advisories\/[0-9]+)$/i.test(v.url)
            ? v.url : null;
          return {
            advisoryId: link?.match(/GHSA-[a-z0-9-]+/i)?.[0] ||
              (Number.isInteger(v.source) ? String(v.source) : null),
            url: link,
            title: typeof v.title === "string" ? v.title.slice(0,160) : null,
            vulnerableRange: typeof v.range === "string" ? v.range.slice(0,100) : null,
          };
        }).slice(0,12),
    };
  }).sort((a,b)=>
    severities.indexOf(a.severity)-severities.indexOf(b.severity) ||
    a.package.localeCompare(b.package));
  if (entries.length !== input.metadata.vulnerabilities.total)
    throw new Error("MODO_AUDIT_PACKAGES_MISMATCH");
  return { scope, label: labels[scope], counts, packages: entries };
}

export function buildTriage(reports) {
  if (reports.length !== 4 || reports.some(r=>!r?.scope))
    throw new Error("MODO_AUDIT_SCOPES_MISSING");
  const byScope=Object.fromEntries(reports.map(r=>[r.scope,r]));
  if(Object.keys(byScope).length!==4 || Object.keys(labels).some(k=>!byScope[k]))
    throw new Error("MODO_AUDIT_SCOPES_DUPLICATED");
  const releaseBlocking = ["api","web","mobile"].flatMap(scope=>
    byScope[scope].packages.filter(p=>["critical","high"].includes(p.severity))
      .map(p=>({scope,package:p.package,severity:p.severity})));
  const monorepoCritical = byScope.all.packages.filter(p=>p.severity==="critical");
  const productionCritical = ["api","web","mobile"].flatMap(scope=>
    byScope[scope].packages.filter(p=>p.severity==="critical")
      .map(p=>({scope,package:p.package})));
  return {
    generatedFor: "manual-review-only",
    productionRuntimeReleaseBlocked: releaseBlocking.length>0,
    // This is dependency categorization, not proof that each vulnerability is exploitable.
    releaseBlockers: releaseBlocking,
    criticalDevOnlyCandidates: monorepoCritical
      .filter(p=>!productionCritical.some(x=>x.package===p.package))
      .map(p=>p.package),
    audits: byScope,
    dependencyVersionsModified: false,
    automaticFixApplied: false,
    requiresManualAdvisoryAndReachabilityReview: true,
  };
}

export function triageMarkdown(triage) {
  const names = ["all","api","web","mobile"];
  const lines=[
    "# MODO dependency audit — isolated CI, no dependency changes",
    "",
    "A finding here is not proof of an exploitable production path. Test tooling",
    "and deployed runtime dependencies must be reviewed separately.",
    "",
    "| Scope | Critical | High | Moderate | Low | Total |",
    "|---|---:|---:|---:|---:|---:|",
    ...names.map(n=>{
      const c=triage.audits[n].counts;
      return `| ${n} | ${c.critical} | ${c.high} | ${c.moderate} | ${c.low} | ${c.critical+c.high+c.moderate+c.low+c.info} |`;
    }),
    "",
    `**Runtime dependency release blockers:** ${triage.releaseBlockers.length}`,
    `**Release readiness:** ${triage.productionRuntimeReleaseBlocked?"BLOCKED — review runtime high/critical advisories":"not blocked by runtime high/critical audit results; still requires manual security review"}`,
    "",
    "## Runtime findings to triage manually",
    "",
    ...triage.releaseBlockers.map(x=>`- ${x.scope} / ${x.severity}: \`${x.package}\``),
    "",
    "## Critical development-only candidates (not verified absent from deployment)",
    "",
    ...triage.criticalDevOnlyCandidates.map(n=>`- \`${n}\``),
    "",
    "No npm audit fix, package upgrades, production deploy, branch merge,",
    "or user-data access was performed. Manual audit the actual deployed",
    "server bundle/container, fix paths, exploitability and rollout gates.",
    "",
  ];
  return lines.join("\n");
}

async function main() {
  if (process.env.GITHUB_ACTIONS !== "true" || process.argv.length !== 6)
    throw new Error("MODO_AUDIT_SCOPED_CI_ONLY");
  const files=process.argv.slice(2);
  const scopes=["all","api","web","mobile"];
  const reports=[];
  for(let i=0;i<files.length;i++){
    const file=files[i];
    if(!file.endsWith(".json"))throw new Error("MODO_AUDIT_INVALID_PATH");
    const input=JSON.parse(await readFile(file,"utf8"));
    reports.push(summarizeAudit(input,scopes[i]));
  }
  const triage=buildTriage(reports);
  const outdir=dirname(files[0]);
  const json=join(outdir,"modo-audit-scoped-triage.json");
  const md=join(outdir,"modo-audit-scoped-triage.md");
  await writeFile(json,JSON.stringify(triage,null,2),{mode:0o600});
  await writeFile(md,triageMarkdown(triage),{mode:0o600});
  if(process.env.GITHUB_STEP_SUMMARY)
    await writeFile(process.env.GITHUB_STEP_SUMMARY,triageMarkdown(triage),{flag:"a"});
  process.stdout.write(JSON.stringify({
    runtimeBlockers:triage.releaseBlockers.length,
    criticalDevOnlyCandidates:triage.criticalDevOnlyCandidates,
    productionRuntimeReleaseBlocked:triage.productionRuntimeReleaseBlocked,
    report:"modo-audit-scoped-triage.json",
  })+"\n");
}

if(process.argv[1]?.endsWith("hyperframes-dependency-audit-triage.mjs"))
  main().catch(error=>{console.error(error);process.exitCode=1;});
