// Screenshot one live dashboard view and count pet-feeder cards. Presses nothing.
// Usage: HA_TOKEN=... node tools/shoot-view.mjs <view-index> <out-name>
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const base = process.env.HA_URL ?? 'http://homeassistant.local:8123';
const token = process.env.HA_TOKEN;
if (!token) {
  console.error('HA_TOKEN is not set');
  process.exit(2);
}
const [viewIndex = '0', name = 'view'] = process.argv.slice(2);
const out = new URL('../harness/out/live/', import.meta.url).pathname;
mkdirSync(out, { recursive: true });

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1600, height: 1300 } });
await ctx.addInitScript(
  ([t, url]) => {
    localStorage.setItem('hassTokens', JSON.stringify({ access_token: t, token_type: 'Bearer', expires_in: 31536000, hassUrl: url, clientId: url + '/', expires: Date.now() + 31536000000, refresh_token: '' }));
  },
  [token, base],
);
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(`${base}/lovelace/${viewIndex}`, { waitUntil: 'networkidle' });
await page.locator('pet-feeder-card').first().waitFor({ timeout: 30000 });
await page.waitForTimeout(2000);
const models = await page.locator('pet-feeder-card').evaluateAll((els) => els.map((e) => e._config && e._config.model));
console.log('pet-feeder-card models on view', viewIndex + ':', models.join(', '));
await page.screenshot({ path: out + name + '.png', fullPage: true });
console.log('page errors:', errors.length ? errors.join(' | ') : 'none');
await browser.close();
