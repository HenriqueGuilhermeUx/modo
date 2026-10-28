import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { join, relative } from "node:path";

const root = "apps/web/dist-usa";
// Fail closed if the dedicated Netlify package configuration is accidentally
// changed back to the Brazilian default. This is an offline source guard;
// Netlify project package-directory settings still require independent review.
const siteConfig = readFileSync("deploy/netlify/modo/netlify.toml", "utf8");
assert.match(siteConfig, /publish\s*=\s*"apps\/web\/dist-usa"/,
  "USA Netlify config must publish only dist-usa");
assert.match(siteConfig, /command\s*=\s*"[^"\n]*scripts\/build-usa-netlify\.mjs"/,
  "USA Netlify config must run the isolated USA builder");
for (const forbidden of ["VITE_API_URL", "modo-api-3m10.onrender.com", 'publish = "apps/web/dist"', 'to = "/index.html"']) {
  assert.ok(!siteConfig.includes(forbidden), "Brazilian Netlify setting in USA config: " + forbidden);
}
const html = readFileSync(root + "/index.html", "utf8");
assert.match(html, /noindex,nofollow/);

const topLevel = readdirSync(root).sort();
assert.deepEqual(topLevel, ["404.html", "_headers", "_redirects", "assets", "index.html", "logo.svg", "usa-artifact-provenance.json"].sort(),
  "USA publish directory must not contain Brazilian routes, PWA, functions or extra files");

const redirects = readFileSync(root + "/_redirects", "utf8").trim().split(/\r?\n/);
assert.deepEqual(redirects, [
  "/ /index.html 200",
  "/us /index.html 200",
  "/us/smartbots /index.html 200",
  "/us/demo /index.html 200",
  "/us/smartbots/demo /index.html 200",
  "/* /404.html 404",
], "Only the four US routes and the root may serve the USA app; all other routes must 404");

const unavailable = readFileSync(root + "/404.html", "utf8");
assert.match(unavailable, /Page unavailable/);
assert.match(unavailable, /noindex,nofollow/);
assert.ok(!unavailable.includes("https://"), "404 must not link to any external service");

const headers = readFileSync(root + "/_headers", "utf8");
for (const required of [
  "/*",
  "X-Robots-Tag: noindex, nofollow, noarchive",
  "X-Content-Type-Options: nosniff",
  "Referrer-Policy: no-referrer",
  "X-Frame-Options: DENY",
  "Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=()",
  "default-src 'self'",
  "script-src 'self'",
  "connect-src 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
]) assert.ok(headers.includes(required), "Missing USA-only security header: " + required);

const assets = readdirSync(root + "/assets").filter(x => x.endsWith(".js"));
assert.ok(assets.length > 0, "No USA JavaScript bundle");
const bundle = assets.map(x => readFileSync(root + "/assets/" + x, "utf8")).join("\n");
for (const forbidden of ["modo-api-3m10.onrender.com", "WOOVI_APP_ID", "NEXTGEN_FINANCIAL", "SUPABASE_SERVICE_ROLE_KEY"]) {
  assert.ok(!bundle.includes(forbidden), "Forbidden reference in USA bundle: " + forbidden);
}
const entry = readFileSync("apps/web/src/usa-main.tsx", "utf8");
for (const route of ["/us", "/us/smartbots", "/us/demo", "/us/smartbots/demo"]) {
  assert.ok(entry.includes('"' + route + '"'), "Missing US route " + route);
}
assert.ok(!entry.includes('from "./Root"'), "USA must not load Brazilian Root");
assert.ok(!entry.includes("PwaChrome"), "USA must not register Brazilian PWA");
const landing = readFileSync("apps/web/src/UsLanding.tsx", "utf8");
assert.ok(!landing.includes("https://alternativeventures.com.br/"),
  "USA demo must not navigate to the Brazilian institutional site");
const provenance = JSON.parse(readFileSync(root + "/usa-artifact-provenance.json", "utf8"));
assert.equal(provenance.schemaVersion, 1);
assert.equal(provenance.kind, "build-artifact-only", "A build artifact must not claim to be deployed");
assert.equal(provenance.sourceRepo, "HenriqueGuilhermeUx/modo");
assert.equal(provenance.targetNetlifySiteId, "241772f0-7d68-4ff3-a20d-aeac9bcbb3f8");
assert.equal(provenance.publishDirectory, root);
assert.match(provenance.sourceCommit, /^[a-f0-9]{40}$/);
assert.equal(provenance.sourceCommit, execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
  "Manifest must identify the exact checked-out commit");
function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return walk(full);
    assert.ok(entry.isFile(), "No symlinks or special files allowed in USA artifact");
    return [relative(root, full)];
  });
}
const artifactFiles = walk(root).filter(path => path !== "usa-artifact-provenance.json").sort();
assert.deepEqual(provenance.files.map(file => file.path), artifactFiles,
  "Manifest must list every publish file exactly once in sorted order");
for (const file of provenance.files) {
  assert.match(file.sha256, /^[a-f0-9]{64}$/);
  assert.equal(file.sha256, createHash("sha256").update(readFileSync(join(root, file.path))).digest("hex"),
    "USA artifact hash mismatch: " + file.path);
}
console.log("PASS: isolated US-only bundle, route allowlist + 404, CSP blocks API/forms, no Brazil Root/PWA");
