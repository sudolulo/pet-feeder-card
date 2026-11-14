import test from 'node:test';
import assert from 'node:assert/strict';
import { PetFeederCard, validateConfig } from '../card/pet-feeder-card.js';

class Element {
  constructor(tag = 'div') { this.tagName = tag; this.children = []; this.dataset = {}; this.attributes = {}; this.textContent = ''; }
  appendChild(node) { this.children.push(node); return node; }
  replaceChildren(...nodes) { this.children = [...nodes]; }
  setAttribute(key, value) { this.attributes[key] = String(value); }
  addEventListener() {}
  querySelector(selector) {
    const key = selector.slice(1, -1);
    return this.children.find(node => key in node.attributes || (key === 'data-recover' && 'recover' in node.dataset)) || null;
  }
}

test('history refreshes local time when HA timezone changes but preserves rows on unrelated updates', () => {
  const originalDocument = globalThis.document;
  globalThis.document = { createElement: tag => new Element(tag) };
  try {
    const card = new PetFeederCard();
    card._config = validateConfig({ model: 'freshfeed', entities: {}, freshfeed: { entry_id: 'entry', schedule_entity: 's', write_status_entity: 'w', quick_feed_entity: 'q', history_entity: 'h' } });
    card._render = () => {};
    const elements = Object.fromEntries(['freshness', 'message', 'write-status', 'history', 'recovery'].map(name => [`[data-${name}]`, new Element()]));
    card._dialog = { freshfeed: { section: { querySelector: selector => elements[selector] || null }, draft: null, error: null }, el: new Element() };
    const event = { kind: 'dispensed', at: '2026-11-12T08:00:00Z', source_dp: 145 };
    const hass = { config: { time_zone: 'UTC' }, states: {
      s: { state: 'unknown', attributes: { source_state: 'unknown', entries: null, revision: null } },
      w: { state: 'idle', attributes: { recovery_phase: 'idle' } },
      q: { state: 'idle', attributes: { status: 'idle', minutes: null } },
      h: { state: '1', attributes: { events: [event], basis: 'ha_observed' } },
    } };
    const history = elements['[data-history]'];
    card.hass = hass;
    const originalRow = history.children[1];
    const date = new Date(event.at);
    const formatted = zone => date.toLocaleString(undefined, { timeZone: zone, timeZoneName: 'short' });
    assert.ok(originalRow.textContent.startsWith(formatted('UTC')));
    card.hass = { ...hass, states: { ...hass.states, other: { state: 'on', attributes: {} } } };
    assert.strictEqual(history.children[1], originalRow);
    card.hass = { ...hass, config: { time_zone: 'America/New_York' } };
    assert.notEqual(formatted('UTC'), formatted('America/New_York'));
    assert.ok(history.children[1].textContent.startsWith(formatted('America/New_York')), history.children[1].textContent);
    assert.notStrictEqual(history.children[1], originalRow);
  } finally { globalThis.document = originalDocument; }
});
