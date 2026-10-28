/** Desktop routing and accessibility smoke for isolated USA previews. Synthetic browsing only. */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { chromium } from 'playwright';

const origin = 'http://127.0.0.1:4184';
const server = spawn(process.execPath, [resolve('node_modules/vite/bin/vite.js'), 'preview',
  '--host', '127.0.0.1', '--port', '4184', '--strictPort'], {
  cwd: 'apps/web', env: { ...process.env }, stdio: ['ignore', 'pipe', 'pipe'],
});
let logs = '';
for (const stream of [server.stdout, server.stderr]) {
  stream.on('data', chunk => { logs += String(chunk).slice(-1500); });
}
let browser;
try {
  let ready = false;
  for (let attempt = 0; attempt < 60; attempt++) {
    if (server.exitCode !== null) throw new Error('Preview exited: ' + logs);
    try {
      const response = await fetch(origin + '/us');
      if (response.ok) { ready = true; break; }
    } catch { /* wait for Vite */ }
    await sleep(500);
  }
  assert.ok(ready, 'Preview did not start: ' + logs);
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  const errors = [], forbidden = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('request', request => {
    if (request.url().includes('onrender.com') || request.url().includes('supabase.co') || request.url().includes('/api/')) forbidden.push(request.url());
  });

  for (const [route, heading, demo] of [
    ['/us', 'Your business comes first.', '/us/demo'],
    ['/us/smartbots', 'Capture new leads.', '/us/smartbots/demo'],
  ]) {
    await page.goto(origin + route, { waitUntil: 'networkidle' });
    await page.getByRole('heading', { level: 1 }).waitFor();
    assert.ok((await page.getByRole('heading', { level: 1 }).innerText()).includes(heading), 'Incorrect hero heading: ' + route);
    assert.equal(await page.locator('html').getAttribute('lang'), 'en-US');
    assert.equal(await page.locator('meta[name="robots"]').getAttribute('content'), 'noindex,nofollow');
    assert.equal(await page.locator('main').count(), 1);
    assert.equal(await page.locator('nav[aria-label="United States product navigation"]').count(), 1);
    assert.equal(await page.locator('a[href="' + demo + '"]').count(), 1);
    assert.ok(await page.getByText('No US account activation or checkout', { exact: false }).isVisible());
    const size = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      viewportWidth: window.innerWidth,
    }));
    assert.ok(size.scrollWidth <= size.viewportWidth + 2, 'Horizontal overflow at ' + route + ': ' + JSON.stringify(size));
    for (const href of ['/us', '/us/smartbots']) {
      assert.ok(await page.locator('nav a[href="' + href + '"]').count() === 1, 'Missing USA navigation ' + href);
    }
    // Keyboard-only visitors must reach the navigation and interactive demo.
    await page.keyboard.press('Tab');
    const keyboardTargets = await page.locator('nav a, .av-us-actions a').evaluateAll(elements =>
      elements.filter(element => element.getAttribute('href') && element.tabIndex >= 0).length);
    assert.ok(keyboardTargets >= 4, 'USA navigation lacks keyboard-reachable links: ' + route);
    const accessibleDemoName = await page.locator('a[href="' + demo + '"]').getAttribute('aria-label');
    const visibleDemoText = await page.locator('a[href="' + demo + '"]').innerText();
    assert.ok((accessibleDemoName || visibleDemoText).trim().length > 3, 'Demo action needs accessible text: ' + route);
    await page.locator('a[href="' + demo + '"]').click();
    await page.waitForURL('**' + demo);
    // A URL change alone does not mean the lazy-loaded demo has mounted:
    // the shared BR loading fallback can still carry lang="pt-BR".
    // Wait for the real, product-specific US content before checking locale.
    const demoHeading = demo === '/us/demo'
      ? 'Make marketing easier to plan.'
      : 'Keep conversations moving.';
    await page.getByRole('heading', { level: 1, name: demoHeading }).waitFor({ timeout: 15000 });
    await page.waitForFunction(() => document.documentElement.lang === 'en-US', null, { timeout: 10000 });
    assert.equal(await page.locator('html').getAttribute('lang'), 'en-US',
      'Mounted USA demo must declare en-US: ' + demo);
    assert.equal(await page.locator('meta[name="robots"]').getAttribute('content'), 'noindex,nofollow',
      'Mounted USA demo must remain non-indexable: ' + demo);
  }

  assert.deepEqual(forbidden, [], 'USA preview called a backend: ' + forbidden.join(', '));
  // The existing BR public route must not be captured by the /us router.
  await page.goto(origin + '/smartbots.html', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(500);
  assert.notEqual(await page.locator('title').textContent(), 'SmartBots USA | Lead capture and follow-up');
  assert.equal(await page.locator('.av-us-landing').count(), 0);
  assert.deepEqual(errors, [], 'Browser JavaScript exceptions');
  console.log('PASS: desktop USA routing, navigation, semantics, overflow, noindex and BR-route separation');
} finally {
  await browser?.close();
  server.kill('SIGTERM');
}
