/** US-preview static regression contract. No network or environment secrets. */
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (path) => readFileSync(resolve(projectRoot, path), "utf8");
const entry = read("apps/web/src/Root.tsx");
const preview = read("apps/web/src/UsLanding.tsx");
const css = read("apps/web/src/UsLanding.css");

assert.ok(entry.includes("USPreview") || entry.includes("UsLanding"), "US preview must be mounted explicitly");
assert.ok(entry.includes("/us/smartbots"), "Expected existing route or US gate: /us/smartbots");
assert.ok(entry.includes("/smartbots.html"), "Expected existing route or US gate: /smartbots.html");
assert.ok(entry.includes("/us"), "US preview must have an isolated route");
assert.ok(preview.includes("en-US"), "US preview must set document language");
assert.ok(preview.includes("Alternative Ventures"), "US brand attribution missing");
assert.match(preview, /preview/i, "US preview must identify non-live scope");
assert.match(preview, /checkout/i, "US preview must explicitly block unauthorized US commerce");
assert.ok(!/href=["']\/(app|login|cadastro|criar-conta)/i.test(preview), "US preview must not link directly to Brazilian signup");
assert.ok(!/fetch\s*\(/.test(preview), "US preview must not call Brazilian backend APIs");
assert.ok(css.includes(".av-us-landing"), "Styles must use a US-specific namespace");
assert.ok(!/^\s*(body|html|:root|\*)\s*\{/m.test(css), "US preview styles must not redefine global selectors");

const operational = read("apps/web/src/USWorkspace.tsx");
assert.ok(operational.includes("Local interactive demonstration"), "USWorkspace.tsx expected capability missing: Local interactive demonstration");
assert.ok(operational.includes("en-US"), "USWorkspace.tsx expected capability missing: en-US");
assert.ok(operational.includes("Copy draft reply"), "USWorkspace.tsx expected capability missing: Copy draft reply");
assert.ok(operational.includes("Build sample plan"), "USWorkspace.tsx expected capability missing: Build sample plan");
assert.ok(!/(fetch|XMLHttpRequest)\s*\(/.test(operational), "Operational US preview must not call backend APIs");
assert.ok(!/localStorage\s*\.|sessionStorage\s*\./.test(operational), "Demo should not persist potentially identifying visitor input");
assert.ok(!/href=["']\/(app|login|cadastro|criar-conta)/i.test(operational), "Demo must not send visitors to Brazilian account activation");


const workspace = read("apps/web/src/UsWorkspace.tsx");
assert.ok(entry.includes("/us/workspace"), "English workspace route missing");
assert.ok(preview.includes('href="/us/workspace"'), "Preview must link to interactive walkthrough");
assert.match(workspace, /initialTasks/, "Walkthrough must use sample data");
assert.match(workspace, /setTasks/, "Demo task state missing");
assert.ok(!/fetch\s*\(/.test(workspace), "Demo must never send data to Brazil APIs");
assert.ok(!/localStorage|sessionStorage|submitSmartBotsIntake/.test(workspace), "Demo data must stay in memory");

console.log("PASS: modo US preview route, language, copy, branding, isolation and CSS namespace");
