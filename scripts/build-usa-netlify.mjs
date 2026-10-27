import { execFileSync } from "node:child_process";
import { renameSync, writeFileSync, copyFileSync, readdirSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, relative } from "node:path";

// Build only the synthetic USA entry; never publish the Brazilian app or PWA.
execFileSync("npm", ["exec", "--", "vite", "build", "--config", "vite.usa.config.ts"], { cwd: "apps/web", stdio: "inherit" });
renameSync("apps/web/dist-usa/usa.html", "apps/web/dist-usa/index.html");
copyFileSync("apps/web/public/logo.svg", "apps/web/dist-usa/logo.svg");

// Netlify _redirects take precedence over the Brazilian root netlify.toml.
// Explicit allowlist, then a real HTTP 404 for every other route.
writeFileSync("apps/web/dist-usa/_redirects", [
  "/ /index.html 200",
  "/us /index.html 200",
  "/us/smartbots /index.html 200",
  "/us/demo /index.html 200",
  "/us/smartbots/demo /index.html 200",
  "/* /404.html 404",
  "",
].join("\n"));
writeFileSync("apps/web/dist-usa/404.html", [
  '<!doctype html><html lang="en-US"><head><meta charset="utf-8">',
  '<meta name="viewport" content="width=device-width,initial-scale=1">',
  '<meta name="robots" content="noindex,nofollow">',
  '<title>Unavailable | Alternative Ventures USA preview</title></head>',
  '<body><main><h1>Page unavailable</h1>',
  '<p>This preview does not provide accounts, billing, APIs or Brazilian application routes.</p>',
  '<a href="/us">Return to the USA preview</a></main></body></html>',
].join(""));

// Publish only with the isolated dist-usa artifact. This policy is deliberately
// not placed in the Brazilian root Netlify configuration.
writeFileSync("apps/web/dist-usa/_headers", [
  "/*",
  "  X-Robots-Tag: noindex, nofollow, noarchive",
  "  X-Content-Type-Options: nosniff",
  "  Referrer-Policy: no-referrer",
  "  X-Frame-Options: DENY",
  "  Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=()",
  "  Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'none'; form-action 'none'; object-src 'none'; base-uri 'none'; frame-src 'none'; frame-ancestors 'none'",
  "",
].join("\n"));
// Build provenance is NOT proof of deployment. It binds the offline package to
// the exact Git checkout and allows a reviewer to detect modified upload files.
const publishDir = "apps/web/dist-usa";
function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return walk(full);
    if (!entry.isFile()) throw new Error("Unexpected USA artifact entry: " + full);
    return [relative(publishDir, full).replaceAll("\\\\", "/")];
  });
}
const paths = walk(publishDir).sort();
const files = paths.map(path => ({
  path,
  sha256: createHash("sha256").update(readFileSync(join(publishDir, path))).digest("hex"),
}));
const sourceCommit = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
writeFileSync(join(publishDir, "usa-artifact-provenance.json"), JSON.stringify({
  schemaVersion: 1,
  kind: "build-artifact-only",
  sourceRepo: "HenriqueGuilhermeUx/modo",
  sourceCommit,
  targetNetlifySiteId: "241772f0-7d68-4ff3-a20d-aeac9bcbb3f8",
  publishDirectory: "apps/web/dist-usa",
  files,
}, null, 2) + "\\n");
execFileSync(process.execPath, ["scripts/usa-netlify-isolation-check.mjs"], { stdio: "inherit" });
