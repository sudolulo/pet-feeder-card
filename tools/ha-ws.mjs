// Minimal Home Assistant websocket client for one-off admin calls.
// Usage: HA_TOKEN=... node tools/ha-ws.mjs <commands.json>
// commands.json is an array of websocket messages without "id"; each is sent in order and
// its result printed as one JSON line. Stops (exit 1) on the first failed command.
// The token is read from the environment only, never from argv.
import { readFileSync } from 'node:fs';

const url = process.env.HA_WS_URL ?? 'ws://homeassistant.local:8123/api/websocket';
const token = process.env.HA_TOKEN;
if (!token) {
  console.error('HA_TOKEN is not set');
  process.exit(2);
}
const commands = JSON.parse(readFileSync(process.argv[2], 'utf8'));

const ws = new WebSocket(url);
let nextId = 1;
const pending = new Map();

function send(msg) {
  const id = nextId++;
  return new Promise((resolve) => {
    pending.set(id, resolve);
    ws.send(JSON.stringify({ ...msg, id }));
  });
}

ws.addEventListener('message', async (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.type === 'auth_required') {
    ws.send(JSON.stringify({ type: 'auth', access_token: token }));
  } else if (msg.type === 'auth_invalid') {
    console.error('auth_invalid:', msg.message);
    process.exit(2);
  } else if (msg.type === 'auth_ok') {
    for (const cmd of commands) {
      const res = await send(cmd);
      console.log(JSON.stringify({ type: cmd.type, success: res.success, result: res.result, error: res.error }));
      if (!res.success) {
        ws.close();
        process.exit(1);
      }
    }
    ws.close();
  } else if (msg.type === 'result' && pending.has(msg.id)) {
    pending.get(msg.id)(msg);
    pending.delete(msg.id);
  }
});
ws.addEventListener('error', (ev) => {
  console.error('websocket error:', ev.message ?? ev);
  process.exit(2);
});
