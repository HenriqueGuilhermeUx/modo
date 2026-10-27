import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";

const root = "apps/web/dist-usa";
const html = readFileSync(root + "/index.html", "utf8");
assert.match(html, /noindex,nofollow/);

const topLevel = readdirSync(root).sort();
assert.deepEqual(topLevel, ["404.html", "_headers", "_redirects", "assets", "index.html", "logo.svg"].sort(),
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
console.log("PASS: isolated US-only bundle, route allowlist + 404, CSP blocks API/forms, no Brazil Root/PWA");
