// Screenshot the live cat view with the real HA frontend, to verify the deployed card.
// Usage: HA_TOKEN=... node tools/shoot-live.mjs
// Auth: the long-lived token is placed in the page's localStorage (hassTokens) inside the
// browser context only; it is never written to disk or printed. It only exercises demo
// buttons (FreshFeed demo helpers) -- it never presses the real Aqara feeder's actions.
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const base = process.env.HA_URL ?? 'http://homeassistant.local:8123';
const token = process.env.HA_TOKEN;
if (!token) {
  console.error('HA_TOKEN is not set');
  process.exit(2);
}
const out = new URL('../harness/out/live/', import.meta.url).pathname;
mkdirSync(out, { recursive: true });

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1400, height: 1300 }, deviceScaleFactor: 1 });
await ctx.addInitScript(
  ([t, url]) => {
    localStorage.setItem(
      'hassTokens',
      JSON.stringify({
        access_token: t,
        token_type: 'Bearer',
        expires_in: 31536000,
        hassUrl: url,
        clientId: url + '/',
        expires: Date.now() + 31536000000,
        refresh_token: '',
      }),
    );
  },
  [token, base],
);
const page = await ctx.newPage();
const problems = [];
page.on('pageerror', (e) => problems.push('pageerror: ' + e.message));
page.on('console', (m) => {
  if (m.type() === 'error' && !/advanced-camera-card/i.test(m.text())) problems.push('console: ' + m.text());
});

await page.goto(`${base}/lovelace/9`, { waitUntil: 'networkidle' });
const cards = page.locator('pet-feeder-card');
await cards.first().waitFor({ timeout: 30000 });
console.log('pet-feeder-card elements:', await cards.count());
await page.waitForTimeout(1500);
await page.screenshot({ path: out + 'cat-view.png', fullPage: true });
for (let i = 0; i < (await cards.count()); i++) {
  await cards.nth(i).screenshot({ path: out + `card-${i}.png` });
}

// Masonry layout does not keep config order in the DOM, so pick cards by their configured
// model. SAFETY: only the FreshFeed demo card's actions are ever pressed; every action
// button of the FreshFeed card is verified to target a *_demo_* helper or a notification.
async function byModel(model) {
  for (let i = 0; i < (await cards.count()); i++) {
    if ((await cards.nth(i).evaluate((el) => el._config && el._config.model)) === model) return cards.nth(i);
  }
  throw new Error(`no card with model ${model}`);
}
const ff = await byModel('freshfeed');
const ffActions = await ff.evaluate((el) => el._config.actions);
for (const a of ffActions) {
  const ok = a.action.startsWith('persistent_notification.') || JSON.stringify(a.target || {}).includes('_demo_');
  if (!ok) throw new Error('refusing to press a non-demo action: ' + JSON.stringify(a));
}

// Controls dialog on the FreshFeed demo card: open, inspect, screenshot, close.
await ff.locator('button.menu').click();
await page.waitForTimeout(2500);
const dlg = await ff.evaluate((el) => {
  const d = el.shadowRoot.querySelector('ha-dialog, .overlay');
  return {
    haDialogDefined: !!customElements.get('ha-dialog'),
    count: el.shadowRoot.querySelectorAll('ha-dialog, .overlay').length,
    tag: d && d.tagName,
    open: d && d.open,
    rows: d ? d.querySelectorAll('.rows > *').length : 0,
    rect: d ? JSON.stringify(d.getBoundingClientRect()) : null,
  };
});
console.log('controls dialog on freshfeed card:', JSON.stringify(dlg));
await page.screenshot({ path: out + 'freshfeed-controls.png' });
await ff.screenshot({ path: out + 'freshfeed-controls-card.png' });
await ff.locator('[data-close]').click();
await page.waitForTimeout(800);
console.log('dialogs after close:', await ff.evaluate((el) => el.shadowRoot.querySelectorAll('ha-dialog, .overlay').length));

// Demo feed on the FreshFeed card: one tap must not call, two taps must.
const status = () => page.evaluate(() => document.querySelector('home-assistant').hass.states['input_select.freshfeed_demo_status'].state);
console.log('demo status before:', await status());
await ff.locator('button[data-action="0"]').click();
await page.waitForTimeout(1200);
console.log('demo status after one tap:', await status());
await ff.locator('button[data-action="0"]').click();
await page.waitForTimeout(1500);
console.log('demo status after second tap:', await status());
await ff.screenshot({ path: out + 'freshfeed-feeding-live.png' });
// Put the demo back to standby.
await page.evaluate(() =>
  document.querySelector('home-assistant').hass.callService('input_select', 'select_option', { option: 'standby' }, { entity_id: 'input_select.freshfeed_demo_status' }),
);

console.log(problems.length ? 'PROBLEMS:\n' + problems.join('\n') : 'no page errors');
await browser.close();
