// Visual + behavioural harness for pet-feeder-card.
//
// Serves the project over a throwaway local HTTP server (ES modules do not load
// from file://), opens harness/index.html in Playwright's cached Chromium, runs
// behaviour checks against the real custom element, and writes one PNG per
// scenario/theme plus an overview into harness/out/. Exits non-zero on any failed
// check or page error.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { createOutputDirectory } from './output.mjs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = await createOutputDirectory(ROOT);
console.log(`Output directory: ${OUT}`);
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

const failures = [];
const check = (ok, what) => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${what}`);
  if (!ok) failures.push(what);
};

let browser;
try {
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const BASE = `http://127.0.0.1:${server.address().port}/harness/index.html`;
  browser = await chromium.launch();

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

    // meal tray: counter of 2 delivered out of 6
    const tray = document.createElement('pet-feeder-card');
    tray.setConfig(structuredClone(ffConfig));
    tray.hass = makeHass(ffStates({ status: 'standby', food: 'high', counter: 2 }));
    host.appendChild(tray);
    const tiles = () => [...tray.shadowRoot.querySelectorAll('.meals .meal-tile')];
    out.trayTileCount = tiles().length;
    out.trayStates = tiles().map((t) => t.dataset.state);
    out.trayNext = tiles()
      .map((t, i) => (t.classList.contains('next') ? i + 1 : null))
      .filter(Boolean);
    out.trayNextCaption = tray.shadowRoot.querySelector('.meals .meal-slot.next .meal-cap')?.textContent.trim();
    out.trayTitles = tiles().map((t) => t.title);
    out.trayText = text(tray, '.meals .gauge-text');
    out.trayLabel = text(tray, '.meals .gauge-label');
    out.trayReplacesFoodBar = !tray.shadowRoot.querySelector('.bar');
    let trayMore = null;
    tray.addEventListener('hass-more-info', (ev) => (trayMore = ev.detail.entityId));
    tiles()[4]?.click(); // a tap anywhere on the row
    out.trayMoreInfo = trayMore;
    // counter unavailable -> every tile unknown, "Unknown"
    tray.hass = makeHass({ ...ffStates({ status: 'standby', food: 'high' }), [ffConfig.entities.counter]: { state: 'unavailable', attributes: {} } });
    out.trayUnknownStates = tiles().map((t) => t.dataset.state);
    out.trayUnknownText = text(tray, '.meals .gauge-text');
    out.trayUnknownGlyphs = tiles().map((t) => t.textContent.trim());

    // Raw mode is a literal, read-only view: it can open more-info but must never
    // offer controls or call a service, even when synthetic stale events invoke internals.
    const raw = document.createElement('pet-feeder-card');
    raw.setConfig({ model: 'freshfeed', mode: 'raw', raw_entities: ['sensor.example_dp_4', 'binary_sensor.example_dp_110', 'sensor.missing'] });
    raw.hass = makeHass({
      'sensor.example_dp_4': { state: '<script>alert(1)</script>', attributes: { friendly_name: '<img src=x>' } },
      'binary_sensor.example_dp_110': { state: 'off', attributes: { friendly_name: 'Door state' } },
    });
    host.appendChild(raw);
    out.rawHeader = text(raw, '.raw-brand-name');
    out.rawContext = text(raw, '.raw-context');
    const rawLogo = raw.shadowRoot.querySelector('svg.raw-logo');
    out.rawLogo = rawLogo?.getAttribute('role') === 'img' && rawLogo?.getAttribute('aria-label') === 'Pet feeder card';
    out.rawLogoIsSelfContained = rawLogo != null && ![...rawLogo.querySelectorAll('*')].some((el) => [...el.attributes].some((attr) => /^(href|src)$/i.test(attr.name) || /url\(/i.test(attr.value)));
    out.rawAvailability = text(raw, '.availability');
    out.rawRows = [...raw.shadowRoot.querySelectorAll('.raw-row')].map((row) => row.textContent.trim());
    out.rawContextHasNoLocalClaim = !/\bLOCAL\b/i.test(out.rawContext);
    out.rawNoControls = !raw.shadowRoot.querySelector('.actions, .menu, .camera, .chip, .gauges, .footer');
    const rawBefore = raw.shadowRoot.querySelector('.header');
    const rawDetails = raw.shadowRoot.querySelector('.raw-data');
    rawDetails.open = true;
    raw.shadowRoot.querySelector('.raw-row').focus();
    raw.hass = makeHass({ ...raw.hass.states, 'sensor.example_dp_4': { state: 'updated', attributes: { friendly_name: 'Raw DP 4' } } });
    out.rawWatchedUpdate = text(raw, '.raw-row-state');
    out.rawExpanded = raw.shadowRoot.querySelector('.raw-data').open;
    out.rawFocusRetained = raw.shadowRoot.activeElement?.dataset?.more === 'sensor.example_dp_4';
    raw.shadowRoot.querySelector('.raw-data summary').focus();
    raw.hass = makeHass({ ...raw.hass.states, 'sensor.example_dp_4': { state: 'focused-summary-update', attributes: { friendly_name: 'Raw DP 4' } } });
    out.rawSummaryFocusRetained = raw.shadowRoot.activeElement === raw.shadowRoot.querySelector('.raw-data summary');
    window.__calls.length = 0;
    raw._onAction(0);
    await raw._openControls();
    out.rawNoServiceCalls = window.__calls.length === 0 && !raw.shadowRoot.querySelector('.overlay');
    let rawMore = null;
    raw.addEventListener('hass-more-info', (ev) => (rawMore = ev.detail.entityId));
    raw.shadowRoot.querySelector('.raw-row').click();
    out.rawMoreInfo = rawMore;
    raw.setConfig(structuredClone(ffConfig));
    raw.hass = makeHass(ffStates({ status: 'standby', food: 'high' }));
    out.rawClassRemovedOnStandard = !raw._root.classList.contains('raw-card');
    out.standardAfterRawHasControls = Boolean(raw.shadowRoot.querySelector('.actions, .menu, .gauges, .footer'));

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
  check(r.trayTileCount === 6, `meal tray shows 6 compartment tiles (got ${r.trayTileCount})`);
  check(
    JSON.stringify(r.trayStates) === JSON.stringify(['eaten', 'serving', 'full', 'full', 'full', 'full']),
    `delivered=2 tile states (got ${JSON.stringify(r.trayStates)})`,
  );
  check(JSON.stringify(r.trayNext) === '[3]' && r.trayNextCaption != null && r.trayNextCaption !== '', `next marker on tile 3 with a caption (got ${JSON.stringify(r.trayNext)}, caption ${r.trayNextCaption})`);
  check(r.trayTitles[0] === 'Meal 1 - eaten' && r.trayTitles[1] === 'Meal 2 is in the serving window' && r.trayTitles[3] === 'Meal 4 - full', `tile titles (got ${JSON.stringify(r.trayTitles)})`);
  check(r.trayText === 'Estimated 4 of 6 left' && r.trayLabel === 'Estimated meals', `tray header reads "Estimated meals / Estimated 4 of 6 left" (got ${r.trayLabel} / ${r.trayText})`);
  check(r.trayReplacesFoodBar, 'meal tray replaces the food gauge bar');
  check(r.trayMoreInfo === 'input_number.freshfeed_demo_counter', `tapping the tray fires hass-more-info for the counter (got ${r.trayMoreInfo})`);
  check(
    JSON.stringify(r.trayUnknownStates) === JSON.stringify(Array(6).fill('unknown')) && r.trayUnknownText === 'Unknown' && r.trayUnknownGlyphs.every((g) => g === '?'),
    `unavailable counter -> all tiles unknown "?" and "Unknown" (got ${JSON.stringify(r.trayUnknownStates)}, ${r.trayUnknownText}, ${JSON.stringify(r.trayUnknownGlyphs)})`,
  );
  check(r.rawHeader === 'PetSafe' && r.rawContext === 'READ ONLY' && r.rawContextHasNoLocalClaim, `raw header identifies PetSafe read-only context without claiming data provenance (got ${r.rawHeader} / ${r.rawContext})`);
  check(r.rawLogo && r.rawLogoIsSelfContained, 'raw header has an accessible self-contained original card mark with no external resources');
  check(r.rawAvailability === 'Partial data2/3', `raw availability is availability-only (got ${r.rawAvailability})`);
  check(r.rawRows[0] === '<img src=x><script>alert(1)</script>' && r.rawRows[2] === 'sensor.missingMissing', `raw names and states render as literal escaped text (got ${JSON.stringify(r.rawRows)})`);
  check(r.rawNoControls, 'raw mode has no actions, controls, camera, food, tray, or footer');
  check(r.rawWatchedUpdate === 'updated' && r.rawExpanded && r.rawFocusRetained, `raw watched state update preserves expanded panel and focus (state ${r.rawWatchedUpdate}, expanded ${r.rawExpanded}, focus ${r.rawFocusRetained})`);
  check(r.rawSummaryFocusRetained, 'raw watched state update preserves Device data summary keyboard focus');
  check(r.rawNoServiceCalls, 'raw synthetic action/menu calls fail closed without service invocation');
  check(r.rawMoreInfo === 'sensor.example_dp_4', `raw rows open read-only more-info (got ${r.rawMoreInfo})`);
  check(r.rawClassRemovedOnStandard && r.standardAfterRawHasControls, 'switching the same card from raw to standard removes raw styling and restores standard controls');
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

  await page.evaluate(() => {
    const { makeHass } = window.__harness;
    const fixtureIds = [4, 14, 110, 111, 125, 130, 131, 142, 145, 150].map((id) => `sensor.fixture_dp_${id}`);
    const fixtureStates = Object.fromEntries(fixtureIds.map((id, index) => [id, {
      state: 'reported', attributes: { friendly_name: `Device datapoint ${index + 1}` },
    }]));
    for (const theme of ['light', 'dark']) {
      for (const expanded of [false, true]) {
        const cell = document.createElement('div');
        cell.className = `cell theme-${theme}`;
        cell.dataset.shot = `freshfeed-raw-showcase-${theme}-${expanded ? 'expanded' : 'collapsed'}`;
        const card = document.createElement('pet-feeder-card');
        card.setConfig({ model: 'freshfeed', mode: 'raw', raw_entities: fixtureIds });
        card.hass = makeHass(fixtureStates);
        cell.appendChild(card);
        card.shadowRoot.querySelector('.raw-data').open = expanded;
        document.getElementById('grid').appendChild(cell);
      }

      // Keep the unavailable, missing, and long literal edge cases visually covered.
      const edge = document.createElement('div');
      edge.className = `cell theme-${theme}`;
      edge.dataset.shot = `freshfeed-raw-edge-${theme}`;
      const edgeCard = document.createElement('pet-feeder-card');
      edgeCard.setConfig({ model: 'freshfeed', mode: 'raw', raw_entities: ['sensor.example_dp_4', 'binary_sensor.example_dp_110', 'sensor.unavailable', 'sensor.missing', 'sensor.long'] });
      edgeCard.hass = makeHass({
        'sensor.example_dp_4': { state: 'unknown', attributes: { friendly_name: 'Raw DP 4' } },
        'binary_sensor.example_dp_110': { state: 'off', attributes: { friendly_name: 'Door state' } },
        'sensor.unavailable': { state: 'unavailable', attributes: { friendly_name: 'Raw DP unavailable' } },
        'sensor.long': { state: 'a deliberately long literal device value that must wrap without overflow', attributes: { friendly_name: 'Very long raw entity friendly name for narrow screens' } },
      });
      edge.appendChild(edgeCard);
      edgeCard.shadowRoot.querySelector('.raw-data').open = true;
      document.getElementById('grid').appendChild(edge);
    }
  });
  for (const theme of ['light', 'dark']) {
    for (const state of ['collapsed', 'expanded']) {
      const file = path.join(OUT, `freshfeed-raw-showcase-${theme}-${state}.png`);
      await page.locator(`.cell[data-shot="freshfeed-raw-showcase-${theme}-${state}"]`).screenshot({ path: file });
      written.push(file);
    }
    const edgeFile = path.join(OUT, `freshfeed-raw-edge-${theme}.png`);
    await page.locator(`.cell[data-shot="freshfeed-raw-edge-${theme}"]`).screenshot({ path: edgeFile });
    written.push(edgeFile);
  }

  // Narrow card (about half a sections-view column): the chip moves below the art.
  for (const scenario of ['aqara-bowl-full', 'freshfeed-ready-high']) {
    const narrow = await ctx.newPage();
    await narrow.goto(`${BASE}?scenario=${scenario}&narrow=1`);
    await narrow.waitForFunction(() => window.__ready === true);
    if (scenario.startsWith('freshfeed')) {
      // Every compartment tile (and its caption) stays inside the 320px card, and no
      // tile's content is clipped.
      const fit = await narrow.evaluate(() => {
        const card = document.querySelector('.cell.theme-light pet-feeder-card');
        const box = card.shadowRoot.querySelector('ha-card').getBoundingClientRect();
        const inside = (r) => r.left >= box.left && r.right <= box.right && r.top >= box.top && r.bottom <= box.bottom;
        const tiles = [...card.shadowRoot.querySelectorAll('.meal-tile')];
        const caps = [...card.shadowRoot.querySelectorAll('.meal-cap')].filter((c) => c.textContent.trim());
        return {
          cardWidth: Math.round(box.width),
          tiles: tiles.length,
          outside: [...tiles, ...caps].filter((el) => !inside(el.getBoundingClientRect())).length,
          clipped: tiles.filter((t) => t.scrollWidth > t.clientWidth || t.scrollHeight > t.clientHeight).length,
          overlapping: tiles.slice(1).filter((t, i) => t.getBoundingClientRect().left < tiles[i].getBoundingClientRect().right).length,
        };
      });
      check(
        fit.tiles === 6 && fit.outside === 0 && fit.clipped === 0 && fit.overlapping === 0,
        `narrow ${fit.cardWidth}px card: ${fit.tiles} tiles, none outside the card (${fit.outside}), clipped (${fit.clipped}) or overlapping (${fit.overlapping})`,
      );
    }
    const file = path.join(OUT, `extra-narrow-${scenario}-light.png`);
    await narrow.locator('.cell.theme-light').screenshot({ path: file });
    written.push(file);
    await narrow.close();
  }

  const rawNarrow = await ctx.newPage();
  await rawNarrow.goto(`${BASE}?narrow=1`);
  await rawNarrow.waitForFunction(() => window.__ready === true);
  const rawFit = await rawNarrow.evaluate(() => {
    const { makeHass } = window.__harness;
    const cell = document.createElement('div');
    cell.className = 'cell theme-light';
    const card = document.createElement('pet-feeder-card');
    card.setConfig({ model: 'freshfeed', mode: 'raw', raw_entities: ['sensor.long'] });
    card.hass = makeHass({ 'sensor.long': { state: 'a deliberately long literal device value that must wrap without overflow', attributes: { friendly_name: 'Very long raw entity friendly name for narrow screens' } } });
    cell.appendChild(card);
    document.body.appendChild(cell);
    const rows = [...card.shadowRoot.querySelectorAll('.raw-row, .raw-row-name, .raw-row-state')];
    const overflow = rows.some((el) => el.scrollWidth > el.clientWidth || el.getBoundingClientRect().right > card.getBoundingClientRect().right + 1);
    const title = card.shadowRoot.querySelector('.raw-brand .name');
    const logo = card.shadowRoot.querySelector('.raw-logo');
    return {
      overflow,
      width: Math.round(card.getBoundingClientRect().width),
      title: title?.textContent.trim(),
      titleClipped: title ? title.scrollWidth > title.clientWidth : true,
      logoInside: logo ? logo.getBoundingClientRect().right <= card.getBoundingClientRect().right + 1 : false,
    };
  });
  check(!rawFit.overflow && rawFit.title === 'FreshFeed' && !rawFit.titleClipped && rawFit.logoInside, `narrow raw ${rawFit.width}px card keeps the full FreshFeed title and card mark inside without overflow`);
  const rawNarrowFile = path.join(OUT, 'extra-narrow-freshfeed-raw-light.png');
  await rawNarrow.locator('.cell.theme-light').last().screenshot({ path: rawNarrowFile });
  written.push(rawNarrowFile);
  await rawNarrow.close();

  // Representative all-available raw fixture at real card widths, independent of
  // the viewport: each theme gets both collapsed and expanded Device data states.
  const rawWidths = await ctx.newPage();
  await rawWidths.goto(BASE);
  await rawWidths.waitForFunction(() => window.__ready === true);
  const rawWidthFit = await rawWidths.evaluate(() => {
    const { makeHass } = window.__harness;
    const ids = [4, 14, 110, 111, 125, 130, 131, 142, 145, 150].map((id) => `sensor.fixture_dp_${id}`);
    const states = Object.fromEntries(ids.map((id, index) => [id, {
      state: 'reported', attributes: { friendly_name: `Device datapoint ${index + 1}` },
    }]));
    const checks = [];
    for (const width of [320, 400]) {
      for (const theme of ['light', 'dark']) {
        for (const expanded of [false, true]) {
          const cell = document.createElement('div');
          cell.className = `cell theme-${theme}`;
          cell.dataset.shot = `freshfeed-raw-${width}-${theme}-${expanded ? 'expanded' : 'collapsed'}`;
          cell.style.cssText = `width:${width + 40}px;padding:20px;box-sizing:border-box`;
          const card = document.createElement('pet-feeder-card');
          card.setConfig({ model: 'freshfeed', mode: 'raw', raw_entities: ids });
          card.hass = makeHass(states);
          cell.appendChild(card);
          card.shadowRoot.querySelector('.raw-data').open = expanded;
          document.body.appendChild(cell);
          const title = card.shadowRoot.querySelector('.raw-brand .name');
          const names = [...card.shadowRoot.querySelectorAll('.raw-row-name')];
          checks.push({
            width: Math.round(card.getBoundingClientRect().width),
            availability: card.shadowRoot.querySelector('.availability')?.textContent.trim(),
            titleClipped: title.scrollWidth > title.clientWidth,
            namesClipped: names.some((name) => name.scrollWidth > name.clientWidth),
            overflow: card.scrollWidth > card.clientWidth,
          });
        }
      }
    }
    return checks;
  });
  check(rawWidthFit.length === 8 && rawWidthFit.every((fit) => [320, 400].includes(fit.width) && fit.availability === 'Data available10/10' && !fit.titleClipped && !fit.namesClipped && !fit.overflow), `all-available 10/10 raw fixture has the exact Data available label and no clipped names at 320px and 400px cards (${JSON.stringify(rawWidthFit)})`);
  for (const width of [320, 400]) {
    for (const theme of ['light', 'dark']) {
      for (const state of ['collapsed', 'expanded']) {
        const file = path.join(OUT, `freshfeed-raw-${width}-${theme}-${state}.png`);
        await rawWidths.locator(`.cell[data-shot="freshfeed-raw-${width}-${theme}-${state}"]`).screenshot({ path: file });
        written.push(file);
      }
    }
  }
  await rawWidths.close();

  // Synthetic parity acceptance, using only the local mock HA dispatcher.
  for (const width of [1280, 400, 320]) {
    await page.setViewportSize({ width, height: 900 });
    const parity = await page.evaluate(async () => {
      const { makeHass } = window.__harness;
      const card = document.createElement('pet-feeder-card');
      const host = document.createElement('div');
      host.style.cssText = 'width:min(100%,400px);position:fixed;inset:0;z-index:10000';
      document.body.append(host); host.append(card);
      card.setConfig({model:'freshfeed',entities:{},freshfeed:{entry_id:'synthetic',schedule_entity:'s',write_status_entity:'w',quick_feed_entity:'q',history_entity:'h'}});
      const meal = {weekmask:127,hour:8,minute:0,enabled:true,audible:true};
      const states = {s:{state:'1',attributes:{entries:[meal],source_state:'last_known',revision:'r1',observed_at:'2026-11-12T08:00:00Z'}},w:{state:'idle',attributes:{}},h:{state:'1',attributes:{basis:'ha_observed',events:[{kind:'dispensed',at:'2026-11-12T08:00:00Z',source_dp:145,compartment:2}],dp151_supported:false}}};
      card.hass = makeHass(states); await card._openControls();
      const button = label => [...card.shadowRoot.querySelectorAll('button')].find(b=>b.textContent===label);
      const click = async label => {button(label).click();await Promise.resolve();};
      await click('Add meal'); await click('Sun');
      const time = card.shadowRoot.querySelector('input[type=time]');
      time.value='09:30';time.dispatchEvent(new Event('input'));time.focus();
      states.s = {...states.s,attributes:{...states.s.attributes,revision:'r2'}};
      card.hass=makeHass(states);
      const preserved = card.shadowRoot.activeElement===time && card._dialog.freshfeed.draft.entries[0].hour===9 && button('Save').disabled;
      const lastSeen=card.shadowRoot.textContent.includes('last seen');
      const historyRendered=card.shadowRoot.textContent.includes('HA-observed history') && card.shadowRoot.textContent.includes('Meal dispensed (observed) (DP145)');
      const overlay=card._dialog.el;
      const draft=card._dialog.freshfeed.draft;
      const draftValues=JSON.stringify(draft);
      window.__calls=[];
      // Both moves happen in one task; the browser owns disconnect/reconnect callbacks.
      host.removeChild(card); document.body.append(card); host.append(card);
      await Promise.resolve();
      await new Promise(resolve => requestAnimationFrame(resolve));
      const sameOverlayAfterReconnect=card._dialog.el===overlay && card.shadowRoot.querySelector('.overlay')===overlay;
      const uniqueOverlayAfterReconnect=card.shadowRoot.querySelectorAll('.overlay').length===1;
      const uniqueRecoveryAfterReconnect=card.shadowRoot.querySelectorAll('[data-recover]').length===1;
      const draftAfterReconnect=card._dialog.freshfeed.draft===draft && JSON.stringify(draft)===draftValues;
      const focusAfterReconnect=card.shadowRoot.activeElement===time && time.value==='09:30';
      const safeAfterReconnect=window.__calls.every(c=>c.domain==='petsafe_freshfeed');
      await click('Cancel'); await click('Add meal');
      const addedTime=card.shadowRoot.querySelectorAll('input[type=time]')[1];
      addedTime.value='13:17';addedTime.dispatchEvent(new Event('input'));
      [...card.shadowRoot.querySelectorAll('button')].filter(b=>b.textContent==='Delete')[1].click();
      const selectedDeletion=JSON.stringify(card._dialog.freshfeed.draft.entries)===JSON.stringify([meal]);
      window.__calls=[]; await click('Save');
      const exact = JSON.stringify(window.__calls[0]?.data)===JSON.stringify({entry_id:'synthetic',entries:[meal],base_revision:'r2'});
      const safe = window.__calls.every(c=>c.domain==='petsafe_freshfeed');
      while(card._dialog.freshfeed.draft.entries.length<10) await click('Add meal');
      const tenMealCap=button('Add meal').disabled;
      await click('Add meal');
      const noEleventhMeal=card._dialog.freshfeed.draft.entries.length===10;
      const panel=card.shadowRoot.querySelector('.panel');
      const rect=panel.getBoundingClientRect();
      const fit=rect.left>=0 && rect.right<=innerWidth && panel.scrollWidth<=panel.clientWidth;
      states.w={state:'pending',attributes:{}};card.hass=makeHass(states);
      const pending=button('Save').disabled;
      states.w={state:'uncertain',attributes:{operation_id:'op',session_id:'session',recovery_phase:'awaiting_user_confirmation',recovery_can_start:true}};card.hass=makeHass(states);
      const recover=!button('Check and clear uncertainty').disabled;
      const originalConfirm=window.confirm; window.confirm=()=>true;
      await click('Check and clear uncertainty'); window.confirm=originalConfirm;
      const recoveryCall=window.__calls.at(-1);
      const exactRecovery=recoveryCall?.service==='recover' && JSON.stringify(recoveryCall.data)===JSON.stringify({entry_id:'synthetic',operation_id:'op',session_id:'session',confirmed:true});
      const scrollable=panel.scrollHeight>panel.clientHeight && ['auto','scroll'].includes(getComputedStyle(panel).overflowY);
      button('Save').scrollIntoView();
      const saveRect=button('Save').getBoundingClientRect();
      const reachable=saveRect.top>=0 && saveRect.bottom<=innerHeight;
      states.w.attributes.recovery_phase='collecting';card.hass=makeHass(states);
      const collecting=card.shadowRoot.textContent.includes('Waiting for device reports');
      const cancel=card.shadowRoot.querySelector('[data-cancel-countdown]');
      states.q={state:'pending',attributes:{minutes:0}}; states.w={state:'idle',attributes:{can_cancel:true}}; card.hass=makeHass(states);
      const countdownPending=!cancel.hidden && !cancel.disabled && card.shadowRoot.textContent.includes('0 minutes; waiting for status');
      const countdownPendingFit=panel.scrollWidth<=panel.clientWidth;
      states.w={state:'uncertain',attributes:{can_cancel:true}}; card.hass=makeHass(states);
      const countdownUncertain=!cancel.hidden && cancel.disabled;
      const countdownUncertainFit=panel.scrollWidth<=panel.clientWidth;
      states.q={state:'unknown',attributes:{minutes:255}}; card.hass=makeHass(states);
      const countdownUnknown=cancel.hidden && card.shadowRoot.querySelector('[data-quick-status]').textContent==='Unknown';
      const countdownUnknownFit=panel.scrollWidth<=panel.clientWidth;
      window.__parityHost=host;
      return {countdownPending,countdownPendingFit,countdownUncertain,countdownUncertainFit,countdownUnknown,countdownUnknownFit,preserved,lastSeen,historyRendered,sameOverlayAfterReconnect,uniqueOverlayAfterReconnect,uniqueRecoveryAfterReconnect,draftAfterReconnect,focusAfterReconnect,safeAfterReconnect,selectedDeletion,exact,safe,tenMealCap,noEleventhMeal,fit,pending,recover,exactRecovery,scrollable,reachable,collecting};
    });
    for (const [name, result] of Object.entries(parity)) check(result, `parity ${width}px ${name}`);
    const file = `parity-${width}.png`;
    await page.screenshot({path:path.join(OUT,file)});written.push(file);
    await page.evaluate(()=>window.__parityHost.remove());
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
  try {
    if (browser) await browser.close();
  } finally {
    if (server.listening) await new Promise((resolve) => server.close(resolve));
  }
}

if (failures.length) {
  console.error(`\n${failures.length} check(s) failed`);
  process.exit(1);
}
console.log('\nall checks passed');
