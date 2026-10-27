import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
const root = "apps/web/dist-usa";
const html = readFileSync(root + "/usa.html", "utf8");
assert.match(html, /noindex,nofollow/);
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
console.log("PASS: isolated US entry, four preview routes, no Brazil Root/PWA, no embedded Brazilian API");
