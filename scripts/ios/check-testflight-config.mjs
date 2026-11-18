#!/usr/bin/env node
// Read-only pre-TestFlight manifest check. Never authenticates with Apple/EAS.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const base = join(process.cwd(), 'apps/mobile');
const app = JSON.parse(readFileSync(join(base, 'app.json'), 'utf8')).expo;
const eas = JSON.parse(readFileSync(join(base, 'eas.json'), 'utf8'));
const issues = [];
const info = [];
function assert(condition, message) { if (!condition) issues.push(message); }
function isHttps(value) {
  try { const url = new URL(value); return url.protocol === 'https:' && !!url.hostname; }
  catch { return false; }
}
assert(app?.ios?.bundleIdentifier === 'br.com.alternativeventures.modo',
  'Mismatch in iOS bundle ID; do not register an alternate App ID');
assert(app?.android?.package === 'br.com.alternativeventures.modo',
  'Android source package differs: reconcile with Google Play AAB before release');
assert(app?.ios?.supportsTablet === true, 'iPad support missing from manifest');
assert(/^\\d+$/.test(String(app?.ios?.buildNumber ?? '')),
  'iOS buildNumber must be numeric');
assert(typeof app?.extra?.eas?.projectId === 'string' && /^[0-9a-f-]{36}$/i.test(app.extra.eas.projectId),
  'EAS project ID missing/invalid; verify ownership in EAS');
assert(typeof app?.owner === 'string' && app.owner.length > 0,
  'Expo account owner missing; verify existing ownership without creating a duplicate');
assert(isHttps(app?.extra?.apiUrl), 'API URL must use HTTPS');
assert(isHttps(app?.extra?.privacyUrl), 'Privacy policy URL must use HTTPS');
assert(isHttps(app?.extra?.deletionUrl), 'Account deletion URL must use HTTPS');
assert(typeof app?.extra?.supportEmail === 'string' && /^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(app.extra.supportEmail),
  'Support email missing/invalid');
assert(eas?.build?.preview?.ios?.simulator === true,
  'Preview profile is expected to be an unsigned simulator build');
assert(eas?.build?.production?.ios?.simulator !== true,
  'Production profile cannot target simulator');
assert(eas?.build?.production?.ios?.autoIncrement === false,
  'Unexpected iOS autoIncrement: manual buildNumber approval gate assumed');
assert(eas?.submit?.production?.ios && typeof eas.submit.production.ios === 'object',
  'iOS submit profile missing');
info.push('Source config OK; Apple signing/App Store Connect ownership unverified');
info.push('Manual build number gate: configured iOS buildNumber ' + app?.ios?.buildNumber);
info.push('Check App Store Connect for duplicate buildNumber before signing; no automatic upload');
info.push('Manual gates remain: Play AAB, QA, privacy, Apple team, certificates, screenshots, reviewer access');
for (const item of info) console.log('INFO: ' + item);
for (const item of issues) console.error('FAIL: ' + item);
if (issues.length) process.exitCode = 1;
else console.log('PASS: static manifest sanity only; NOT TestFlight-ready');
