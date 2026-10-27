import { execFileSync } from "node:child_process";
import { renameSync, writeFileSync, copyFileSync } from "node:fs";
execFileSync("npm", ["exec", "--", "vite", "build", "--config", "vite.usa.config.ts"], { cwd: "apps/web", stdio: "inherit" });
renameSync("apps/web/dist-usa/usa.html", "apps/web/dist-usa/index.html");
copyFileSync("apps/web/public/logo.svg", "apps/web/dist-usa/logo.svg");
writeFileSync("apps/web/dist-usa/_redirects", "/ /index.html 200\n/us /index.html 200\n/us/smartbots /index.html 200\n/us/demo /index.html 200\n/us/smartbots/demo /index.html 200\n");
execFileSync(process.execPath, ["scripts/usa-netlify-isolation-check.mjs"], { stdio: "inherit" });
