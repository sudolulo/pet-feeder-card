// Real-browser layout and focus checks for the pet-feeder-card controls dialogs.
//
// Serves the project over a throwaway local HTTP server, opens the existing
// mock-hass harness (harness/index.html) in Playwright's Chromium, and checks the
// generic and FreshFeed dialogs at narrow and short viewports, including a
// 200%-zoom equivalent (CSS zoom on the document at a 640x512 viewport). This
// changes layout rather than merely increasing pixel density. Every service call
// goes to the harness's fake hass.callService; any
// request that is not a GET to the local server fails the run. Exits non-zero on
// any failed check or page error. Writes no files.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript' };

const server = http.createServer(async (req, res) => {
  const file = path.join(ROOT, decodeURIComponent(new URL(req.url, 'http://x').pathname));
  if (!file.startsWith(ROOT + path.sep)) { res.writeHead(403).end(); return; }
  try {
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' }).end(await readFile(file));
  } catch (err) {
    res.writeHead(err.code === 'ENOENT' ? 404 : 500).end(String(err.code));
  }
});

const failures = [];
const check = (ok, what) => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${what}`);
  if (!ok) failures.push(what);
};

const VIEWPORTS = [
  { name: '320x568', width: 320, height: 568, deviceScaleFactor: 1 },
  { name: '320x256', width: 320, height: 256, deviceScaleFactor: 1 },
  { name: '640x512@200% layout zoom', width: 640, height: 512, deviceScaleFactor: 1, zoom: 2 },
];
const LONG_FAILURE = `${'Die Anfrage konnte nicht bestaetigt werden. '.repeat(6)}Geraetestatusueberpruefungsanforderungsbestaetigungsnachricht${'X'.repeat(80)}`;

// Runs in the page: builds one card with a ten-meal schedule, opens its dialog
// and reports geometry. `kind` is 'freshfeed' or 'generic'.
async function openFixture({ kind, longFailure, scrolledPage = false }) {
  const h = window.__harness;
  document.getElementById('grid').replaceChildren();
  // The harness call log prints unbroken JSON; it is not part of the card.
  document.getElementById('log').style.display = 'none';
  document.getElementById('host')?.remove();
  window.__calls.length = 0;
  const host = document.createElement('div');
  host.id = 'host';
  host.className = 'theme-light';
  document.body.prepend(host);
  const states = h.parityStates('idle');
  states['sensor.demo_schedule'] = {
    ...states['sensor.demo_schedule'],
    attributes: {
      ...states['sensor.demo_schedule'].attributes,
      entries: Array.from({ length: 10 }, (_, i) => ({ weekmask: 127, hour: 6 + i, minute: 15, enabled: true, audible: i % 2 === 0 })),
    },
  };
  const hass = h.makeHass(states);
  const fake = hass.callService;
  hass.callService = (...args) => { fake(...args); return Promise.reject({ translation_key: 'storage_fault' }); };
  const config = structuredClone(kind === 'freshfeed' ? h.parityConfig : h.ffConfig);
  if (kind === 'generic') config.controls = Array.from({ length: 12 }, (_, i) => `input_select.long_control_${i}`);
  const card = document.createElement('pet-feeder-card');
  card.setConfig(config);
  card.hass = hass;
  host.append(card);
  window.card = card;
  const menu = card.shadowRoot.querySelector('.round.menu');
  menu.focus();
  if (scrolledPage) {
    host.style.marginTop = '600px';
    document.body.style.minHeight = '1600px';
    window.scrollTo(0, host.getBoundingClientRect().top + window.scrollY + 100);
  }
  menu.click();
  await card._dialogOpening;
  if (kind === 'freshfeed') {
    card.shadowRoot.querySelector('[data-save]').click();
    await new Promise(resolve => setTimeout(resolve, 20));
    if (longFailure) { card._dialog.freshfeed.error = longFailure; card._updateFreshfeedStatus(); }
  }
  if (longFailure) { card._freshfeedCommandError = longFailure; card._render(); }
  if (scrolledPage) window.scrollTo(0, card.getBoundingClientRect().top + window.scrollY + 100);
  return true;
}

function measure() {
  const vw = document.documentElement.clientWidth;
  const vh = window.innerHeight;
  const card = window.card;
  const sr = card.shadowRoot;
  const ov = sr.querySelector('.overlay');
  const panel = ov.querySelector('.panel');
  const rect = (el) => { const r = el.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height }; };
  const deepAt = (x, y) => {
    let el = document.elementFromPoint(x, y);
    while (el?.shadowRoot) { const inner = el.shadowRoot.elementFromPoint(x, y); if (!inner || inner === el) break; el = inner; }
    return el;
  };
  const visibleAt = (el) => { const r = el.getBoundingClientRect(); return deepAt(r.left + r.width / 2, r.top + r.height / 2) === el || el.contains(deepAt(r.left + r.width / 2, r.top + r.height / 2)); };
  const out = {
    pageScrollWidth: document.documentElement.scrollWidth, pageClientWidth: vw,
    pageWide: [...document.querySelectorAll('body *'), ...sr.querySelectorAll('*')].filter(el => el.getBoundingClientRect().right > vw + 0.5).map(el => el.localName + (el.className ? `.${el.className}` : '')).slice(0, 5),
    viewport: { width: window.innerWidth, height: vh },
    zoom: Number(getComputedStyle(document.documentElement).zoom),
    layoutWidth: document.body.getBoundingClientRect().width / Number(getComputedStyle(document.documentElement).zoom),
    panel: rect(panel),
    panelScrollWidth: panel.scrollWidth, panelClientWidth: panel.clientWidth,
    panelScrollHeight: panel.scrollHeight, panelClientHeight: panel.clientHeight,
    panelOverflowY: getComputedStyle(panel).overflowY,
    dayBoxes: [...panel.querySelectorAll('fieldset button[aria-pressed]')].map(rect),
    overflowing: [...panel.querySelectorAll('*')].filter(el => { const r = el.getBoundingClientRect(); return r.width && (r.right > panel.getBoundingClientRect().right + 0.5 || r.left < panel.getBoundingClientRect().left - 0.5); }).map(el => el.localName + (el.className ? `.${el.className}` : '')).slice(0, 5),
  };
  const close = panel.querySelector('[data-close]');
  const title = panel.querySelector('.panel-title');
  out.cardTop = rect(card).top;
  out.top = { close: visibleAt(close), title: visibleAt(title), closeRect: rect(close), titleRect: rect(title) };
  panel.scrollTop = panel.scrollHeight;
  out.scrolled = panel.scrollTop > 0;
  out.bottom = { close: visibleAt(close), title: visibleAt(title), closeRect: rect(close) };
  panel.scrollTop = 0;
  return out;
}

function within(a, b) { return a.left >= b.left - 0.5 && a.right <= b.right + 0.5 && a.top >= b.top - 0.5 && a.bottom <= b.bottom + 0.5; }

let browser;
try {
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const origin = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch();
  for (const viewport of VIEWPORTS) {
    for (const kind of ['freshfeed', 'generic']) {
      for (const longFailure of kind === 'freshfeed' ? [null, LONG_FAILURE] : [LONG_FAILURE]) {
        const label = `${viewport.name} ${kind}${longFailure ? ' long-failure' : ''}`;
        const ctx = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height }, deviceScaleFactor: viewport.deviceScaleFactor });
        const page = await ctx.newPage();
        const errors = [];
        const foreign = [];
        page.on('pageerror', e => errors.push(String(e)));
        page.on('console', m => { if (m.type() === 'error') errors.push(`console.error: ${m.text()}`); });
        page.on('request', r => { if (!r.url().startsWith(`${origin}/`) || r.method() !== 'GET') foreign.push(`${r.method()} ${r.url()}`); });
        try {
          await page.goto(`${origin}/harness/index.html?scenario=__none__`);
          await page.waitForFunction(() => window.__ready === true);
          if (viewport.zoom) await page.evaluate(zoom => { document.documentElement.style.zoom = zoom; }, viewport.zoom);
          await page.evaluate(openFixture, { kind, longFailure });
          const m = await page.evaluate(measure);
          if (viewport.zoom) check(m.zoom === viewport.zoom && m.layoutWidth <= viewport.width / viewport.zoom, `${label}: 200% layout zoom reduces CSS layout width to ${m.layoutWidth}`);
          check(m.pageScrollWidth <= m.pageClientWidth, `${label}: no horizontal page overflow (scrollWidth ${m.pageScrollWidth}, clientWidth ${m.pageClientWidth}; ${m.pageWide.join(', ')})`);
          check(m.panelScrollWidth <= m.panelClientWidth, `${label}: no horizontal dialog overflow (${m.panelScrollWidth} > ${m.panelClientWidth}; ${m.overflowing.join(', ')})`);
          check(within(m.panel, { left: 0, top: 0, right: m.viewport.width, bottom: m.viewport.height }), `${label}: dialog within viewport ${JSON.stringify(m.panel)}`);
          check(m.panelOverflowY === 'auto' && m.panelScrollHeight > m.panelClientHeight && m.scrolled, `${label}: dialog body scrolls internally (${m.panelScrollHeight}/${m.panelClientHeight})`);
          check(m.top.close && m.top.title, `${label}: close and title reachable before scrolling`);
          check(m.bottom.close && m.bottom.title && within(m.bottom.closeRect, m.panel), `${label}: sticky close and title reachable after scrolling`);
          if (kind === 'freshfeed') {
            check(m.dayBoxes.length === 70, `${label}: ten meals render seventy day toggles (got ${m.dayBoxes.length})`);
            const small = m.dayBoxes.filter(b => b.width / m.zoom < 44 || b.height / m.zoom < 44);
            check(small.length === 0, `${label}: day toggles are at least 44x44 (${small.length} smaller, e.g. ${JSON.stringify(small[0] || null)})`);
          }
          // Keyboard focus never leaks to inert card controls or out of the dialog.
          const leaks = [];
          for (let i = 0; i < 200; i++) {
            await page.keyboard.press(i % 7 === 6 ? 'Shift+Tab' : 'Tab');
            const where = await page.evaluate(() => {
              let a = document.activeElement;
              while (a?.shadowRoot?.activeElement) a = a.shadowRoot.activeElement;
              const panel = window.card.shadowRoot.querySelector('.overlay .panel');
              let inside = false;
              let inert = false;
              for (let n = a; n; n = n.parentNode || n.host) { if (n === panel) inside = true; if (n.inert) inert = true; }
              return { inside, inert, label: a?.getAttribute?.('aria-label') || a?.textContent?.trim().slice(0, 30) || a?.localName };
            });
            if (!where.inside || where.inert) leaks.push(where.label);
          }
          check(leaks.length === 0, `${label}: 200 Tab/Shift+Tab presses stay inside the dialog (${leaks.slice(0, 3).join(', ')})`);
          const calls = await page.evaluate(() => window.__calls.map(c => `${c.domain}.${c.service}`));
          const expected = kind === 'freshfeed' ? ['petsafe_freshfeed.save_schedule'] : [];
          check(JSON.stringify(calls) === JSON.stringify(expected), `${label}: only fake hass.callService used (${JSON.stringify(calls)})`);
          check(foreign.length === 0, `${label}: no request beyond local GETs (${foreign.join(', ')})`);
          check(errors.length === 0, `${label}: no page errors (${errors.join(' | ')})`);
        } catch (err) {
          check(false, `${label}: ${err.message}`);
        } finally {
          await ctx.close();
        }
      }
    }
  }
  // A card partly above the viewport must not take its dialog header with it.
  for (const kind of ['freshfeed', 'generic']) {
    const ctx = await browser.newContext({ viewport: { width: 320, height: 568 } });
    const page = await ctx.newPage();
    try {
      await page.goto(`${origin}/harness/index.html?scenario=__none__`);
      await page.waitForFunction(() => window.__ready === true);
      await page.evaluate(openFixture, { kind, longFailure: null, scrolledPage: true });
      const m = await page.evaluate(measure);
      const viewport = { left: 0, top: 0, right: m.viewport.width, bottom: m.viewport.height };
      check(m.cardTop < 0, `${kind} scrolled page: card is partly above viewport (${m.cardTop})`);
      check(within(m.panel, viewport), `${kind} scrolled page: dialog within viewport ${JSON.stringify(m.panel)}`);
      check(m.top.close && m.top.title && within(m.top.closeRect, viewport) && within(m.top.titleRect, viewport), `${kind} scrolled page: close and title reachable`);
      check(m.bottom.close && m.bottom.title && within(m.bottom.closeRect, viewport), `${kind} scrolled page: sticky header reachable after dialog scroll`);
    } catch (err) {
      check(false, `${kind} scrolled page: ${err.message}`);
    } finally {
      await ctx.close();
    }
  }
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}

console.log(failures.length ? `\n${failures.length} check(s) failed` : '\nAll accessibility checks passed');
process.exit(failures.length ? 1 : 0);
