// Load dashboard views in desktop and phone viewports and report every error card.
// Read-only: presses nothing.
// Usage: HA_TOKEN=... node tools/probe-errors.mjs [view-index ...]
import { chromium, devices } from 'playwright';

const base = process.env.HA_URL ?? 'http://homeassistant.local:8123';
const token = process.env.HA_TOKEN;
if (!token) {
  console.error('HA_TOKEN is not set');
  process.exit(2);
}
const viewIdx = process.argv.slice(2).length ? process.argv.slice(2) : ['1', '9'];
const browser = await chromium.launch();

for (const [label, opts] of [
  ['desktop', { viewport: { width: 1600, height: 1300 } }],
  ['phone', { ...devices['Pixel 7'] }],
]) {
  const ctx = await browser.newContext(opts);
  await ctx.addInitScript(
    ([t, url]) => {
      localStorage.setItem('hassTokens', JSON.stringify({ access_token: t, token_type: 'Bearer', expires_in: 31536000, hassUrl: url, clientId: url + '/', expires: Date.now() + 31536000000, refresh_token: '' }));
    },
    [token, base],
  );
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log(`  [${label}] pageerror: ${e.message.slice(0, 200)}`));
  for (const v of viewIdx) {
    await page.goto(`${base}/lovelace/${v}`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(3000);
    const report = await page.evaluate(() => {
      // Walk all shadow roots to find error cards and our cards.
      const found = { errors: [], feeders: [] };
      const walk = (root) => {
        for (const el of root.querySelectorAll('*')) {
          const tag = el.tagName.toLowerCase();
          if (tag === 'hui-error-card' || tag === 'hui-warning') {
            found.errors.push({ tag, text: (el.shadowRoot?.textContent || el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 300), config: JSON.stringify(el._config || el.config || null).slice(0, 300) });
          }
          if (tag === 'pet-feeder-card') found.feeders.push(el._config?.model ?? 'no-config');
          if (el.shadowRoot) walk(el.shadowRoot);
        }
      };
      walk(document);
      return found;
    });
    console.log(`[${label}] view ${v}: feeders=${JSON.stringify(report.feeders)} errorCards=${report.errors.length}`);
    for (const e of report.errors) console.log('   ', JSON.stringify(e));
    await page.screenshot({ path: new URL(`../harness/out/live/probe-${label}-${v}.png`, import.meta.url).pathname, fullPage: true });
  }
  await ctx.close();
}
await browser.close();
