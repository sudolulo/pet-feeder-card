import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildModel, validateConfig } from '../card/pet-feeder-card.js';

const now = new Date(2026, 9, 20, 12, 0, 0); // Tuesday
const iso = (d) => d.toISOString();
const minsAgo = (m) => new Date(now.getTime() - m * 60000);
const st = (state, attributes = {}, last_changed = iso(minsAgo(5))) => ({ state, attributes, last_changed });

const FF_ENTITIES = {
  status: 'input_select.freshfeed_demo_status',
  food_level: 'input_select.freshfeed_demo_food_level',
  error: 'input_boolean.freshfeed_demo_fault',
  last_feed: 'input_number.freshfeed_demo_last_feed',
  last_fed: 'input_number.freshfeed_demo_last_feed',
  counter: 'input_number.freshfeed_demo_counter',
  next_meal: 'input_datetime.freshfeed_demo_next_meal',
};

const ffHass = (over = {}) => ({
  states: {
    'input_select.freshfeed_demo_status': st('standby'),
    'input_select.freshfeed_demo_food_level': st('high'),
    'input_boolean.freshfeed_demo_fault': st('off'),
    'input_number.freshfeed_demo_last_feed': st('2.0', {}, iso(minsAgo(51))),
    'input_number.freshfeed_demo_counter': st('4.0'),
    'input_datetime.freshfeed_demo_next_meal': st('2026-10-20 18:00:00', { has_date: true, has_time: true }),
    ...over,
  },
});

test('works with no hass at all and no entities', () => {
  const m = buildModel(validateConfig({ model: 'freshfeed' }), undefined, now);
  assert.equal(m.name, 'FreshFeed');
  assert.equal(m.status.key, 'unknown');
  assert.equal(m.food, null);
  assert.equal(m.chip, null);
  assert.deepEqual(m.footer, []);
  assert.equal(m.camera, null);
  assert.deepEqual(m.art, { model: 'freshfeed', color: 'black', artLevel: 'hopper', statusKey: 'unknown', foodPct: null });
});

test('raw mode preserves literal states and reports availability without feeder semantics', () => {
  const cfg = validateConfig({
    model: 'freshfeed',
    mode: 'raw',
    raw_entities: ['sensor.example_dp_4', 'binary_sensor.example_dp_110', 'sensor.example_dp_5'],
  });
  const m = buildModel(cfg, {
    states: {
      'sensor.example_dp_4': st('feeding', { friendly_name: 'Raw DP 4' }),
      'binary_sensor.example_dp_110': st('on', { friendly_name: 'Door state' }),
      'sensor.example_dp_5': st('unavailable'),
    },
  }, now);
  assert.equal(m.mode, 'raw');
  assert.deepEqual(m.availability, { label: 'Partial data', available: 2, total: 3 });
  assert.deepEqual(
    m.rawRows.map((r) => [r.name, r.state, r.kind]),
    [['Raw DP 4', 'feeding', 'available'], ['Door state', 'on', 'available'], ['sensor.example_dp_5', 'unavailable', 'unavailable']],
  );
  assert.equal(m.food, null);
  assert.equal(m.meals, null);
  assert.equal(m.chip, null);
  assert.deepEqual(m.footer, []);
  assert.equal(m.camera, null);
  assert.equal(m.art.foodPct, null);
});

test('raw mode treats whitespace-padded unknown and unavailable sentinels as unavailable data', () => {
  const raw_entities = ['sensor.padded_unknown', 'sensor.padded_unavailable', 'sensor.available'];
  const cfg = validateConfig({ model: 'freshfeed', mode: 'raw', raw_entities });
  const m = buildModel(cfg, { states: {
    'sensor.padded_unknown': st(' unknown '),
    'sensor.padded_unavailable': st(' UnAvAiLaBlE '),
    'sensor.available': st('reported'),
  } }, now);

  assert.deepEqual(m.availability, { label: 'Partial data', available: 1, total: 3 });
  assert.deepEqual(m.rawRows.map((row) => row.state), [' unknown ', ' UnAvAiLaBlE ', 'reported']);
  assert.deepEqual(m.rawRows.map((row) => row.kind), ['unknown', 'unavailable', 'available']);
});

test('raw mode exposes no unverified local-provenance claim in its model', () => {
  const cfg = validateConfig({ model: 'freshfeed', mode: 'raw', raw_entities: ['sensor.cloud_backed'] });
  const m = buildModel(cfg, { states: { 'sensor.cloud_backed': st('reported') } }, now);

  assert.equal(m.status.label, 'Read-only');
  assert.equal(m.status.provenance, undefined);
});

test('raw mode labels an all-available literal fixture as Data available', () => {
  const raw_entities = Array.from({ length: 10 }, (_, index) => `sensor.fixture_dp_${index + 1}`);
  const cfg = validateConfig({ model: 'freshfeed', mode: 'raw', raw_entities });
  const m = buildModel(cfg, { states: Object.fromEntries(raw_entities.map((entity) => [entity, st('reported')])) }, now);

  assert.deepEqual(m.availability, { label: 'Data available', available: 10, total: 10 });
});

test('raw mode distinguishes unknown, unavailable, and missing values', () => {
  const cfg = validateConfig({ model: 'freshfeed', mode: 'raw', raw_entities: ['sensor.known', 'sensor.unknown', 'binary_sensor.missing'] });
  const m = buildModel(cfg, { states: { 'sensor.known': st('unknown'), 'sensor.unknown': st('unavailable') } }, now);
  assert.equal(m.availability.label, 'Data unavailable');
  assert.deepEqual(m.rawRows.map((r) => [r.state, r.kind]), [['unknown', 'unknown'], ['unavailable', 'unavailable'], ['Missing', 'missing']]);
});

test('raw mode treats a malformed state object as missing literal data', () => {
  const cfg = validateConfig({ model: 'freshfeed', mode: 'raw', raw_entities: ['sensor.malformed'] });
  const m = buildModel(cfg, { states: { 'sensor.malformed': { attributes: { friendly_name: 'Malformed DP' } } } }, now);
  assert.deepEqual(m.availability, { label: 'Data unavailable', available: 0, total: 1 });
  assert.deepEqual(m.rawRows, [{ entity: 'sensor.malformed', name: 'Malformed DP', state: 'Missing', kind: 'missing' }]);
});

test('FreshFeed ready/high scenario', () => {
  const cfg = validateConfig({ model: 'freshfeed', entities: FF_ENTITIES, footer: ['last_fed', 'counter', 'next_meal'] });
  const m = buildModel(cfg, ffHass(), now);
  assert.equal(m.status.label, 'Ready');
  assert.equal(m.status.entity, 'input_select.freshfeed_demo_status');
  assert.deepEqual(m.food, {
    label: 'Food',
    pct: 100,
    text: 'Full',
    color: 'var(--success-color, #43a047)',
    entity: 'input_select.freshfeed_demo_food_level',
  });
  assert.equal(m.chip.value, '2 portions');
  assert.equal(m.chip.entity, 'input_number.freshfeed_demo_last_feed');
  assert.deepEqual(
    m.footer.map((f) => [f.key, f.value]),
    [
      ['last_fed', 'Unknown'],
      ['counter', '4 meals'],
      ['next_meal', 'in 6 hours'],
    ],
  );
  assert.equal(m.art.foodPct, 100);
});

test('fault and offline flow into status and art', () => {
  const cfg = validateConfig({ model: 'freshfeed', entities: FF_ENTITIES });
  assert.equal(buildModel(cfg, ffHass({ 'input_boolean.freshfeed_demo_fault': st('on') }), now).status.key, 'fault');
  const off = buildModel(cfg, ffHass({ 'input_select.freshfeed_demo_status': st('unavailable') }), now);
  assert.equal(off.status.key, 'offline');
  assert.equal(off.art.statusKey, 'offline');
});

test('configured but missing entities render Unknown, never throw', () => {
  const cfg = validateConfig({ model: 'freshfeed', entities: FF_ENTITIES });
  const m = buildModel(cfg, { states: {} }, now);
  assert.equal(m.status.label, 'Unknown');
  assert.equal(m.status.key, 'unknown');
  assert.equal(m.food.pct, null);
  assert.equal(m.food.text, 'Unknown');
  assert.equal(m.chip.value, 'Unknown');
  assert.deepEqual(
    m.footer.map((f) => f.value),
    ['Unknown', 'Unknown'],
  ); // portions_today is not configured -> hidden
});

test('last_fed uses a timestamp state when it is one', () => {
  const cfg = validateConfig({ model: 'freshfeed', entities: { last_fed: 'sensor.last' }, footer: ['last_fed'] });
  const m = buildModel(cfg, { states: { 'sensor.last': st(iso(minsAgo(120)), { device_class: 'timestamp' }) } }, now);
  assert.equal(m.footer[0].value, '2 hours ago');
});

test('FreshFeed unknown, blank, and missing semantic statuses do not imply readiness', () => {
  const cfg = validateConfig({ model: 'freshfeed', entities: { status: 'sensor.status' } });
  for (const states of [{ 'sensor.status': st('mystery_code') }, { 'sensor.status': st('  ') }, {}]) {
    const m = buildModel(cfg, { states }, now);
    assert.deepEqual([m.status.key, m.status.label, m.status.icon, m.status.color, m.art.statusKey],
      ['unknown', 'Unknown', 'mdi:help-circle-outline', 'var(--disabled-color)', 'unknown']);
  }
  const errorOnly = validateConfig({ model: 'freshfeed', entities: { error: 'binary_sensor.error' } });
  assert.equal(buildModel(errorOnly, { states: { 'binary_sensor.error': st('off') } }, now).status.key, 'unknown');
});

test('FreshFeed known status aliases and availability and fault precedence remain intact', () => {
  const cfg = validateConfig({ model: 'freshfeed', entities: { status: 'sensor.status', error: 'binary_sensor.error' } });
  for (const [state, error, expected] of [
    ['standby', 'off', 'ready'], ['feeding', 'off', 'feeding'], ['feeding_complete', 'off', 'done'],
    ['unavailable', 'on', 'offline'], ['unknown', 'on', 'offline'], ['mystery_code', 'on', 'fault'],
  ]) {
    assert.equal(buildModel(cfg, { states: { 'sensor.status': st(state), 'binary_sensor.error': st(error) } }, now).status.key, expected);
  }
});

for (const state of ['constructor', '__proto__', 'toString', 'valueOf', 'hasOwnProperty']) {
  test(`FreshFeed treats inherited status name ${state} as unknown`, () => {
    const cfg = validateConfig({ model: 'freshfeed', entities: { status: 'sensor.status' } });
    const m = buildModel(cfg, { states: { 'sensor.status': st(state) } }, now);
    assert.deepEqual(m.status, {
      key: 'unknown', label: 'Unknown', icon: 'mdi:help-circle-outline',
      color: 'var(--disabled-color)', entity: 'sensor.status',
    });
    assert.equal(m.art.statusKey, 'unknown');
  });
}

test('FreshFeed preserves fault and offline precedence with inherited status names', () => {
  const cfg = validateConfig({ model: 'freshfeed', entities: { status: 'sensor.status', error: 'binary_sensor.error' } });
  for (const [state, error, expected] of [
    ['constructor', 'on', 'fault'], ['__proto__', 'on', 'fault'],
    ['unavailable', 'on', 'offline'], ['unknown', 'on', 'offline'],
  ]) {
    assert.equal(buildModel(cfg, { states: { 'sensor.status': st(state), 'binary_sensor.error': st(error) } }, now).status.key, expected);
  }
});

test('FreshFeed last_fed does not infer a meal from a non-timestamp state change', () => {
  const cfg = validateConfig({ model: 'freshfeed', entities: { last_fed: 'sensor.last' }, footer: ['last_fed'] });
  for (const state of ['2.0', 'not a date']) {
    assert.equal(buildModel(cfg, { states: { 'sensor.last': st(state, {}, iso(minsAgo(51))) } }, now).footer[0].value, 'Unknown');
  }
});

const lastFedValue = (state, at = now) => {
  const cfg = validateConfig({ model: 'freshfeed', entities: { last_fed: 'sensor.last' }, footer: ['last_fed'] });
  return buildModel(cfg, { states: { 'sensor.last': st(state) } }, at).footer[0].value;
};

for (const state of [
  '07:00:00', '2026-10-20', '2026-10-20T10:00:00', '2026-10-20 10:00:00',
  '2026-10-20T12:00:00.001Z', '2026-02-30T10:00:00Z', '2025-02-29T10:00:00Z',
  '2026-10-19T24:00:00Z', '2026-10-19T10:60:00Z', '2026-10-19T10:00:60Z',
  '2026-10-19T10:00:00+14:01', '2026-10-19T10:00:00+01:60',
  '2026-10-19T10:00:00-00:00', '2026-10-19t10:00:00z',
  '2026-10-19T10:00:00.1234567890Z', '2.0', 'unknown', 'unavailable', '',
  new Date('2026-10-19T10:00:00Z'), 123, null,
]) {
  test(`FreshFeed rejects last_fed ${String(state)}`, () => {
    assert.equal(lastFedValue(state, new Date('2026-10-20T12:00:00Z')), 'Unknown');
  });
}

test('FreshFeed accepts valid zoned past and equal timestamps', () => {
  const at = new Date('2026-03-01T00:00:00Z');
  for (const [state, expected] of [
    ['2026-02-28T22:00:00Z', '2 hours ago'],
    ['2026-02-28T22:00:00+00:00', '2 hours ago'],
    ['2026-03-01T01:00:00+03:00', '2 hours ago'],
    ['2024-02-29T00:00:00Z', '731 days ago'],
    ['2026-02-28T23:59:59.1Z', 'just now'],
    ['2026-02-28T23:59:59.123456789Z', 'just now'],
    ['2026-03-01T00:00:00Z', 'just now'],
    [' 2026-02-28T22:00:00Z ', '2 hours ago'],
    ['0099-01-01T00:00:00Z', '703881 days ago'],
  ]) assert.equal(lastFedValue(state, at), expected, state);
});

test('FreshFeed rejects last_fed when now is invalid', () => {
  assert.equal(lastFedValue('2026-01-01T00:00:00Z', new Date(NaN)), 'Unknown');
});

test('Aqara retains unknown status normalization and last_changed fallback', () => {
  const cfg = validateConfig({ model: 'aqara_c1', entities: { status: 'sensor.status', last_fed: 'sensor.last' }, footer: ['last_fed'] });
  const m = buildModel(cfg, { states: { 'sensor.status': st('mystery_code'), 'sensor.last': st('2.0', {}, iso(minsAgo(51))) } }, now);
  assert.equal(m.status.key, 'ready');
  assert.equal(m.status.label, 'Mystery Code');
  assert.equal(m.footer[0].value, '51 minutes ago');
});

const AQ = {
  error: 'binary_sensor.cat_feeder_error',
  food_level: 'sensor.cat_feeder_cat_feeder_classification',
  portions_today: 'sensor.cat_feeder_portions_per_day',
  weight_today: 'sensor.cat_feeder_weight_per_day',
  last_feed: 'sensor.cat_feeder_feeding_size',
  schedule: 'sensor.cat_feeder_schedule',
};
const SCHEDULE =
  "[{'days': 'everyday', 'hour': 7, 'minute': 0, 'size': 3}, {'days': 'everyday', 'hour': 10, 'minute': 0, 'size': 3}, " +
  "{'days': 'everyday', 'hour': 2, 'minute': 0, 'size': 3}, {'days': 'everyday', 'hour': 6, 'minute': 0, 'size': 3}, {'hour': 9, 'size': 3}]";
const aqHass = (classification = 'Full', errorState = 'off') => ({
  states: {
    'binary_sensor.cat_feeder_error': st(errorState),
    'sensor.cat_feeder_cat_feeder_classification': st(classification),
    'sensor.cat_feeder_portions_per_day': st('17'),
    'sensor.cat_feeder_weight_per_day': st('238', { unit_of_measurement: 'g' }),
    'sensor.cat_feeder_feeding_size': st('3', { unit_of_measurement: 'portion' }),
    'sensor.cat_feeder_schedule': st(SCHEDULE),
  },
});

test('Aqara C1 bowl scenario: schedule drives next meal, units are formatted', () => {
  const cfg = validateConfig({
    model: 'aqara_c1',
    art_level: 'bowl',
    food_label: 'Bowl',
    entities: AQ,
    footer: ['next_meal', 'portions_today', 'weight_today'],
  });
  const m = buildModel(cfg, aqHass(), now);
  assert.equal(m.status.key, 'ready');
  assert.equal(m.status.entity, 'binary_sensor.cat_feeder_error');
  assert.equal(m.food.label, 'Bowl');
  assert.equal(m.food.text, 'Full');
  assert.equal(m.chip.value, '3 portions');
  assert.deepEqual(
    m.footer.map((f) => [f.value, f.entity]),
    [
      ['in 14 hours', 'sensor.cat_feeder_schedule'], // next slot is 02:00 tomorrow
      ['17 portions', 'sensor.cat_feeder_portions_per_day'],
      ['238 g', 'sensor.cat_feeder_weight_per_day'],
    ],
  );
  assert.deepEqual(m.art, { model: 'aqara_c1', color: 'white', artLevel: 'bowl', statusKey: 'ready', foodPct: 100 });
  assert.equal(buildModel(cfg, aqHass('Empty'), now).art.foodPct, 0);
});

test('Aqara with no status entity is offline when its error entity is unavailable', () => {
  const cfg = validateConfig({ model: 'aqara_c1', entities: AQ });
  assert.equal(buildModel(cfg, aqHass('Full', 'unavailable'), now).status.key, 'offline');
});

test('next_meal from a time-only input_datetime rolls to tomorrow when past', () => {
  const cfg = validateConfig({ model: 'freshfeed', entities: { next_meal: 'input_datetime.t' }, footer: ['next_meal'] });
  const hass = { states: { 'input_datetime.t': st('07:00:00', { has_date: false, has_time: true }) } };
  assert.equal(buildModel(cfg, hass, now).footer[0].value, 'in 19 hours');
});

// --- meal tray -----------------------------------------------------------------

const mealCfg = (entities, over = {}) => validateConfig({ model: 'freshfeed', entities, ...over });
const COUNTER = 'input_number.freshfeed_demo_counter';
const LEFT = 'sensor.freshfeed_meals_left';
const NEXT = 'input_datetime.freshfeed_demo_next_meal';

test('meals: counter of 2 delivered -> "Estimated 4 of 6 left", green, next slot carries the next-meal time', () => {
  const cfg = mealCfg({ counter: COUNTER, next_meal: NEXT });
  const m = buildModel(cfg, { states: { [COUNTER]: st('2.0'), [NEXT]: st('2026-10-20 18:00:00') } }, now);
  assert.equal(m.meals.entity, COUNTER);
  assert.equal(m.meals.label, 'Estimated meals');
  assert.equal(m.meals.total, 6);
  assert.equal(m.meals.left, 4);
  assert.equal(m.meals.text, 'Estimated 4 of 6 left');
  assert.equal(m.meals.color, 'var(--success-color, #43a047)');
  assert.deepEqual(
    m.meals.slots.map((s) => [s.n, s.state, s.next, s.time]),
    [
      [1, 'eaten', false, null],
      [2, 'serving', false, null],
      [3, 'full', true, '18:00'],
      [4, 'full', false, null],
      [5, 'full', false, null],
      [6, 'full', false, null],
    ],
  );
});

test('meals: time label is 24h HH:MM and absent when next_meal is not configured or unknown', () => {
  const morning = buildModel(mealCfg({ counter: COUNTER, next_meal: NEXT }), { states: { [COUNTER]: st('0'), [NEXT]: st('07:05:00') } }, now);
  assert.equal(morning.meals.slots[0].time, '07:05');
  const none = buildModel(mealCfg({ counter: COUNTER }), { states: { [COUNTER]: st('0') } }, now);
  assert.equal(none.meals.slots[0].time, null);
  const unknown = buildModel(mealCfg({ counter: COUNTER, next_meal: NEXT }), { states: { [COUNTER]: st('0'), [NEXT]: st('unavailable') } }, now);
  assert.equal(unknown.meals.slots[0].time, null);
});

test('meals: text and colour by meals left', () => {
  const at = (delivered) => buildModel(mealCfg({ counter: COUNTER }), { states: { [COUNTER]: st(String(delivered)) } }, now).meals;
  assert.equal(at(3).text, 'Estimated 3 of 6 left');
  assert.equal(at(3).color, 'var(--success-color, #43a047)');
  assert.equal(at(4).text, 'Estimated 2 of 6 left');
  assert.equal(at(4).color, 'var(--warning-color, #ffa600)');
  assert.equal(at(5).text, 'Estimated last meal');
  assert.equal(at(5).color, 'var(--warning-color, #ffa600)');
  assert.equal(at(6).text, 'Estimated empty tray');
  assert.equal(at(6).color, 'var(--error-color, #db4437)');
  assert.equal(at(6).left, 0);
});

test('meals: unavailable or missing counter -> Unknown, all slots unknown, neutral colour', () => {
  for (const states of [{ [COUNTER]: st('unavailable') }, {}]) {
    const m = buildModel(mealCfg({ counter: COUNTER }), { states }, now).meals;
    assert.equal(m.text, 'Unknown');
    assert.equal(m.left, null);
    assert.equal(m.color, 'var(--disabled-color, #bdbdbd)');
    assert.deepEqual(
      m.slots.map((s) => s.state),
      Array(6).fill('unknown'),
    );
  }
  // hass not set yet
  assert.equal(buildModel(mealCfg({ counter: COUNTER }), undefined, now).meals.text, 'Unknown');
});

test('meals: meals_left alone drives the tray', () => {
  const m = buildModel(mealCfg({ meals_left: LEFT }), { states: { [LEFT]: st('1') } }, now).meals;
  assert.equal(m.entity, LEFT);
  assert.equal(m.left, 1);
  assert.equal(m.text, 'Estimated last meal');
  assert.deepEqual(
    m.slots.map((s) => s.state),
    ['eaten', 'eaten', 'eaten', 'eaten', 'serving', 'full'],
  );
});

test('meals: counter wins when both counter and meals_left are configured', () => {
  const m = buildModel(mealCfg({ counter: COUNTER, meals_left: LEFT }), { states: { [COUNTER]: st('2'), [LEFT]: st('1') } }, now).meals;
  assert.equal(m.entity, COUNTER);
  assert.equal(m.left, 4);
});

test('meals: absent without a counter/meals_left entity, or without meal_slots (aqara default)', () => {
  assert.equal(buildModel(mealCfg({ food_level: 'sensor.f' }), { states: {} }, now).meals, null);
  const aq = validateConfig({ model: 'aqara_c1', entities: { counter: COUNTER } });
  assert.equal(buildModel(aq, { states: { [COUNTER]: st('2') } }, now).meals, null);
  const aq4 = validateConfig({ model: 'aqara_c1', meal_slots: 4, entities: { counter: COUNTER } });
  const m = buildModel(aq4, { states: { [COUNTER]: st('1') } }, now).meals;
  assert.equal(m.total, 4);
  assert.equal(m.text, '3 of 4 left');
});

test('meals: custom meal_slots count', () => {
  const m = buildModel(mealCfg({ counter: COUNTER }, { meal_slots: 3 }), { states: { [COUNTER]: st('3') } }, now).meals;
  assert.equal(m.total, 3);
  assert.equal(m.slots.length, 3);
  assert.equal(m.text, 'Estimated empty tray');
});

test('camera entity is exposed for the camera button', () => {
  const cfg = validateConfig({ model: 'aqara_c1', entities: { camera: 'camera.cat' } });
  assert.equal(buildModel(cfg, { states: {} }, now).camera, 'camera.cat');
});
