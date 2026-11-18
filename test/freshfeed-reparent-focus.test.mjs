import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright';

// Exercise native focus removal, keyboard navigation and custom-element
// callbacks in a real browser, not a DOM double. Every fixture uses the
// harness's fake hass; no request leaves the local static server.
let server;
let browser;
let base;

test.before(async () => {
  server = http.createServer(async (req, res) => {
    try {
      const path = new URL(req.url, 'http://localhost').pathname;
      const data = await readFile(new URL(`..${path}`, import.meta.url));
      res.setHeader('content-type', path.endsWith('.html') ? 'text/html' : 'text/javascript');
      res.end(data);
    } catch { res.writeHead(404).end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch();
});

test.after(async () => {
  await browser?.close();
  if (server) await new Promise(resolve => server.close(resolve));
});

// Page-side helpers, installed after the harness module is ready.
function installHelpers() {
  window.deepActive = () => {
    let active = document.activeElement;
    while (active?.shadowRoot?.activeElement) active = active.shadowRoot.activeElement;
    return active;
  };
  window.within = (outer, node) => {
    for (let n = node; n; n = n.parentNode || n.host) if (n === outer) return true;
    return false;
  };
  window.describe = (el) => {
    const panel = window.card?.shadowRoot?.querySelector('.overlay .panel');
    return {
      label: el?.getAttribute?.('aria-label') || el?.className || el?.textContent?.trim() || el?.localName || null,
      inside: Boolean(panel && window.within(panel, el)),
      isClose: Boolean(el?.matches?.('[data-close]')),
      disabled: Boolean(el?.matches?.(':disabled')),
      hidden: Boolean(el?.closest?.('[hidden]')),
    };
  };
  // HA-like rows that render their controls inside their own shadow root.
  window.useShadowRows = (gate = Promise.resolve()) => {
    window.loadCardHelpers = async () => {
      await gate;
      return {
        createRowElement({ entity }) {
          const row = document.createElement('div');
          row.className = 'test-row';
          row.dataset.entity = entity;
          row.attachShadow({ mode: 'open' }).innerHTML =
            `<span>${entity}</span><button class="row-action" aria-label="act ${entity}">Act</button>` +
            `<button class="row-disabled" disabled>Off</button><button class="row-hidden" hidden>Hidden</button>` +
            `<span style="display:none"><button class="row-undisplayed">Gone</button></span>` +
            `<input class="row-input" aria-label="value ${entity}">`;
          return row;
        },
      };
    };
  };
  window.mount = ({ kind, phase = 'idle', rows = 'shadow', gate } = {}) => {
    const h = window.__harness;
    if (rows === 'shadow') window.useShadowRows(gate);
    document.getElementById('grid').replaceChildren();
    document.getElementById('host')?.remove();
    document.getElementById('outside')?.remove();
    const host = document.createElement('div');
    host.id = 'host';
    document.body.append(host);
    const outside = document.createElement('button');
    outside.id = 'outside'; outside.textContent = 'outside';
    document.body.append(outside);
    const card = document.createElement('pet-feeder-card');
    window.configFor = () => structuredClone(kind === 'freshfeed' ? h.parityConfig : h.ffConfig);
    window.statesFor = () => (kind === 'freshfeed' ? h.parityStates(phase) : h.ffStates({ status: 'standby', food: 'high' }));
    card.setConfig(window.configFor());
    card.hass = h.makeHass(window.statesFor());
    host.append(card);
    window.card = card;
    window.host = host;
    return true;
  };
  window.menu = () => window.card.shadowRoot.querySelector('.round.menu');
  window.openViaMenu = async () => {
    const menu = window.menu();
    menu.focus();
    menu.click();
    await window.card._dialogOpening;
    await Promise.resolve();
    window.opener = menu;
  };
  window.overlay = () => window.card.shadowRoot.querySelector('.overlay');
  // Count dialog listeners on overlays and the document to prove teardown.
  window.liveListeners = new Set();
  window.peakListeners = 0;
  const add = EventTarget.prototype.addEventListener;
  const remove = EventTarget.prototype.removeEventListener;
  const watched = (target, type) => ['keydown', 'focusout'].includes(type) && (target === document || target?.classList?.contains('overlay'));
  EventTarget.prototype.addEventListener = function (type, fn, ...rest) {
    if (watched(this, type)) { window.liveListeners.add(fn); window.peakListeners = Math.max(window.peakListeners, window.liveListeners.size); }
    return add.call(this, type, fn, ...rest);
  };
  EventTarget.prototype.removeEventListener = function (type, fn, ...rest) {
    if (watched(this, type)) window.liveListeners.delete(fn);
    return remove.call(this, type, fn, ...rest);
  };
}

async function newPage() {
  const page = await browser.newPage();
  const requests = [];
  page.on('request', request => requests.push(request.url()));
  await page.goto(`${base}/harness/index.html?scenario=__none__`);
  await page.waitForFunction(() => window.__ready);
  await page.evaluate(installHelpers);
  page.requests = requests;
  return page;
}

async function pressAndDescribe(page, key) {
  await page.keyboard.press(key);
  await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 0)));
  return page.evaluate(() => window.describe(window.deepActive()));
}

function assertLocalOnly(page) {
  for (const url of page.requests) assert.ok(url.startsWith(`${base}/`), `unexpected request ${url}`);
}

test('same-task reparent restores editor focus without stealing deliberate outside focus', async () => {
  const page = await newPage();
  try {
    const result = await page.evaluate(async () => {
      const { parityConfig, parityStates, makeHass } = window.__harness;
      const host = document.createElement('div'); document.body.append(host);
      const outside = document.createElement('button'); document.body.append(outside);
      const card = document.createElement('pet-feeder-card');
      card.setConfig(structuredClone(parityConfig)); card.hass = makeHass(parityStates()); host.append(card);
      await card._openControls();
      const input = card.shadowRoot.querySelector('input[type=time]');
      input.focus(); host.removeChild(card); host.appendChild(card);
      const restored = card.shadowRoot.activeElement === input;
      await Promise.resolve();
      host.removeChild(card); host.appendChild(card);
      const restoredAgain = card.shadowRoot.activeElement === input;
      input.focus(); outside.focus(); host.removeChild(card); host.appendChild(card);
      const outsideRetained = document.activeElement === outside;
      input.focus(); host.removeChild(card); outside.focus(); host.appendChild(card);
      const outsideDuringMoveRetained = document.activeElement === outside;
      input.focus(); host.removeChild(card); await new Promise(resolve => setTimeout(resolve, 10)); host.appendChild(card);
      const genuineDisconnectCleared = card.shadowRoot.activeElement !== input && !card._dialog;
      card.remove(); host.remove(); outside.remove();
      return { restored, restoredAgain, outsideRetained, outsideDuringMoveRetained, genuineDisconnectCleared };
    });
    assert.deepEqual(result, { restored: true, restoredAgain: true, outsideRetained: true, outsideDuringMoveRetained: true, genuineDisconnectCleared: true });
  } finally { await page.close(); }
});

for (const kind of ['generic', 'freshfeed']) {
  test(`dialog_has_label_modal_and_initial_focus (${kind})`, async () => {
    const page = await newPage();
    try {
      const result = await page.evaluate(async kind => {
        window.mount({ kind });
        await window.openViaMenu();
        const sr = window.card.shadowRoot;
        const ov = window.overlay();
        const panel = ov.querySelector('.panel');
        const titleId = panel.getAttribute('aria-labelledby');
        const title = titleId ? sr.getElementById(titleId) : null;
        const root = sr.querySelector('ha-card');
        const others = [...root.children].filter(child => child !== ov);
        return {
          role: panel.getAttribute('role'),
          modal: panel.getAttribute('aria-modal'),
          title: title?.textContent,
          titleInPanel: Boolean(title && panel.contains(title) && title.getClientRects().length),
          focusInside: window.within(panel, window.deepActive()),
          otherCount: others.length > 0,
          othersInert: others.every(child => child.inert),
          dialogInert: ov.inert || panel.inert || root.inert || window.card.inert,
        };
      }, kind);
      assert.deepEqual(result, { role: 'dialog', modal: 'true', title: 'FreshFeed controls', titleInPanel: true, focusInside: true, otherCount: true, othersInert: true, dialogInert: false });
      assertLocalOnly(page);
    } finally { await page.close(); }
  });
}

for (const [kind, phase] of [['generic', 'idle'], ['freshfeed', 'idle'], ['freshfeed', 'awaiting_user_confirmation']]) {
  test(`tab_wraps_both_directions_including_shadow_row (${kind}, ${phase})`, async () => {
    const page = await newPage();
    try {
      const saveDisabled = await page.evaluate(async ({ kind, phase }) => {
        window.mount({ kind, phase });
        await window.openViaMenu();
        window.overlay().querySelector('[data-close]').focus();
        return window.overlay().querySelector('[data-save]')?.disabled ?? null;
      }, { kind, phase });
      if (phase !== 'idle') assert.equal(saveDisabled, true, 'fixture must render a disabled Save');
      const forward = [];
      for (let i = 0; i < 120; i++) {
        const info = await pressAndDescribe(page, 'Tab');
        forward.push(info);
        if (info.isClose) break;
      }
      assert.equal(forward.at(-1)?.isClose, true, `Tab did not wrap to Close: ${JSON.stringify(forward.map(f => f.label))}`);
      for (const info of forward) {
        assert.equal(info.inside, true, `focus left the dialog at ${info.label}`);
        assert.equal(info.disabled, false, `disabled ${info.label} focused`);
        assert.equal(info.hidden, false, `hidden ${info.label} focused`);
      }
      const labels = forward.map(f => f.label);
      assert.ok(labels.some(l => /^act /.test(l)), 'row shadow button reached');
      assert.ok(labels.some(l => /^value /.test(l)), 'row shadow input reached');
      assert.ok(!labels.some(l => /row-(disabled|hidden|undisplayed)/.test(l)), 'unavailable row controls skipped');
      if (saveDisabled) assert.ok(!labels.includes('Save'), 'disabled Save skipped');
      const lastBeforeWrap = forward.at(-2);
      const back = await pressAndDescribe(page, 'Shift+Tab');
      assert.deepEqual(back, lastBeforeWrap, 'Shift+Tab from Close wraps to the last control');
      const forwardAgain = await pressAndDescribe(page, 'Tab');
      assert.equal(forwardAgain.isClose, true, 'Tab from the last control wraps to Close');
      assertLocalOnly(page);
    } finally { await page.close(); }
  });
}

test('tab_wraps_both_directions_including_shadow_row (zero focusable children)', async () => {
  const page = await newPage();
  try {
    await page.evaluate(async () => {
      window.mount({ kind: 'generic', rows: 'plain' });
      await window.openViaMenu();
    });
    let info = await pressAndDescribe(page, 'Tab');
    assert.equal(info.isClose, true, 'only Close is focusable: Tab stays on it');
    info = await pressAndDescribe(page, 'Shift+Tab');
    assert.equal(info.isClose, true, 'only Close is focusable: Shift+Tab stays on it');
    const panelFocused = await page.evaluate(() => {
      const panel = window.overlay().querySelector('.panel');
      panel.querySelector('[data-close]').remove();
      panel.focus();
      return window.deepActive() === panel;
    });
    assert.equal(panelFocused, true);
    for (const key of ['Tab', 'Shift+Tab']) {
      await page.keyboard.press(key);
      assert.equal(await page.evaluate(() => window.deepActive() === window.overlay().querySelector('.panel')), true, `${key} with no focusable control keeps focus on the dialog`);
    }
    await page.keyboard.press('Escape');
    assert.equal(await page.evaluate(() => window.overlay() === null), true);
  } finally { await page.close(); }
});

for (const kind of ['generic', 'freshfeed']) {
  test(`escape_and_backdrop_restore_connected_opener (${kind})`, async () => {
    const page = await newPage();
    try {
      await page.evaluate(async kind => { window.mount({ kind }); await window.openViaMenu(); }, kind);
      await page.keyboard.press('Escape');
      let state = await page.evaluate(() => ({ closed: window.overlay() === null, onMenu: window.deepActive() === window.menu() && window.menu().isConnected }));
      assert.deepEqual(state, { closed: true, onMenu: true }, 'Escape closes and restores the opener');

      await page.evaluate(() => window.openViaMenu());
      const box = await page.evaluate(() => { const r = window.overlay().getBoundingClientRect(); return { x: r.left + 4, y: r.top + 4 }; });
      await page.mouse.click(box.x, box.y);
      state = await page.evaluate(() => ({ closed: window.overlay() === null, onMenu: window.deepActive() === window.menu() && window.menu().isConnected }));
      assert.deepEqual(state, { closed: true, onMenu: true }, 'backdrop closes and restores the opener');

      // The opener is replaced by a re-render while the dialog is open.
      const replaced = await page.evaluate(async () => {
        await window.openViaMenu();
        const opener = window.menu();
        const states = window.statesFor();
        const statusId = window.configFor().entities.status;
        states[statusId] = { ...states[statusId], state: 'feeding' };
        window.card.hass = window.__harness.makeHass(states);
        window.card._render();
        window.originalOpener = opener;
        return opener.isConnected;
      });
      // Generic dialogs re-render the card behind them; FreshFeed keeps the card
      // and re-renders it on close, so either way the original opener is gone.
      if (kind === 'generic') assert.equal(replaced, false, 'generic re-render replaced the opener');
      await page.keyboard.press('Escape');
      state = await page.evaluate(() => ({ closed: window.overlay() === null, onMenu: window.deepActive() === window.menu() && window.menu().isConnected, replacedOpener: window.menu() !== window.originalOpener && !window.originalOpener.isConnected }));
      assert.deepEqual(state, { closed: true, onMenu: true, replacedOpener: true }, 'restores the current menu after re-render');

      // Closing never steals focus that is outside the dialog (an editor calling
      // setConfig, or an HA more-info dialog).
      const kept = await page.evaluate(async () => {
        await window.openViaMenu();
        document.getElementById('outside').focus();
        window.card.setConfig(window.configFor());
        const afterSetConfig = document.activeElement?.id;
        await window.openViaMenu();
        const more = document.createElement('div');
        more.setAttribute('role', 'dialog');
        more.innerHTML = '<button id="more-close">Close</button>';
        document.body.append(more);
        more.querySelector('button').focus();
        window.card._closeControls();
        const afterClose = document.activeElement?.id;
        more.remove();
        return { afterSetConfig, afterClose };
      });
      assert.deepEqual(kept, { afterSetConfig: 'outside', afterClose: 'more-close' });
      assertLocalOnly(page);
    } finally { await page.close(); }
  });
}

test('escape_and_backdrop_restore_connected_opener (prior inert values restored)', async () => {
  const page = await newPage();
  try {
    await page.evaluate(async () => {
      window.mount({ kind: 'generic' });
      window.card.shadowRoot.querySelector('.footer').inert = true;
      await window.openViaMenu();
    });
    await page.keyboard.press('Escape');
    const state = await page.evaluate(() => {
      const sr = window.card.shadowRoot;
      return { footer: sr.querySelector('.footer').inert, header: sr.querySelector('.header').inert, body: sr.querySelector('.body').inert };
    });
    assert.deepEqual(state, { footer: true, header: false, body: false });
  } finally { await page.close(); }
});

test('escape_and_backdrop_restore_connected_opener (nested more-info keeps keys and focus)', async () => {
  const page = await newPage();
  try {
    await page.evaluate(async () => {
      window.mount({ kind: 'generic' });
      await window.openViaMenu();
      // A nested modal rendered inside the last row's shadow root traps itself.
      const rows = window.overlay().querySelectorAll('.test-row');
      const nested = document.createElement('div');
      nested.setAttribute('role', 'dialog'); nested.setAttribute('aria-modal', 'true');
      nested.innerHTML = '<button class="n1">One</button><button class="n2">Two</button>';
      rows[rows.length - 1].shadowRoot.append(nested);
      // n2 is the last focusable control of the parent dialog and the nested
      // dialog does not call preventDefault: only the parent's nested-dialog rule
      // stops it from wrapping this Tab to its own Close button.
      nested.querySelector('.n2').focus();
    });
    await page.keyboard.press('Tab');
    await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 0)));
    assert.equal(await page.evaluate(() => window.deepActive()?.matches('[data-close]')), false, 'parent trap does not steal Tab from a nested dialog');
    await page.evaluate(() => window.overlay().querySelectorAll('.test-row')[2].shadowRoot.querySelector('.n2').focus());
    await page.keyboard.press('Escape');
    assert.equal(await page.evaluate(() => window.overlay() !== null), true, 'Escape in a nested dialog does not close the parent');

    // HA more-info is opened outside the card by the hass-more-info event.
    await page.evaluate(() => {
      window.addEventListener('hass-more-info', () => {
        const more = document.createElement('div');
        more.id = 'more-info'; more.setAttribute('role', 'dialog');
        more.innerHTML = '<button id="mi1">Close more-info</button><button id="mi2">History</button>';
        document.body.append(more);
        more.querySelector('#mi1').focus();
      }, { once: true });
      window.card._moreInfo('input_select.freshfeed_demo_status');
    });
    await page.keyboard.press('Tab');
    await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 0)));
    assert.equal(await page.evaluate(() => window.deepActive()?.id), 'mi2', 'more-info keeps Tab focus');
    await page.keyboard.press('Escape');
    const state = await page.evaluate(() => ({ open: window.overlay() !== null, active: window.deepActive()?.id }));
    assert.deepEqual(state, { open: true, active: 'mi2' }, 'Escape in more-info does not close or refocus the card dialog');
  } finally { await page.close(); }
});

for (const kind of ['generic', 'freshfeed']) {
  test(`config_change_disconnect_and_stale_async_open_cleanup_once (${kind})`, async () => {
    const page = await newPage();
    try {
      const result = await page.evaluate(async kind => {
        const out = {};
        const inertChildren = () => [...window.card.shadowRoot.querySelector('ha-card').children].filter(child => child.inert).length;
        let menuFocuses = 0;

        // setConfig while open cleans up once and does not leave listeners.
        window.mount({ kind });
        window.card.shadowRoot.addEventListener('focusin', (ev) => { if (ev.composedPath()[0].matches?.('.round.menu')) menuFocuses++; });
        await window.openViaMenu();
        const panel = window.overlay().querySelector('.panel');
        menuFocuses = 0;
        window.card.setConfig(window.configFor());
        window.card._closeControls();
        window.card._closeControls();
        const tab = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, composed: true, cancelable: true });
        panel.dispatchEvent(tab);
        out.setConfig = { overlay: window.overlay() === null, inert: inertChildren(), rows: window.card._dialogRows.length, restored: menuFocuses, listenerGone: !tab.defaultPrevented, liveListeners: window.liveListeners.size, sawListeners: window.peakListeners > 0 };

        // A stale open resolving after setConfig attaches nothing and moves no focus.
        let release;
        window.mount({ kind, gate: new Promise(resolve => { release = resolve; }) });
        window.menu().focus();
        window.menu().click();
        const opening = window.card._dialogOpening;
        window.card.setConfig(window.configFor());
        document.getElementById('outside').focus();
        release();
        await opening; await new Promise(resolve => setTimeout(resolve, 10));
        out.staleSetConfig = { overlay: window.overlay() === null, inert: inertChildren(), outside: document.activeElement?.id };

        // A stale open resolving after a genuine disconnect.
        window.mount({ kind, gate: new Promise(resolve => { release = resolve; }) });
        window.menu().focus();
        window.menu().click();
        const pending = window.card._dialogOpening;
        window.card.remove();
        await new Promise(resolve => setTimeout(resolve, 10));
        release();
        await pending; await new Promise(resolve => setTimeout(resolve, 10));
        window.host.append(window.card);
        out.staleDisconnect = { overlay: window.overlay() === null, inert: inertChildren(), menuInert: window.menu().inert };

        // Genuine disconnect while open restores inert and does not refocus.
        window.mount({ kind });
        await window.openViaMenu();
        window.card.remove();
        await new Promise(resolve => setTimeout(resolve, 10));
        window.card._closeControls();
        out.disconnect = { overlay: window.overlay() === null, inert: inertChildren(), active: document.activeElement === document.body };
        window.host.append(window.card);
        out.reconnected = { overlay: window.overlay() === null, inert: inertChildren() };
        return out;
      }, kind);
      assert.deepEqual(result, {
        setConfig: { overlay: true, inert: 0, rows: 0, restored: 1, listenerGone: true, liveListeners: 0, sawListeners: true },
        staleSetConfig: { overlay: true, inert: 0, outside: 'outside' },
        staleDisconnect: { overlay: true, inert: 0, menuInert: false },
        disconnect: { overlay: true, inert: 0, active: true },
        reconnected: { overlay: true, inert: 0 },
      });
      assertLocalOnly(page);
    } finally { await page.close(); }
  });
}

test('reparent_keeps_focus_and_draft (freshfeed)', async () => {
  const page = await newPage();
  try {
    const result = await page.evaluate(async () => {
      window.mount({ kind: 'freshfeed' });
      await window.openViaMenu();
      const ov = window.overlay();
      const input = ov.querySelector('input[type=time]');
      input.value = '09:30'; input.dispatchEvent(new Event('input', { bubbles: true }));
      ov.querySelector('[aria-label="Mon meal 1"]').click();
      input.focus();
      window.host.removeChild(window.card); window.host.appendChild(window.card);
      const root = window.card.shadowRoot.querySelector('ha-card');
      const out = {
        focus: window.deepActive() === input,
        sameOverlay: window.overlay() === ov,
        modal: ov.querySelector('.panel').getAttribute('aria-modal'),
        inert: [...root.children].filter(child => child !== ov).every(child => child.inert),
        draft: window.card._dialog.freshfeed.draft.entries[0],
      };
      // Periodic ticks and hass updates do not replace the focused input.
      window.card._render();
      const states = window.statesFor();
      states['sensor.demo_write'] = { ...states['sensor.demo_write'] };
      window.card.hass = window.__harness.makeHass(states);
      out.afterUpdate = { focus: window.deepActive() === input, connected: input.isConnected, value: input.value };
      // A move that spans a microtask (but not a task) is still a reparent.
      input.focus();
      window.host.removeChild(window.card);
      await Promise.resolve();
      window.host.appendChild(window.card);
      await Promise.resolve();
      out.microtaskGap = {
        focus: window.deepActive() === input,
        sameOverlay: window.overlay() === ov,
        inert: [...root.children].filter(child => child !== ov).every(child => child.inert),
        weekmask: window.card._dialog?.freshfeed.draft.entries[0].weekmask,
      };
      return out;
    });
    assert.deepEqual(result, {
      focus: true, sameOverlay: true, modal: 'true', inert: true,
      draft: { weekmask: 63, hour: 9, minute: 30, enabled: true, audible: true },
      afterUpdate: { focus: true, connected: true, value: '09:30' },
      microtaskGap: { focus: true, sameOverlay: true, inert: true, weekmask: 63 },
    });
  } finally { await page.close(); }
});

test('focus_dropped_by_removed_or_disabled_control_stays_in_dialog (freshfeed)', async () => {
  const page = await newPage();
  try {
    const inside = () => page.evaluate(() => window.within(window.overlay().querySelector('.panel'), window.deepActive()));
    await page.evaluate(async () => {
      window.mount({ kind: 'freshfeed' });
      await window.openViaMenu();
      [...window.overlay().querySelectorAll('[data-actions] button')].find(b => b.textContent === 'Add meal').focus();
    });
    // Add meal re-renders the editor, removing the focused button.
    await page.keyboard.press('Enter');
    await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 0)));
    assert.equal(await page.evaluate(() => window.card._dialog.freshfeed.draft.entries.length), 2);
    assert.equal(await inside(), true, 'focus returns to the dialog after Add meal');
    await page.keyboard.press('Tab');
    assert.equal(await inside(), true, 'Tab continues inside the dialog');
    // Delete removes its own row; Escape must still close the dialog.
    await page.evaluate(() => window.overlay().querySelector('[aria-label="Delete meal 2"]').focus());
    await page.keyboard.press('Enter');
    await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 0)));
    assert.equal(await page.evaluate(() => window.card._dialog.freshfeed.draft.entries.length), 1);
    assert.equal(await inside(), true, 'focus returns to the dialog after Delete');
    // A control disabled while focused (Save during a pending save).
    await page.evaluate(() => {
      window.card._hass.callService = () => new Promise(() => {});
      window.overlay().querySelector('[data-save]').focus();
    });
    await page.keyboard.press('Enter');
    await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 0)));
    assert.equal(await page.evaluate(() => window.overlay().querySelector('[data-save]').disabled), true);
    await page.keyboard.press('Shift+Tab');
    assert.equal(await inside(), true, 'Shift+Tab from a disabled control stays inside');
    await page.keyboard.press('Escape');
    const state = await page.evaluate(() => ({ closed: window.overlay() === null, onMenu: window.deepActive() === window.menu() }));
    assert.deepEqual(state, { closed: true, onMenu: true });
    assertLocalOnly(page);
  } finally { await page.close(); }
});

test('reparent_keeps_focus_and_draft (generic shadow row)', async () => {
  const page = await newPage();
  try {
    await page.evaluate(async () => {
      window.mount({ kind: 'generic' });
      await window.openViaMenu();
      window.overlay().querySelector('.test-row').shadowRoot.querySelector('.row-action').focus();
    });
    // Move focus within the row's shadow root with the real keyboard.
    await page.keyboard.press('Tab');
    await page.keyboard.type('abc');
    const result = await page.evaluate(async () => {
      const ov = window.overlay();
      const input = ov.querySelector('.test-row').shadowRoot.querySelector('.row-input');
      const out = { typed: window.deepActive() === input };
      window.host.removeChild(window.card); window.host.appendChild(window.card);
      const root = window.card.shadowRoot.querySelector('ha-card');
      out.focus = window.deepActive() === input;
      out.value = input.value;
      out.inert = [...root.children].filter(child => child !== ov).every(child => child.inert);
      window.card._render();
      const states = window.statesFor();
      const statusId = window.configFor().entities.status;
      states[statusId] = { ...states[statusId], state: 'feeding' };
      window.card.hass = window.__harness.makeHass(states);
      out.afterUpdate = { focus: window.deepActive() === input, sameOverlay: window.overlay() === ov, inert: [...root.children].filter(child => child !== ov).every(child => child.inert), status: window.card.shadowRoot.querySelector('.status-label').textContent };
      return out;
    });
    assert.deepEqual(result, { typed: true, focus: true, value: 'abc', inert: true, afterUpdate: { focus: true, sameOverlay: true, inert: true, status: 'Feeding' } });
  } finally { await page.close(); }
});
