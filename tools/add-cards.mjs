// Insert (or replace) the pet-feeder cards on the cat view of the default dashboard.
// Usage: HA_TOKEN=... node tools/add-cards.mjs deploy/cards.json [--dry-run]
// Idempotent: existing custom:pet-feeder-card cards with the same model are replaced in
// place; missing ones are appended. The target view is located by its mdi:cat icon, and
// the script refuses to save unless exactly one such view exists.
import { readFileSync, writeFileSync } from 'node:fs';

const url = process.env.HA_WS_URL ?? 'ws://homeassistant.local:8123/api/websocket';
const token = process.env.HA_TOKEN;
if (!token) {
  console.error('HA_TOKEN is not set');
  process.exit(2);
}
const cards = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const dryRun = process.argv.includes('--dry-run');

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
  const views = config.views.filter((v) => v.icon === 'mdi:cat');
  if (views.length !== 1) throw new Error(`expected exactly one mdi:cat view, found ${views.length}`);
  const view = views[0];
  if (!Array.isArray(view.cards)) throw new Error('cat view has no cards array (not a masonry view?)');
  for (const card of cards) {
    const idx = view.cards.findIndex((c) => c.type === 'custom:pet-feeder-card' && c.model === card.model);
    if (idx >= 0) view.cards[idx] = card;
    else view.cards.push(card);
    console.log(`${idx >= 0 ? 'replaced' : 'appended'} ${card.model}`);
  }
  console.log(`cat view now has ${view.cards.length} cards: ${view.cards.map((c) => c.type).join(', ')}`);
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
