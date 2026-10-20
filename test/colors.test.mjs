import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gaugeColor, ledColor } from '../card/pet-feeder-card.js';

test('gauge is green at 50% and above', () => {
  assert.match(gaugeColor(50), /--success-color/);
  assert.match(gaugeColor(100), /--success-color/);
});

test('gauge is amber from 20 to 49%', () => {
  assert.match(gaugeColor(20), /--warning-color/);
  assert.match(gaugeColor(49), /--warning-color/);
});

test('gauge is red below 20%', () => {
  assert.match(gaugeColor(19), /--error-color/);
  assert.match(gaugeColor(0), /--error-color/);
});

test('gauge with unknown level is neutral', () => {
  assert.match(gaugeColor(null), /--disabled-color/);
});

test('FreshFeed LED: blue normally, amber when low, red on fault/empty, grey offline', () => {
  assert.equal(ledColor('ready', 100), '#3b82f6');
  assert.equal(ledColor('feeding', null), '#3b82f6');
  assert.equal(ledColor('ready', 20), '#f59e0b');
  assert.equal(ledColor('fault', 100), '#ef4444');
  assert.equal(ledColor('empty', 100), '#ef4444');
  assert.equal(ledColor('ready', 0), '#ef4444');
  assert.equal(ledColor('offline', 0), '#6b7280');
});
