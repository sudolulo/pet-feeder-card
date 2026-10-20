// Insert (or replace) the pet-feeder cards on the cat view of the default dashboard.
// Usage: HA_TOKEN=... node tools/add-cards.mjs deploy/cards.json [--view mdi:broom] [--dry-run]
// Idempotent: existing custom:pet-feeder-card cards with the same model are replaced in
// place; missing ones are added. The target view is located by its icon (default
// mdi:cat), and the script refuses to save unless exactly one such view exists.
import { readFileSync, writeFileSync } from 'node:fs';

const url = process.env.HA_WS_URL ?? 'ws://homeassistant.local:8123/api/websocket';
const token = process.env.HA_TOKEN;
if (!token) {
  console.error('HA_TOKEN is not set');
  process.exit(2);
}
const cards = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const dryRun = process.argv.includes('--dry-run');
// --view mdi:<icon> picks the target view by its icon (default: the cat view).
const viewArg = process.argv.indexOf('--view');
const viewIcon = viewArg > 0 ? process.argv[viewArg + 1] : 'mdi:cat';

const ws = new WebSocket(url);
let nextId = 1;
const pending = new Map();
const call = (msg) =>
  new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, (res) => (res.success ? resolve(res.result) : reject(new Error(JSON.stringify(res.error)))));
    ws.send(JSON.stringify({ ...msg, id }));
  });

async function main() {
  const config = await call({ type: 'lovelace/config', url_path: null });
  writeFileSync(new URL('../deploy/lovelace-before.json', import.meta.url), JSON.stringify(config, null, 2));
  const views = config.views.filter((v) => v.icon === viewIcon);
  if (views.length !== 1) throw new Error(`expected exactly one ${viewIcon} view, found ${views.length}`);
  const view = views[0];
  const isFeeder = (card) => (c) => c.type === 'custom:pet-feeder-card' && c.model === card.model;
  if (view.type === 'sections') {
    // Sections view: each feeder card gets its own grid section, so it sits in a column
    // beside the existing sections. An existing feeder card is replaced in place.
    for (const card of cards) {
      const sec = view.sections.find((s) => (s.cards || []).some(isFeeder(card)));
      if (sec) sec.cards[sec.cards.findIndex(isFeeder(card))] = card;
      else view.sections.push({ type: 'grid', cards: [card] });
      console.log(`${sec ? 'replaced' : 'added section for'} ${card.model}`);
    }
    console.log(`${viewIcon} view sections: ${JSON.stringify(view.sections.map((s) => (s.cards || []).map((c) => c.type)))}`);
  } else {
    if (!Array.isArray(view.cards)) throw new Error(`${viewIcon} view has neither sections nor cards`);
    for (const card of cards) {
      const idx = view.cards.findIndex(isFeeder(card));
      if (idx >= 0) view.cards[idx] = card;
      else view.cards.push(card);
      console.log(`${idx >= 0 ? 'replaced' : 'appended'} ${card.model}`);
    }
    console.log(`${viewIcon} view now has ${view.cards.length} cards: ${view.cards.map((c) => c.type).join(', ')}`);
  }
  if (dryRun) return;
  await call({ type: 'lovelace/config/save', url_path: null, config });
  console.log('saved');
}

ws.addEventListener('message', (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.type === 'auth_required') ws.send(JSON.stringify({ type: 'auth', access_token: token }));
  else if (msg.type === 'auth_invalid') {
    console.error('auth_invalid');
    process.exit(2);
  } else if (msg.type === 'auth_ok') {
    main()
      .then(() => ws.close())
      .catch((err) => {
        console.error(err.message);
        ws.close();
        process.exit(1);
      });
  } else if (msg.type === 'result' && pending.has(msg.id)) {
    pending.get(msg.id)(msg);
    pending.delete(msg.id);
  }
});
ws.addEventListener('error', (ev) => {
  console.error('websocket error:', ev.message ?? ev);
  process.exit(2);
});
