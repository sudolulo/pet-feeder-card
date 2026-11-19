import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mealSlots } from '../dist/pet-feeder-card.js';

const states = (r) => r.slots.map((s) => s.state);
const nextOf = (r) => r.slots.filter((s) => s.next).map((s) => s.n);

test('nothing delivered: every compartment full, next is meal 1', () => {
  const r = mealSlots({ slots: 6, delivered: 0, left: null });
  assert.equal(r.known, true);
  assert.equal(r.delivered, 0);
  assert.equal(r.left, 6);
  assert.deepEqual(states(r), ['full', 'full', 'full', 'full', 'full', 'full']);
  assert.deepEqual(nextOf(r), [1]);
  assert.deepEqual(
    r.slots.map((s) => s.n),
    [1, 2, 3, 4, 5, 6],
  );
});

test('partial: earlier meals eaten, the last delivered one is in the window', () => {
  const r = mealSlots({ slots: 6, delivered: 2, left: null });
  assert.equal(r.known, true);
  assert.equal(r.delivered, 2);
  assert.equal(r.left, 4);
  assert.deepEqual(states(r), ['eaten', 'serving', 'full', 'full', 'full', 'full']);
  assert.deepEqual(nextOf(r), [3]);
});

test('all delivered: last compartment serving, none left, no next', () => {
  const r = mealSlots({ slots: 6, delivered: 6, left: null });
  assert.equal(r.left, 0);
  assert.deepEqual(states(r), ['eaten', 'eaten', 'eaten', 'eaten', 'eaten', 'serving']);
  assert.deepEqual(nextOf(r), []);
});

test('over-range values clamp to 0..slots', () => {
  const hi = mealSlots({ slots: 6, delivered: 9, left: null });
  assert.equal(hi.delivered, 6);
  assert.equal(hi.left, 0);
  assert.deepEqual(states(hi), ['eaten', 'eaten', 'eaten', 'eaten', 'eaten', 'serving']);
  const lo = mealSlots({ slots: 6, delivered: -3, left: null });
  assert.equal(lo.delivered, 0);
  assert.equal(lo.left, 6);
  const leftHi = mealSlots({ slots: 6, delivered: null, left: 10 });
  assert.equal(leftHi.delivered, 0);
  assert.equal(leftHi.left, 6);
});

test('only left given: delivered = slots - left', () => {
  const r = mealSlots({ slots: 6, delivered: null, left: 1 });
  assert.equal(r.known, true);
  assert.equal(r.delivered, 5);
  assert.equal(r.left, 1);
  assert.deepEqual(states(r), ['eaten', 'eaten', 'eaten', 'eaten', 'serving', 'full']);
  assert.deepEqual(nextOf(r), [6]);
});

test('unavailable or non-numeric input: unknown, every slot unknown', () => {
  for (const input of [
    { delivered: null, left: null },
    { delivered: NaN, left: null },
    { delivered: 'unavailable', left: null },
    { delivered: undefined, left: undefined },
    { delivered: '', left: null },
  ]) {
    const r = mealSlots({ slots: 6, ...input });
    assert.equal(r.known, false, JSON.stringify(input));
    assert.equal(r.left, null);
    assert.equal(r.delivered, null);
    assert.equal(r.slots.length, 6);
    assert.deepEqual(states(r), Array(6).fill('unknown'));
    assert.deepEqual(nextOf(r), []);
  }
});

test('works for other compartment counts', () => {
  const r = mealSlots({ slots: 3, delivered: 1, left: null });
  assert.deepEqual(states(r), ['serving', 'full', 'full']);
  assert.equal(r.left, 2);
});
