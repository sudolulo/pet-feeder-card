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
  assert.equal(m.status.key, 'ready');
  assert.equal(m.food, null);
  assert.equal(m.chip, null);
  assert.deepEqual(m.footer, []);
  assert.equal(m.camera, null);
  assert.deepEqual(m.art, { model: 'freshfeed', color: 'black', artLevel: 'hopper', statusKey: 'ready', foodPct: null });
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
      ['last_fed', '51 minutes ago'],
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
  assert.equal(m.status.key, 'offline');
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

test('camera entity is exposed for the camera button', () => {
  const cfg = validateConfig({ model: 'aqara_c1', entities: { camera: 'camera.cat' } });
  assert.equal(buildModel(cfg, { states: {} }, now).camera, 'camera.cat');
});
