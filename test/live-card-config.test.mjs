import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildModel, validateConfig } from '../card/pet-feeder-card.js';

const loadConfig = () => JSON.parse(readFileSync(new URL('../deploy/freshfeed-live-card.json', import.meta.url), 'utf8'));

test('live FreshFeed card binds read-only entities and renders the empty tray', () => {
  const config = loadConfig();
  assert.equal(config.type, 'custom:pet-feeder-card');
  assert.equal(config.model, 'freshfeed');
  assert.equal(config.name, 'FreshFeed');
  assert.equal(config.food_label, 'Food');
  assert.equal(config.meal_slots, 6);
  assert.equal(config.chip, false);
  assert.deepEqual(config.footer, ['last_fed', 'next_meal']);
  assert.deepEqual(config.entities, {
    status: 'sensor.petsafe_freshfeed_status',
    food_level: 'sensor.petsafe_freshfeed_food_level',
    error: 'binary_sensor.petsafe_freshfeed_fault',
    meals_left: 'sensor.petsafe_freshfeed_meals_left',
    last_fed: 'sensor.petsafe_freshfeed_last_fed',
    next_meal: 'sensor.petsafe_freshfeed_next_meal',
  });
  assert.deepEqual(config.controls, [
    'sensor.petsafe_freshfeed_status', 'sensor.petsafe_freshfeed_meals_left',
    'sensor.petsafe_freshfeed_compartment', 'sensor.petsafe_freshfeed_food_level',
    'sensor.petsafe_freshfeed_last_fed', 'sensor.petsafe_freshfeed_last_feed_result',
    'sensor.petsafe_freshfeed_meals_today', 'sensor.petsafe_freshfeed_next_meal',
    'sensor.petsafe_freshfeed_defrost_remaining', 'sensor.petsafe_freshfeed_brightness',
    'sensor.petsafe_freshfeed_firmware_a', 'sensor.petsafe_freshfeed_firmware_b',
    'sensor.petsafe_freshfeed_last_report', 'binary_sensor.petsafe_freshfeed_connected',
    'binary_sensor.petsafe_freshfeed_fault', 'binary_sensor.petsafe_freshfeed_out_of_food',
    'binary_sensor.petsafe_freshfeed_defrosting', 'event.petsafe_freshfeed_feeding',
    'switch.petsafe_freshfeed_stainless_inserts',
    'switch.petsafe_freshfeed_meal_counter', 'number.petsafe_freshfeed_brightness',
    'sensor.petsafe_freshfeed_quick_feed_state',
  ]);
  assert.deepEqual(config.actions, [
    { name: 'Feed', icon: 'mdi:food-drumstick', action: 'petsafe_freshfeed.command', data: { operation: 'feed' }, confirm: true },
    { name: 'Defrost', icon: 'mdi:snowflake-melt', action: 'petsafe_freshfeed.command', data: { operation: 'defrost' }, confirm: true },
    { name: 'Refilled', icon: 'mdi:tray-arrow-down', action: 'petsafe_freshfeed.command', data: { operation: 'refilled' }, confirm: true },
  ]);
  assert.doesNotMatch(JSON.stringify(config), /input_/);

  assert.deepEqual(config.freshfeed, {
    entry_id: 'REPLACE_WITH_INTEGRATION_ENTRY_ID',
    schedule_entity: 'sensor.petsafe_freshfeed_schedule',
    write_status_entity: 'sensor.petsafe_freshfeed_write_status',
    quick_feed_entity: 'sensor.petsafe_freshfeed_quick_feed',
    history_entity: 'sensor.petsafe_freshfeed_history',
  });
  assert.throws(() => validateConfig(config), /bind/);
  config.freshfeed.entry_id = 'synthetic-entry';
  const st = (state) => ({ state, attributes: {}, last_changed: '2026-11-10T18:00:00Z' });
  const model = buildModel(validateConfig(config), { states: {
    'sensor.petsafe_freshfeed_status': st('no_food'),
    'sensor.petsafe_freshfeed_food_level': st('empty'),
    'binary_sensor.petsafe_freshfeed_fault': st('off'),
    'sensor.petsafe_freshfeed_meals_left': st('0'),
    'sensor.petsafe_freshfeed_last_fed': st('2026-11-10T17:00:00Z'),
    'sensor.petsafe_freshfeed_next_meal': st('2026-11-11T00:00:00Z'),
  } }, new Date('2026-11-10T20:00:00Z'));
  assert.equal(model.status.key, 'empty');
  assert.equal(model.meals.total, 6);
  assert.equal(model.meals.slots.length, 6);
  assert.equal(model.meals.left, 0);
});
