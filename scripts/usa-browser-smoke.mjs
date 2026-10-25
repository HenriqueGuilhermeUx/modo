/** MODO/SmartBots USA QA: built-site browser test with synthetic data. */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { chromium } from 'playwright';

const host = 'http://127.0.0.1:4183';
const server = spawn('npx', ['vite', 'preview', '--host', '127.0.0.1', '--port', '4183', '--strictPort'], {
  cwd: 'apps/web', env: { ...process.env }, stdio: ['ignore', 'pipe', 'pipe'],
});
let logs = '';
for (const stream of [server.stdout, server.stderr]) {
  stream.on('data', chunk => { logs += String(chunk).slice(-2500); });
}
let browser;
try {
  let live = false;
  for (let n = 0; n < 60; n++) {
    if (server.exitCode !== null) throw new Error('Vite preview stopped: ' + logs);
    try { if ((await fetch(host + '/us/demo')).ok) { live = true; break; } }
    catch { /* waiting for local build */ }
    await sleep(500);
  }
  assert.ok(live, 'Web preview failed to start: ' + logs);
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const backendCalls = [], runtimeErrors = [];
  page.on('request', request => {
    if (/onrender\.com|\/api\/|supabase\.co/i.test(request.url())) backendCalls.push(request.url());
  });
  page.on('pageerror', error => runtimeErrors.push(error.message));
  await page.goto(host + '/us/demo', { waitUntil: 'networkidle', timeout: 30000 });
  await page.getByRole('heading', { name: 'Campaign brief' }).waitFor();
  assert.equal(await page.locator('html').getAttribute('lang'), 'en-US');
  assert.equal(await page.locator('meta[name="robots"]').getAttribute('content'), 'noindex,nofollow');
  await page.getByLabel('Business name').fill('Example bakery');
  await page.getByLabel('Target audience').fill('People exploring local food options');
  await page.getByRole('button', { name: 'Build sample plan' }).click();
  await page.getByText('Sample plan generated locally with predefined rules. No AI request was made.').waitFor();
  await page.getByRole('heading', { name: 'Position your offer' }).waitFor();
  await page.getByRole('checkbox', { name: 'Reviewed' }).first().check();
  assert.match(await page.locator('.usw-count').innerText(), /1 of 3 reviewed/);

  await page.goto(host + '/us/smartbots/demo', { waitUntil: 'networkidle' });
  await page.getByRole('heading', { name: 'Lead inbox' }).waitFor();
  assert.equal(await page.locator('html').getAttribute('lang'), 'en-US');
  await page.getByLabel('Name or alias').fill('Sample: Casey');
  await page.getByLabel('Area of interest').fill('Sample consultation');
  await page.getByRole('button', { name: 'Add sample lead' }).click();
  await page.getByRole('button', { name: /Sample: Casey/i }).waitFor();
  await page.getByLabel('Lead stage').selectOption('Follow-up');
  await page.getByText('Hi Casey, thanks for asking about sample consultation. Would you like more details?').waitFor();
  await page.getByRole('button', { name: 'Reset demo' }).click();
  assert.equal(await page.getByRole('button', { name: /Sample: Casey/i }).count(), 0);
  assert.equal(backendCalls.length, 0, 'USA preview unexpectedly made backend requests: ' + backendCalls.join(', '));
  assert.deepEqual(runtimeErrors, [], 'Browser runtime errors');
  console.log('PASS: MODO planning and SmartBots lead demos, mobile, noindex, no Brazilian API requests');
} finally {
  await browser?.close();
  server.kill('SIGTERM');
}
