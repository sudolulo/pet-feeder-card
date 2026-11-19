import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeStatus } from '../dist/pet-feeder-card.js';

test('no status entity means ready', () => {
  assert.deepEqual(normalizeStatus({}), {
    key: 'ready',
    label: 'Ready',
    icon: 'mdi:check-circle-outline',
    color: 'var(--success-color)',
  });
});

test('standby, idle and ready map to ready (case-insensitive)', () => {
  for (const s of ['standby', 'IDLE', 'Ready']) {
    assert.equal(normalizeStatus({ status: s }).key, 'ready', s);
    assert.equal(normalizeStatus({ status: s }).label, 'Ready', s);
  }
});

test('feeding and dispensing map to feeding', () => {
  for (const s of ['feeding', 'Dispensing']) {
    assert.deepEqual(normalizeStatus({ status: s }), {
      key: 'feeding',
      label: 'Feeding',
      icon: 'mdi:food-drumstick',
      color: 'var(--info-color)',
    });
  }
});

test('feeding_complete and done map to done / Fed', () => {
  for (const s of ['feeding_complete', 'DONE']) {
    assert.deepEqual(normalizeStatus({ status: s }), {
      key: 'done',
      label: 'Fed',
      icon: 'mdi:check-all',
      color: 'var(--success-color)',
    });
  }
});

test('no_food, last_meal, empty, run_out map to empty', () => {
  for (const s of ['no_food', 'last_meal', 'Empty', 'run_out']) {
    assert.deepEqual(normalizeStatus({ status: s }), {
      key: 'empty',
      label: 'Out of food',
      icon: 'mdi:alert-circle-outline',
      color: 'var(--error-color)',
    });
  }
});

test('error on gives fault and beats the status string', () => {
  assert.deepEqual(normalizeStatus({ status: 'feeding', error: 'on' }), {
    key: 'fault',
    label: 'Fault',
    icon: 'mdi:alert-octagon-outline',
    color: 'var(--error-color)',
  });
  assert.equal(normalizeStatus({ error: true }).key, 'fault');
  assert.equal(normalizeStatus({ status: 'standby', error: 'off' }).key, 'ready');
});

test('offline beats fault: available false, unavailable or unknown status', () => {
  const offline = {
    key: 'offline',
    label: 'Offline',
    icon: 'mdi:wifi-off',
    color: 'var(--disabled-color)',
  };
  assert.deepEqual(normalizeStatus({ status: 'standby', error: 'on', available: false }), offline);
  assert.deepEqual(normalizeStatus({ status: 'unavailable', error: 'on' }), offline);
  assert.deepEqual(normalizeStatus({ status: 'Unknown' }), offline);
});

test('unrecognised status is ready with the raw string title-cased', () => {
  assert.deepEqual(normalizeStatus({ status: 'self_cleaning mode' }), {
    key: 'ready',
    label: 'Self Cleaning Mode',
    icon: 'mdi:information-outline',
    color: 'var(--secondary-text-color)',
  });
});
