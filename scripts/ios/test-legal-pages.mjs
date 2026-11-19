#!/usr/bin/env node
// Browser-based validation of MODO legal routes. Tests rendered React pages,
// not identical index.html SPA shells. Does NOT validate deletion backend actions.
import { chromium } from 'playwright';

const base = process.env.MODO_LEGAL_BASE_URL || 'http://127.0.0.1:5173';
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: {width: 390, height: 844} });
  const routes = [
    {path:'/politica-de-privacidade', heading:'Política de Privacidade da MODO', excerpt:'Quem é responsável pelos dados'},
    {path:'/exclusao-de-dados', heading:'Instruções para exclusão de dados', excerpt:'Como solicitar'},
  ];
  for (const {path,heading,excerpt} of routes) {
    await page.goto(base + path, {waitUntil:'domcontentloaded', timeout: 30000});
    await page.getByRole('heading', {name:heading, exact:true}).waitFor({timeout:30000});
    await page.getByText(excerpt, {exact:false}).first().waitFor();
    const content = await page.locator('main').innerText();
    if (content.length < 800) throw new Error('Legal content unexpectedly short at ' + path);
    const email = await page.locator('a[href^="mailto:"]').first().getAttribute('href');
    if (!email || !email.includes('@')) throw new Error('Legal contact missing at ' + path);
    console.log('BROWSER_PASS ' + path + ' heading=' + heading + ' contentChars=' + content.length);
  }
  await page.goto(base + '/exclusao-de-dados', {waitUntil:'domcontentloaded'});
  await page.getByRole('link',{name:'Solicitar exclusão por e-mail'}).waitFor({timeout:30000});
  console.log('BROWSER_PASS deletion request link exists; manual processing and in-app deletion require separate QA');
} finally {
  await browser.close();
}
