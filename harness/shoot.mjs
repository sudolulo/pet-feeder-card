// Visual + behavioural harness for pet-feeder-card.
//
// Serves the project over a throwaway local HTTP server (ES modules do not load
// from file://), opens harness/index.html in Playwright's cached Chromium, runs
// behaviour checks against the real custom element, and writes one PNG per
// scenario/theme plus an overview into harness/out/. Exits non-zero on any failed
// check or page error.
import http from 'node:http';
import { readFile, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'harness', 'out');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css' };

const server = http.createServer(async (req, res) => {
  const rel = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  const file = path.join(ROOT, rel);
  if (!file.startsWith(ROOT + path.sep)) {
    res.writeHead(403).end();
    return;
  }
  try {
    const body = await readFile(file);
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' }).end(body);
  } catch (err) {
    res.writeHead(err.code === 'ENOENT' ? 404 : 500).end(String(err.code));
  }
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const BASE = `http://127.0.0.1:${server.address().port}/harness/index.html`;

const failures = [];
const check = (ok, what) => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${what}`);
  if (!ok) failures.push(what);
};

const browser = await chromium.launch();
try {
  await rm(OUT, { recursive: true, force: true });
  await mkdir(OUT, { recursive: true });

  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(String(e)));
  page.on('console', (m) => {
    if (m.type() === 'error') pageErrors.push(`console.error: ${m.text()}`);
  });
  await page.goto(BASE);
  await page.waitForFunction(() => window.__ready === true);

  // ---- behaviour checks ----------------------------------------------------------
  const r = await page.evaluate(async () => {
    const { makeHass, ffConfig, ffStates, aqConfig } = window.__harness;
    const out = {};
    const host = document.createElement('div');
    document.body.appendChild(host);
    const text = (el, sel) => el.shadowRoot.querySelector(sel)?.textContent.trim();

    // hass before setConfig
    const a = document.createElement('pet-feeder-card');
    a.hass = makeHass(ffStates({ status: 'feeding', food: 'high' }));
    a.setConfig(structuredClone(ffConfig));
    host.appendChild(a);
    out.hassFirst = text(a, '.status-label');

    // setConfig, attach, then hass
    const b = document.createElement('pet-feeder-card');
    b.setConfig(structuredClone(ffConfig));
    host.appendChild(b);
    out.noHassYet = text(b, '.status-label');
    b.hass = makeHass(ffStates({ status: 'feeding_complete', food: 'high' }));
    out.configFirst = text(b, '.status-label');

    // configured entities missing from hass.states
    const c = document.createElement('pet-feeder-card');
    c.setConfig(structuredClone(aqConfig));
    c.hass = makeHass({});
    host.appendChild(c);
    out.missingStatus = text(c, '.status-label');
    out.missingItems = [...c.shadowRoot.querySelectorAll('.footer .item span')].map((s) => s.textContent);
    out.missingGauge = text(c, '.gauge-text');

    // invalid config throws a clear Error
    try {
      document.createElement('pet-feeder-card').setConfig({});
      out.throwsMissingModel = 'no throw';
    } catch (e) {
      out.throwsMissingModel = e.message;
    }

    // change detection: same state objects -> no re-render
    const states = ffStates({ status: 'standby', food: 'high' });
    const d = document.createElement('pet-feeder-card');
    d.setConfig(structuredClone(ffConfig));
    host.appendChild(d);
    d.hass = makeHass(states);
    const before = d.shadowRoot.querySelector('.header');
    d.hass = makeHass({ ...states, 'sensor.unrelated': { state: '1', attributes: {} } });
    out.noRerenderOnUnrelated = d.shadowRoot.querySelector('.header') === before;
    d.hass = makeHass({ ...states, [ffConfig.entities.status]: { ...states[ffConfig.entities.status], state: 'feeding' } });
    out.rerenderOnWatched = text(d, '.status-label');

    // confirm flow: first tap arms, second tap calls the service exactly once
    window.__calls.length = 0;
    const btn = () => d.shadowRoot.querySelector('.actions .round');
    btn().click();
    out.armed = btn().classList.contains('armed') && btn().title === 'Tap again to confirm' && btn().querySelector('ha-icon').getAttribute('icon') === 'mdi:check';
    out.callsAfterOneTap = window.__calls.length;
    btn().click();
    out.callsAfterTwoTaps = JSON.stringify(window.__calls);
    out.disarmedAfterCall = !btn().classList.contains('armed');
    // arming expires after 4 s
    btn().click();
    await new Promise((res) => setTimeout(res, 4300));
    out.disarmedAfterTimeout = !btn().classList.contains('armed');
    btn().click(); // a tap after expiry only re-arms
    out.callsAfterExpiredTap = window.__calls.length;

    // more-info from the chip
    let moreInfo = null;
    d.addEventListener('hass-more-info', (e) => (moreInfo = e.detail.entityId));
    d.shadowRoot.querySelector('.chip').click();
    out.moreInfo = moreInfo;

    // controls dialog
    d.shadowRoot.querySelector('.round.menu').click();
    await new Promise((res) => setTimeout(res, 50));
    out.controlRows = [...d.shadowRoot.querySelectorAll('.overlay .rows > *')].map((n) => n.textContent);
    d.shadowRoot.querySelector('[data-close]').click();
    out.overlayClosed = !d.shadowRoot.querySelector('.overlay');

    // dialog de-dupe: a double click on the menu opens exactly one overlay
    const menu = () => d.shadowRoot.querySelector('.round.menu');
    menu().click();
    menu().click();
    await new Promise((res) => setTimeout(res, 50));
    menu().click();
    await new Promise((res) => setTimeout(res, 50));
    out.overlayCount = d.shadowRoot.querySelectorAll('.overlay').length;
    // setConfig while open removes the dialog
    d.setConfig(structuredClone(ffConfig));
    out.overlayAfterSetConfig = d.shadowRoot.querySelectorAll('.overlay').length;
    out.rowsAfterSetConfig = d._dialogRows.length;
    // A masonry view may disconnect and reconnect a card in one task while it
    // moves it between columns. Its open controls and armed action must survive.
    menu().click();
    await new Promise((res) => setTimeout(res, 50));
    btn().click();
    const secondParent = document.createElement('div');
    document.body.appendChild(secondParent);
    d.remove();
    secondParent.appendChild(d);
    await new Promise((res) => setTimeout(res, 100));
    out.overlayAfterTransientReparent = d.shadowRoot.querySelectorAll('.overlay').length;
    out.rowsAfterTransientReparent = d.shadowRoot.querySelectorAll('.overlay .rows > *').length;
    out.armedAfterTransientReparent = btn().classList.contains('armed');

    // A real disconnect still tears down the controls and confirm state.
    d.remove();
    await new Promise((res) => setTimeout(res, 100));
    out.overlayAfterDisconnect = d.shadowRoot.querySelectorAll('.overlay').length;
    out.rowsAfterDisconnect = d._dialogRows.length;
    out.armedAfterDisconnect = d._armed === -1;

    // Eight controls fit within a 600px card. The panel stays inside the card
    // and advertises a scroll container for real HA rows that exceed its height.
    const eight = document.createElement('pet-feeder-card');
    const controlIds = Array.from({ length: 8 }, (_, i) => `input_select.freshfeed_control_${i}`);
    const eightStates = {
      ...ffStates({ status: 'standby', food: 'high' }),
      ...Object.fromEntries(controlIds.map((id, i) => [id, { state: 'option', attributes: { friendly_name: `FreshFeed control ${i + 1}` } }])),
    };
    const eightConfig = { ...structuredClone(ffConfig), controls: controlIds };
    eight.style.cssText = 'display:block;width:420px;height:600px';
    eight.setConfig(eightConfig);
    eight.hass = makeHass(eightStates);
    document.body.appendChild(eight);
    eight.shadowRoot.querySelector('.round.menu').click();
    await new Promise((res) => setTimeout(res, 50));
    const panel = eight.shadowRoot.querySelector('.panel');
    const cardRect = eight.shadowRoot.querySelector('ha-card').getBoundingClientRect();
    const panelRect = panel.getBoundingClientRect();
    out.eightControlPanelInsideCard = panelRect.top >= cardRect.top && panelRect.bottom <= cardRect.bottom;
    out.eightControlPanelScrollable = getComputedStyle(panel).overflowY === 'auto';
    eight.remove();

    // stub config renders
    const e = document.createElement('pet-feeder-card');
    e.setConfig(customElements.get('pet-feeder-card').getStubConfig());
    host.appendChild(e);
    out.stub = text(e, '.name');
    out.size = e.getCardSize();
    out.grid = JSON.stringify(e.getGridOptions());
    out.customCards = JSON.stringify(window.customCards);

    host.remove();
    return out;
  });

  check(r.hassFirst === 'Feeding', `hass set before setConfig renders (got ${r.hassFirst})`);
  // Before hass arrives the configured status entity cannot be read, so "Unknown".
  check(r.noHassYet === 'Unknown' && r.configFirst === 'Fed', `setConfig before hass renders, then updates (got ${r.noHassYet} -> ${r.configFirst})`);
  check(r.missingStatus === 'Unknown', `missing status entity shows Unknown (got ${r.missingStatus})`);
  check(JSON.stringify(r.missingItems) === '["Unknown","Unknown","Unknown"]', `missing footer entities show Unknown (got ${JSON.stringify(r.missingItems)})`);
  check(r.missingGauge === 'Unknown', `missing food entity gauge shows Unknown (got ${r.missingGauge})`);
  check(/model.*required/i.test(r.throwsMissingModel), `setConfig({}) throws (got ${r.throwsMissingModel})`);
  check(r.noRerenderOnUnrelated === true, 'unrelated state change does not re-render');
  check(r.rerenderOnWatched === 'Feeding', `watched state change re-renders (got ${r.rerenderOnWatched})`);
  check(r.armed === true, 'first tap arms the confirm button (warning fill, mdi:check, tooltip)');
  check(r.callsAfterOneTap === 0, `one tap does not dispense (calls: ${r.callsAfterOneTap})`);
  check(
    r.callsAfterTwoTaps ===
      JSON.stringify([{ domain: 'input_select', service: 'select_option', data: { option: 'feeding' }, target: { entity_id: 'input_select.freshfeed_demo_status' } }]),
    `second tap calls the service once (got ${r.callsAfterTwoTaps})`,
  );
  check(r.disarmedAfterCall, 'button disarms after the call');
  check(r.disarmedAfterTimeout, 'armed state expires after 4 s');
  check(r.callsAfterExpiredTap === 1, `tap after expiry does not dispense (calls: ${r.callsAfterExpiredTap})`);
  check(r.moreInfo === 'input_number.freshfeed_demo_last_feed', `chip fires hass-more-info (got ${r.moreInfo})`);
  check(r.controlRows.length === 3 && r.controlRows[0].includes('FreshFeed demo status'), `controls dialog lists rows (got ${JSON.stringify(r.controlRows)})`);
  check(r.overlayClosed, 'controls dialog closes');
  check(r.overlayCount === 1, `double/triple menu click opens exactly one dialog (got ${r.overlayCount})`);
  check(r.overlayAfterSetConfig === 0 && r.rowsAfterSetConfig === 0, `setConfig while open removes the dialog (overlays ${r.overlayAfterSetConfig}, rows ${r.rowsAfterSetConfig})`);
  check(r.overlayAfterTransientReparent === 1 && r.rowsAfterTransientReparent === 3, `transient re-parent preserves open controls and rows (overlays ${r.overlayAfterTransientReparent}, rows ${r.rowsAfterTransientReparent})`);
  check(r.armedAfterTransientReparent, 'transient re-parent preserves an armed action');
  check(r.overlayAfterDisconnect === 0 && r.rowsAfterDisconnect === 0, `real disconnect removes controls and rows (overlays ${r.overlayAfterDisconnect}, rows ${r.rowsAfterDisconnect})`);
  check(r.armedAfterDisconnect, 'real disconnect disarms the confirm action');
  check(r.eightControlPanelInsideCard && r.eightControlPanelScrollable, `eight-control panel stays inside a 600px card and scrolls (inside ${r.eightControlPanelInsideCard}, scrollable ${r.eightControlPanelScrollable})`);
  check(r.stub === 'FreshFeed' && r.size === 7, `stub config renders (got ${r.stub}, size ${r.size})`);
  check(r.grid === '{"columns":12,"min_columns":6,"rows":"auto"}', `grid options (got ${r.grid})`);
  check(r.customCards.includes('"type":"pet-feeder-card"'), 'registered in window.customCards');

  // ---- keyboard confirm: real key presses; focus must survive the arming re-render ----
  await page.evaluate(() => {
    const { makeHass, ffConfig, ffStates } = window.__harness;
    const k = document.createElement('pet-feeder-card');
    k.id = 'kbd';
    k.setConfig(structuredClone(ffConfig));
    k.hass = makeHass(ffStates({ status: 'standby', food: 'high' }));
    document.body.appendChild(k);
    window.__calls.length = 0;
    k.shadowRoot.querySelector('.actions .round[data-action="0"]').focus();
  });
  await page.keyboard.press('Enter');
  const kbArmed = await page.evaluate(() => {
    const k = document.getElementById('kbd');
    return {
      calls: window.__calls.length,
      armed: k.shadowRoot.querySelector('.actions .round').classList.contains('armed'),
      focused: k.shadowRoot.activeElement?.dataset?.action ?? null,
    };
  });
  check(kbArmed.armed && kbArmed.calls === 0, `Enter on a focused action arms it without calling (armed ${kbArmed.armed}, calls ${kbArmed.calls})`);
  check(kbArmed.focused === '0', `armed action button keeps keyboard focus (focused data-action ${kbArmed.focused})`);
  await page.keyboard.press('Enter');
  const kbCalls = await page.evaluate(() => window.__calls.length);
  check(kbCalls === 1, `second Enter calls the service exactly once (calls ${kbCalls})`);
  await page.evaluate(() => document.getElementById('kbd').remove());

  // ---- screenshots ----------------------------------------------------------------
  // Freeze every animation at a mid frame so the feeding state is visible and stable.
  await page.evaluate(() => {
    for (const card of document.querySelectorAll('pet-feeder-card')) {
      for (const anim of card.shadowRoot.getAnimations()) {
        anim.pause();
        anim.currentTime = anim.effect.getTiming().duration * 0.15;
      }
    }
  });
  const written = [];
  for (const cell of await page.locator('.cell').all()) {
    const name = await cell.getAttribute('data-shot');
    const file = path.join(OUT, `${name}.png`);
    await cell.screenshot({ path: file, animations: 'allow' });
    written.push(file);
  }
  const overview = path.join(OUT, 'overview.png');
  await page.locator('#grid').screenshot({ path: overview, animations: 'allow' });
  written.push(overview);

  // Controls dialog open (fallback overlay).
  const first = page.locator('.cell[data-shot="freshfeed-ready-high-light"] pet-feeder-card');
  await first.evaluate((el) => el.shadowRoot.querySelector('.round.menu').click());
  await page.waitForTimeout(100);
  const dlg = path.join(OUT, 'freshfeed-controls-light.png');
  await page.locator('.cell[data-shot="freshfeed-ready-high-light"]').screenshot({ path: dlg });
  written.push(dlg);

  // Armed confirm button.
  const aq = page.locator('.cell[data-shot="aqara-bowl-full-dark"] pet-feeder-card');
  await aq.evaluate((el) => el.shadowRoot.querySelector('.actions .round').click());
  const armed = path.join(OUT, 'aqara-armed-dark.png');
  await page.locator('.cell[data-shot="aqara-bowl-full-dark"]').screenshot({ path: armed });
  written.push(armed);

  // Narrow card (about half a sections-view column): the chip moves below the art.
  for (const scenario of ['aqara-bowl-full', 'freshfeed-ready-high']) {
    const narrow = await ctx.newPage();
    await narrow.goto(`${BASE}?scenario=${scenario}&narrow=1`);
    await narrow.waitForFunction(() => window.__ready === true);
    const file = path.join(OUT, `extra-narrow-${scenario}-light.png`);
    await narrow.locator('.cell.theme-light').screenshot({ path: file });
    written.push(file);
    await narrow.close();
  }

  // prefers-reduced-motion: no animations at all on the feeding cards.
  const rmCtx = await browser.newContext({ reducedMotion: 'reduce' });
  const rmPage = await rmCtx.newPage();
  await rmPage.goto(`${BASE}?scenario=freshfeed-feeding-low`);
  await rmPage.waitForFunction(() => window.__ready === true);
  const rmCount = await rmPage.evaluate(() =>
    [...document.querySelectorAll('pet-feeder-card')].reduce((n, c) => n + c.shadowRoot.getAnimations().length, 0),
  );
  check(rmCount === 0, `prefers-reduced-motion disables animation (running: ${rmCount})`);
  await rmCtx.close();

  check(pageErrors.length === 0, `no page errors (${JSON.stringify(pageErrors)})`);
  console.log(`\nwrote ${written.length} PNGs:`);
  for (const f of written) console.log(`  ${f}`);
} finally {
  await browser.close();
  server.close();
}

if (failures.length) {
  console.error(`\n${failures.length} check(s) failed`);
  process.exit(1);
}
console.log('\nall checks passed');
