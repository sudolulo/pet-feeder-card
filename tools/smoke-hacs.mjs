// Synthetic browser check against only the exported distribution; no HA/device access.
// Usage: node tools/smoke-hacs.mjs ~/.cache/petsafe/hacs-dist
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import assert from 'node:assert/strict';
const root = resolve(process.argv[2], 'pet-feeder-card');
const requested = [];
const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/') {
    res.setHeader('Content-Type', 'text/html');
    res.end('<!doctype html><title>Distribution smoke</title><script type="module" src="/dist/pet-feeder-card.js"></script>');
    return;
  }
  requested.push(url.pathname);
  const file = resolve(root, '.' + url.pathname);
  if (!file.startsWith(root + sep)) { res.writeHead(403).end(); return; }
  try {
    res.setHeader('Content-Type', file.endsWith('.js') ? 'text/javascript' : 'application/octet-stream');
    res.end(await readFile(file));
  } catch { res.writeHead(404).end(); }
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
let browser;
try {
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('requestfailed', r => errors.push(r.url()));
  page.on('response', r => { if (r.status() >= 400) errors.push(`${r.status()} ${r.url()}`); });
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  await page.evaluate(async () => {
    await customElements.whenDefined('pet-feeder-card');
    for (const config of [
      { model: 'freshfeed', mode: 'raw', raw_entities: ['sensor.example_dp_4', 'binary_sensor.example_dp_110'] },
      { model: 'aqara_c1', entities: { food_level: 'sensor.example_food_level', portions_today: 'sensor.example_portions_today' } },
    ]) {
      const card = document.createElement('pet-feeder-card');
      card.setConfig(config);
      card.hass = { states: {}, language: 'en', locale: { language: 'en' }, callService() { throw Error('Unexpected service call'); } };
      document.body.append(card);
    }
  });
  assert.equal(await page.locator('pet-feeder-card').count(), 2);
  assert.deepEqual(errors, []);
  assert(requested.includes('/dist/pet-feeder-card.js'));
  assert(requested.includes('/dist/freshfeed-model.js'));
  assert(requested.every(p => p.startsWith('/dist/')));
  console.log('PASS: both exported modules load; FreshFeed/Aqara minimal configs render; no source dependencies or service calls.');
} finally {
  await browser?.close();
  await new Promise(r => server.close(r));
}
