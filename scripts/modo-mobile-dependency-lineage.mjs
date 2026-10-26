import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const ROOT = "apps/mobile";
const LIMIT = 25000;

function ancestors(path) {
  const result = [];
  let p = path;
  while (p) {
    result.push(p);
    const marker = p.lastIndexOf("/node_modules/");
    if (marker >= 0) {
      p = p.slice(0, marker);
      continue;
    }
    if (p.startsWith("node_modules/")) {
      p = "";
      continue;
    }
    const slash = p.lastIndexOf("/");
    p = slash < 0 ? "" : p.slice(0, slash);
  }
  result.push("");
  return result;
}

function resolvePackage(packages, origin, name) {
  for (const ancestor of ancestors(origin)) {
    const path = ancestor ? `${ancestor}/node_modules/${name}` : `node_modules/${name}`;
    if (Object.hasOwn(packages, path)) return path;
  }
  return null;
}

function nameOf(path) {
  const last = path.lastIndexOf("/node_modules/");
  return last >= 0 ? path.slice(last + "/node_modules/".length) :
    path.startsWith("node_modules/") ? path.slice("node_modules/".length) : path;
}

function versionOf(packages, path) {
  const pkg = packages[path];
  if (pkg?.link === true && typeof pkg.resolved === "string") {
    return packages[pkg.resolved]?.version || null;
  }
  return typeof pkg?.version === "string" ? pkg.version : null;
}

/**
 * Determine an installation path, not runtime reachability.
 * An Expo CLI dependency can be present in node_modules but absent from
 * the JS bundle and still affect a build/signing process.
 */
export function traceMobileAuditDependencyPaths(lock, audit) {
  const packages = lock?.packages;
  if (!lock || lock.lockfileVersion !== 3 || !packages ||
      !Object.hasOwn(packages, ROOT) ||
      !audit?.metadata?.vulnerabilities ||
      !audit.vulnerabilities || Array.isArray(audit.vulnerabilities)) {
    throw new Error("MODO_MOBILE_LINEAGE_INVALID_SOURCE");
  }
  const queue = [{ path: ROOT, route: [] }];
  const visited = new Set();
  const routes = new Map();
  while (queue.length) {
    if (visited.size > LIMIT) throw new Error("MODO_MOBILE_LINEAGE_TREE_TOO_LARGE");
    const current = queue.shift();
    if (visited.has(current.path)) continue;
    visited.add(current.path);
    let p = packages[current.path];
    if (!p || typeof p !== "object") throw new Error("MODO_MOBILE_LINEAGE_NODE_MISSING");
    if (p.link === true) {
      if (typeof p.resolved !== "string" || !packages[p.resolved])
        throw new Error("MODO_MOBILE_LINEAGE_LINK_UNRESOLVED");
      p = packages[p.resolved];
    }
    const name = nameOf(current.path);
    const label = `${name}@${versionOf(packages,current.path) || "unknown"}`;
    const chain = [...current.route, label];
    if (!routes.has(name)) routes.set(name, { chain, packagePath: current.path });
    const deps = {
      ...p.dependencies, ...p.optionalDependencies, ...p.peerDependencies,
    };
    for (const dep of Object.keys(deps).sort()) {
      const installed = resolvePackage(packages, current.path, dep);
      // Some optional peers are not installed; record no inference of safety.
      if (installed && !visited.has(installed))
        queue.push({ path: installed, route: chain });
    }
  }
  const findings = Object.entries(audit.vulnerabilities).map(([name, v]) => {
    const found = routes.get(name);
    return {
      package: name, severity: v.severity,
      installedPackagePath: found?.packagePath || null,
      shortestPath: found?.chain || [],
      installedVersion: found ?
        versionOf(packages, found.packagePath) : null,
      advisoryIds: [...new Set((Array.isArray(v.via) ? v.via : [])
        .filter(a=>a && typeof a==="object" && typeof a.url==="string")
        .flatMap(a=>a.url.match(/GHSA-[a-z0-9-]+/gi) || []))].slice(0,8),
      graphResolution: found ? "resolved" : "requires-manual-review",
    };
  }).sort((a,b)=>a.package.localeCompare(b.package));
  return {
    origin: "Expo mobile workspace package-lock v3",
    scannedInstalledPackages: visited.size,
    findings,
    unresolved: findings.filter(x=>x.graphResolution!=="resolved").map(x=>x.package),
    releaseBlocked: (audit.metadata.vulnerabilities.high || 0) +
      (audit.metadata.vulnerabilities.critical || 0) > 0,
    notProofOfShippedBundleReachability: true,
    safeToSignOrPublish: false,
    noPackageUpdatesApplied: true,
  };
}

async function main() {
  if (process.env.GITHUB_ACTIONS !== "true" || process.argv.length !== 5)
    throw new Error("MODO_MOBILE_LINEAGE_CI_ONLY");
  const [lockFile, auditFile, output] = process.argv.slice(2);
  if (!resolve(output).startsWith(resolve(process.env.RUNNER_TEMP || "/invalid")+ "/") ||
      !output.endsWith(".json")) throw new Error("MODO_MOBILE_LINEAGE_BAD_OUTPUT");
  const lock = JSON.parse(await readFile(lockFile,"utf8"));
  const audit = JSON.parse(await readFile(auditFile,"utf8"));
  const result = traceMobileAuditDependencyPaths(lock,audit);
  await writeFile(output,JSON.stringify(result,null,2),{mode:0o600});
  console.log(JSON.stringify({
    installedPackagesScanned:result.scannedInstalledPackages,
    findings:result.findings.map(({package:p,shortestPath})=>({package:p,shortestPath})),
    unresolved:result.unresolved,
    releaseBlocked:result.releaseBlocked,
  }));
}
if(process.argv[1]?.endsWith("modo-mobile-dependency-lineage.mjs"))
  main().catch(e=>{console.error(e);process.exitCode=1;});
