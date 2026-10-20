import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseAqaraSchedule } from '../card/pet-feeder-card.js';

const LIVE =
  "[{'days': 'everyday', 'hour': 7, 'minute': 0, 'size': 3}, {'days': 'everyday', 'hour': 10, 'minute': 0, 'size': 3}, " +
  "{'days': 'everyday', 'hour': 2, 'minute': 0, 'size': 3}, {'days': 'everyday', 'hour': 6, 'minute': 0, 'size': 3}, " +
  "{'hour': 9, 'size': 3}]";

test('parses the live Python-literal schedule string, filling defaults', () => {
  assert.deepEqual(parseAqaraSchedule(LIVE), [
    { days: 'everyday', hour: 7, minute: 0, size: 3 },
    { days: 'everyday', hour: 10, minute: 0, size: 3 },
    { days: 'everyday', hour: 2, minute: 0, size: 3 },
    { days: 'everyday', hour: 6, minute: 0, size: 3 },
    { days: 'everyday', hour: 9, minute: 0, size: 3 },
  ]);
});

test('missing size defaults to 1 and days are kept verbatim', () => {
  assert.deepEqual(parseAqaraSchedule("[{'days': 'mon-wed-fri', 'hour': 18, 'minute': 30}]"), [
    { days: 'mon-wed-fri', hour: 18, minute: 30, size: 1 },
  ]);
});

test('accepts JSON (double quotes) too', () => {
  assert.deepEqual(parseAqaraSchedule('[{"days": "weekend", "hour": 8, "minute": 15, "size": 2}]'), [
    { days: 'weekend', hour: 8, minute: 15, size: 2 },
  ]);
});

test('empty list gives []', () => {
  assert.deepEqual(parseAqaraSchedule('[]'), []);
});

test('invalid input gives []', () => {
  for (const bad of [undefined, null, '', 'unknown', 'not a list', "[{'hour': }]", '{"hour": 7}', 42]) {
    assert.deepEqual(parseAqaraSchedule(bad), [], String(bad));
  }
});

test('entries without a valid hour are dropped', () => {
  assert.deepEqual(parseAqaraSchedule("[{'minute': 5}, {'hour': 25}, {'hour': 4, 'minute': 99}, {'hour': 1}]"), [
    { days: 'everyday', hour: 1, minute: 0, size: 1 },
  ]);
});
