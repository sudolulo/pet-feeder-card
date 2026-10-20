import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateConfig } from '../card/pet-feeder-card.js';

test('missing model throws a clear error', () => {
  assert.throws(() => validateConfig({}), /model.*required/i);
  assert.throws(() => validateConfig(undefined), /model.*required/i);
});

test('unknown model throws naming the supported models', () => {
  assert.throws(() => validateConfig({ model: 'petlibro' }), /freshfeed.*aqara_c1/);
});

test('freshfeed defaults', () => {
  const c = validateConfig({ model: 'freshfeed' });
  assert.equal(c.name, 'FreshFeed');
  assert.equal(c.color, 'black');
  assert.equal(c.food_label, 'Food');
  assert.equal(c.chip, 'last_feed');
  assert.deepEqual(c.footer, ['last_fed', 'portions_today', 'next_meal']);
  assert.deepEqual(c.entities, {});
  assert.deepEqual(c.actions, []);
  assert.deepEqual(c.controls, []);
});

test('aqara_c1 defaults to white and hopper art level', () => {
  const c = validateConfig({ model: 'aqara_c1' });
  assert.equal(c.name, 'Aqara C1');
  assert.equal(c.color, 'white');
  assert.equal(c.art_level, 'hopper');
});

test('user values override defaults and input is not mutated', () => {
  const input = { model: 'aqara_c1', name: 'Cat', color: 'black', art_level: 'bowl', food_label: 'Bowl' };
  const c = validateConfig(input);
  assert.equal(c.name, 'Cat');
  assert.equal(c.color, 'black');
  assert.equal(c.art_level, 'bowl');
  assert.equal(c.food_label, 'Bowl');
  assert.equal(input.chip, undefined);
});

test('actions default confirm to true and keep explicit false', () => {
  const c = validateConfig({
    model: 'freshfeed',
    actions: [
      { name: 'Feed', icon: 'mdi:food', action: 'button.press', target: { entity_id: 'button.x' } },
      { name: 'Reset', action: 'counter.reset', confirm: false },
    ],
  });
  assert.equal(c.actions[0].confirm, true);
  assert.equal(c.actions[1].confirm, false);
  assert.equal(c.actions[1].icon, 'mdi:gesture-tap-button');
});

test('invalid action, colour, art_level and limits throw', () => {
  assert.throws(() => validateConfig({ model: 'freshfeed', actions: [{ action: 'nodot' }] }), /domain\.service/);
  assert.throws(() => validateConfig({ model: 'freshfeed', color: 'pink' }), /color/);
  assert.throws(() => validateConfig({ model: 'aqara_c1', art_level: 'moon' }), /art_level/);
  const four = Array.from({ length: 4 }, () => ({ action: 'a.b' }));
  assert.throws(() => validateConfig({ model: 'freshfeed', actions: four }), /at most 3/);
  assert.throws(
    () => validateConfig({ model: 'freshfeed', footer: ['last_fed', 'counter', 'temperature', 'next_meal'] }),
    /at most 3/,
  );
  assert.throws(() => validateConfig({ model: 'freshfeed', footer: ['bogus'] }), /bogus/);
  assert.throws(() => validateConfig({ model: 'freshfeed', chip: 'bogus' }), /bogus/);
});
