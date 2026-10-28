import { execFileSync } from "node:child_process";
import { renameSync, writeFileSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const dir = "apps/web/dist-smartbots-usa";
execFileSync("npm", ["exec", "--", "vite", "build", "--config", "vite.smartbots-usa.config.ts"], { cwd: "apps/web", stdio: "inherit" });
renameSync(join(dir, "smartbots-usa.html"), join(dir, "index.html"));
writeFileSync(join(dir, "_redirects"), "/ /index.html 200\n/demo /index.html 200\n/* /404.html 404\n");
writeFileSync(join(dir, "404.html"), '<!doctype html><html lang="en-US"><head><meta name="robots" content="noindex,nofollow"><title>Unavailable</title></head><body><h1>Page unavailable</h1><a href="/">SmartBots USA</a></body></html>');
writeFileSync(join(dir, "_headers"), [
  "/*", "  X-Robots-Tag: noindex, nofollow, noarchive",
  "  X-Content-Type-Options: nosniff",
  "  Referrer-Policy: no-referrer",
  "  X-Frame-Options: DENY",
  "  Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'none'; form-action 'none'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
  ""
].join("\n"));
const entry = readFileSync("apps/web/src/smartbots-usa-main.tsx", "utf8");
if (entry.includes('from "./Root"') || entry.includes("PwaChrome")) throw Error("Brazilian application code present in SmartBots entry");
if (!entry.includes('path === "/demo"')) throw Error("SmartBots demo route missing");
const assets = readdirSync(join(dir, "assets")).filter(name => name.endsWith(".js"));
if (!assets.length) throw Error("Missing SmartBots assets");
const bundle = assets.map(name => readFileSync(join(dir,"assets",name),"utf8")).join("\n");
for (const blocked of ["modo-api-3m10.onrender.com","WOOVI_APP_ID","SUPABASE_SERVICE_ROLE_KEY"]) {
  if (bundle.includes(blocked)) throw Error("Forbidden Brazilian reference: "+blocked);
}
console.log("PASS: isolated SmartBots USA package, strict path allowlist and zero Brazilian API references");
