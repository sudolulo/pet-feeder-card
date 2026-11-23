import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PetFeederCard, validateConfig } from '../dist/pet-feeder-card.js';
import { freshfeedErrorText } from '../dist/freshfeed-model.js';
import { patchEditorConfig } from '../dist/freshfeed-editor-model.js';

const binding = { entry_id: 'entry', schedule_entity: 's', write_status_entity: 'w', quick_feed_entity: 'q', history_entity: 'h' };
const config = (extra = {}) => ({ model: 'freshfeed', entities: { meals_left: 'sensor.meals_left', food_level: 'sensor.food' }, freshfeed: { ...binding }, ...extra });
const liveActions = () => JSON.parse(readFileSync(new URL('./fixtures/live-card.json', import.meta.url), 'utf8')).actions;

class Element {
  constructor(tag = 'div') { this.tagName = tag; this.children = []; this.dataset = {}; this.attributes = {}; this.classList = { add() {}, remove() {} }; this.textContent = ''; }
  appendChild(node) { node.parentNode = this; this.children.push(node); return node; }
  setAttribute(key, value) { this.attributes[key] = String(value); }
  getAttribute(key) { return this.attributes[key] ?? null; }
  querySelector() { return null; }
}

const originalDocument = globalThis.document;
test.afterEach(() => { globalThis.document = originalDocument; });

function setup(cfg = config(), mealsLeft = '3') {
  globalThis.document = { createElement: (tag) => new Element(tag) };
  const card = new PetFeederCard();
  card._config = validateConfig(cfg);
  const calls = [];
  card._hass = {
    states: {
      'sensor.meals_left': { state: mealsLeft, attributes: {} },
      'sensor.food': { state: '80', attributes: {} },
      s: { state: 'unknown', attributes: {} },
      w: { state: 'idle', attributes: { can_feed: true, can_defrost: true, can_refilled: true } },
      q: { state: 'idle', attributes: {} },
      h: { state: '0', attributes: { events: [] } },
    },
    callService: async (...args) => { calls.push(args); },
  };
  card._root = new Element();
  Object.defineProperty(card._root, 'innerHTML', {
    set(value) { for (const child of this.children) child.parentNode = null; this.children = []; this._html = value; },
    get() { return this._html || ''; },
  });
  card.shadowRoot = { activeElement: null };
  card.attachShadow = () => {};
  card._render();
  return { card, calls };
}

const resetButtons = (card) => [...card._root.innerHTML.matchAll(/<button[^>]*data-refill-reset[^>]*>[\s\S]*?<\/button>/g)].map((m) => m[0]);
const tapReset = (card) => card._onClick({ composedPath: () => [{ dataset: { refillReset: '' } }] });
const flush = () => new Promise((resolve) => setImmediate(resolve));
const label = (html) => html.replace(/<[^>]+>/g, '').trim();
const classes = (html) => /class="([^"]*)"/.exec(html)[1].split(/\s+/);

test('config: show_refill_reset defaults true and rejects non-boolean', () => {
  assert.equal(validateConfig(config()).show_refill_reset, true);
  assert.equal(validateConfig(config({ show_refill_reset: false })).show_refill_reset, false);
  assert.equal(validateConfig({ model: 'freshfeed' }).show_refill_reset, true);
  for (const bad of ['no', 0, 1, null, 'false']) {
    assert.throws(() => validateConfig(config({ show_refill_reset: bad })), { message: 'pet-feeder-card: show_refill_reset must be true or false' });
  }
  assert.throws(() => validateConfig({ model: 'aqara_c1', show_refill_reset: true }), /show_refill_reset/);
  assert.throws(() => validateConfig({ model: 'freshfeed', mode: 'raw', raw_entities: ['sensor.a'], show_refill_reset: true }), /show_refill_reset/);
});

test('editor keeps show_refill_reset across feeder changes and drops it on model switch', () => {
  const base = config({ show_refill_reset: false });
  assert.equal(patchEditorConfig(base, { name: 'Kitchen' }).show_refill_reset, false);
  const switched = patchEditorConfig(base, { model: 'aqara_c1' });
  assert.equal('show_refill_reset' in switched, false);
});

test('renders low-key reset when meals left', () => {
  const { card } = setup(config(), '3');
  const buttons = resetButtons(card);
  assert.equal(buttons.length, 1);
  assert.ok(classes(buttons[0]).includes('refill-reset'));
  assert.equal(classes(buttons[0]).includes('prominent'), false);
  assert.equal(label(buttons[0]), 'Reset after refill');
  assert.match(buttons[0], /mdi:tray-arrow-down/);
  // On its own row after the meals gauge head text, before the tray tiles.
  assert.match(card._root.innerHTML, /class="gauge meals"[\s\S]*class="gauge-head"[\s\S]*gauge-text[\s\S]*data-refill-reset[\s\S]*class="meal-row"/);
});

test('renders prominent reset when estimated empty', () => {
  let { card } = setup(config(), '0');
  let [button] = resetButtons(card);
  assert.ok(classes(button).includes('prominent'));
  assert.equal(label(button), 'Refilled? Reset tray');
  for (const state of ['unknown', 'unavailable']) {
    ({ card } = setup(config(), state));
    [button] = resetButtons(card);
    assert.equal(classes(button).includes('prominent'), false, state);
    assert.equal(label(button), 'Reset after refill');
  }
});

test('no meal tray falls back to food gauge and empty status', () => {
  const cfg = config({ meal_slots: null });
  let { card } = setup(cfg, '3');
  assert.match(card._root.innerHTML, /class="gauge"[\s\S]*gauge-text[\s\S]*data-refill-reset/);
  assert.equal(classes(resetButtons(card)[0]).includes('prominent'), false);
  card._hass.states['sensor.food'] = { state: '0', attributes: {} };
  card._render();
  assert.ok(classes(resetButtons(card)[0]).includes('prominent'));
  card._hass.states['sensor.food'] = { state: 'unknown', attributes: {} };
  card._render();
  assert.equal(classes(resetButtons(card)[0]).includes('prominent'), false);
  ({ card } = setup({ ...cfg, entities: { status: 'sensor.status' } }));
  card._hass.states['sensor.status'] = { state: 'no_food', attributes: {} };
  card._render();
  assert.equal(resetButtons(card).length, 1);
  assert.ok(classes(resetButtons(card)[0]).includes('prominent'));
});

test('first tap arms, second tap sends once', async () => {
  const { card, calls } = setup(config(), '0');
  let resolve;
  card._hass.callService = (...args) => { calls.push(args); return new Promise((r) => { resolve = r; }); };
  tapReset(card);
  await flush();
  assert.equal(calls.length, 0);
  assert.equal(label(resetButtons(card)[0]), 'Tap again to reset');
  assert.ok(classes(resetButtons(card)[0]).includes('armed'));
  tapReset(card);
  await flush();
  assert.deepEqual(calls, [['petsafe_freshfeed', 'command', { entry_id: 'entry', operation: 'refilled', confirmed: true }]]);
  assert.match(resetButtons(card)[0], / disabled/);
  tapReset(card);
  tapReset(card);
  await flush();
  assert.equal(calls.length, 1);
  resolve();
  await flush();
  assert.doesNotMatch(resetButtons(card)[0], / disabled/);
  assert.equal(label(resetButtons(card)[0]), 'Refilled? Reset tray');
  card._disarm(false);
});

test('armed state survives re-renders and focus is restored', () => {
  const { card } = setup(config(), '3');
  tapReset(card);
  card._hass = { ...card._hass, states: { ...card._hass.states, 'sensor.food': { state: '70', attributes: {} } } };
  card._render();
  assert.equal(label(resetButtons(card)[0]), 'Tap again to reset');
  let focused = 0;
  card.shadowRoot.activeElement = { dataset: { refillReset: '' } };
  card._root.querySelector = (selector) => (selector === '[data-refill-reset]' ? { focus: () => { focused++; } } : null);
  card._render();
  assert.equal(focused, 1);
  card._disarm(false);
});

test('arm expires after CONFIRM_MS', () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const { card, calls } = setup(config(), '3');
    tapReset(card);
    assert.equal(label(resetButtons(card)[0]), 'Tap again to reset');
    mock.timers.tick(3999);
    assert.equal(label(resetButtons(card)[0]), 'Tap again to reset');
    mock.timers.tick(1);
    assert.equal(label(resetButtons(card)[0]), 'Reset after refill');
    tapReset(card);
    assert.equal(calls.length, 0, 'tap after expiry arms again, it does not send');
    card._disarm(false);
  } finally {
    mock.timers.reset();
  }
});

test('arming Feed disarms reset and vice versa', () => {
  const { card } = setup(config({ actions: [{ name: 'Feed', action: 'petsafe_freshfeed.command', data: { operation: 'feed' } }] }), '3');
  tapReset(card);
  card._onAction(0);
  assert.equal(label(resetButtons(card)[0]), 'Reset after refill');
  assert.equal(card._armed, 0);
  tapReset(card);
  assert.equal(card._armed, -1);
  assert.equal(label(resetButtons(card)[0]), 'Tap again to reset');
  card._disarm(false);
});

test('disabled when integration refuses', async () => {
  const { card, calls } = setup(config(), '0');
  card._hass.states.w.attributes.can_refilled = false;
  card._render();
  assert.match(resetButtons(card)[0], / disabled/);
  tapReset(card);
  tapReset(card);
  await flush();
  assert.equal(calls.length, 0);
  assert.equal(label(resetButtons(card)[0]), 'Refilled? Reset tray');
});

test('hidden when show_refill_reset false, unbound, Aqara or raw', () => {
  const cases = [
    config({ show_refill_reset: false }),
    { model: 'freshfeed', entities: { meals_left: 'sensor.meals_left' } },
    { model: 'aqara_c1', entities: { food_level: 'sensor.food' } },
    { model: 'freshfeed', mode: 'raw', raw_entities: ['sensor.meals_left'] },
  ];
  for (const cfg of cases) {
    const { card, calls } = setup(cfg, '0');
    assert.equal(resetButtons(card).length, 0, JSON.stringify(cfg));
    assert.doesNotMatch(card._root.innerHTML, /refill-reset|prominent/);
    tapReset(card);
    tapReset(card);
    assert.equal(calls.length, 0);
  }
});

test('configured refilled action suppresses built-in and becomes prominent when empty', () => {
  const refilledButton = (card) => [...card._root.innerHTML.matchAll(/<button class="round action[^"]*" data-action="(\d)"[^>]*>/g)].find((m) => m[1] === '2')[0];
  let { card } = setup(config({ actions: liveActions() }), '0');
  assert.equal(resetButtons(card).length, 0);
  assert.ok(classes(refilledButton(card)).includes('prominent'));
  const others = [...card._root.innerHTML.matchAll(/<button class="round action[^"]*" data-action="[01]"/g)];
  assert.equal(others.length, 2);
  for (const m of others) assert.doesNotMatch(m[0], /prominent/);
  ({ card } = setup(config({ actions: liveActions() }), '3'));
  assert.equal(classes(refilledButton(card)).includes('prominent'), false);
  ({ card } = setup(config({ actions: liveActions(), show_refill_reset: false }), '0'));
  assert.equal(classes(refilledButton(card)).includes('prominent'), false);
});

test('refusal shows command message', async () => {
  const { card, calls } = setup(config(), '0');
  const error = { code: 'service_validation_error', translation_key: 'already_refilled', message: 'already_refilled' };
  card._hass.callService = async (...args) => { calls.push(args); throw error; };
  tapReset(card);
  tapReset(card);
  await flush();
  assert.equal(calls.length, 1);
  const status = card._root.children.find((node) => 'data-command-message' in node.attributes);
  assert.ok(status);
  assert.equal(status.textContent, freshfeedErrorText(error, 'command'));
});

test('styles: prominent uses theme error colour and 44px target', () => {
  const source = readFileSync(new URL('../dist/pet-feeder-card.js', import.meta.url), 'utf8');
  const rule = source.match(/\n\.refill-reset\.prominent \{([^}]*)\}/);
  assert.ok(rule, '.refill-reset.prominent rule exists');
  assert.match(rule[1], /background: var\(--error-color/);
  assert.match(rule[1], /color: var\(--text-primary-color, #fff\)/);
  assert.match(rule[1], /min-height: 44px/);
  const action = source.match(/\n\.actions \.round\.prominent:not\(\.armed\) \{([^}]*)\}/);
  assert.ok(action, '.actions .round.prominent:not(.armed) rule exists');
  assert.match(action[1], /var\(--error-color/);
});

test('armed refilled action keeps the armed colour while prominent', () => {
  const src = readFileSync(new URL('../dist/pet-feeder-card.js', import.meta.url), 'utf8');
  assert.match(src, /\.actions \.round\.prominent:not\(\.armed\) \{/);
  assert.doesNotMatch(src, /\.actions \.round\.prominent \{/);
});
