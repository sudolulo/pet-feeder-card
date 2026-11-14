import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright';

// Exercise native focus removal and custom-element callbacks, not a DOM double.
test('same-task reparent restores editor focus without stealing deliberate outside focus', async () => {
  const server = http.createServer(async (req, res) => {
    try {
      const path = new URL(req.url, 'http://localhost').pathname;
      const data = await readFile(new URL(`..${path}`, import.meta.url));
      res.setHeader('content-type', path.endsWith('.html') ? 'text/html' : 'text/javascript');
      res.end(data);
    } catch { res.writeHead(404).end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await chromium.launch();
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${server.address().port}/harness/index.html`);
    await page.waitForFunction(() => window.__ready);
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
  } finally {
    await browser?.close();
    await new Promise(resolve => server.close(resolve));
  }
});
