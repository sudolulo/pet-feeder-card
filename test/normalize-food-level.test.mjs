import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeFoodLevel } from '../dist/pet-feeder-card.js';

test('numeric states give that percentage', () => {
  assert.deepEqual(normalizeFoodLevel('42'), { pct: 42, label: '42%' });
  assert.deepEqual(normalizeFoodLevel(0), { pct: 0, label: '0%' });
  assert.deepEqual(normalizeFoodLevel('100'), { pct: 100, label: '100%' });
  assert.deepEqual(normalizeFoodLevel('37.6'), { pct: 38, label: '38%' });
});

test('numeric states are clamped to 0-100', () => {
  assert.deepEqual(normalizeFoodLevel('140'), { pct: 100, label: '100%' });
  assert.deepEqual(normalizeFoodLevel('-5'), { pct: 0, label: '0%' });
});

test('full-ish strings map to 100 Full', () => {
  for (const s of ['high', 'Enough', 'FULL']) {
    assert.deepEqual(normalizeFoodLevel(s), { pct: 100, label: 'Full' }, s);
  }
});

test('medium and half map to 50 Half', () => {
  for (const s of ['medium', 'Half']) assert.deepEqual(normalizeFoodLevel(s), { pct: 50, label: 'Half' });
});

test('low and insufficient map to 20 Low', () => {
  for (const s of ['low', 'Insufficient']) assert.deepEqual(normalizeFoodLevel(s), { pct: 20, label: 'Low' });
});

test('empty and run_out map to 0 Empty', () => {
  for (const s of ['empty', 'RUN_OUT']) assert.deepEqual(normalizeFoodLevel(s), { pct: 0, label: 'Empty' });
});

test('missing or unavailable values are Unknown', () => {
  for (const s of ['unavailable', 'unknown', 'None', '', null, undefined]) {
    assert.deepEqual(normalizeFoodLevel(s), { pct: null, label: 'Unknown' }, String(s));
  }
});

test('other strings are title-cased with no percentage', () => {
  assert.deepEqual(normalizeFoodLevel('almost_gone'), { pct: null, label: 'Almost Gone' });
});
