import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nextMeal, parseAqaraSchedule } from '../card/pet-feeder-card.js';

// 2026-10-20 is a Tuesday. All dates are local time, as the card uses local time.
const tue = (h, m = 0, s = 0) => new Date(2026, 9, 20, h, m, s);
const day = (d, h, m = 0) => new Date(2026, 9, d, h, m, 0);

const LIVE = parseAqaraSchedule(
  "[{'days': 'everyday', 'hour': 7, 'minute': 0, 'size': 3}, {'days': 'everyday', 'hour': 10, 'minute': 0, 'size': 3}, " +
    "{'days': 'everyday', 'hour': 2, 'minute': 0, 'size': 3}, {'days': 'everyday', 'hour': 6, 'minute': 0, 'size': 3}, " +
    "{'hour': 9, 'size': 3}]",
);

test('picks the earliest upcoming slot later today', () => {
  assert.deepEqual(nextMeal(LIVE, tue(6, 30)), { at: tue(7, 0), size: 3 });
  assert.deepEqual(nextMeal(LIVE, tue(9, 15)), { at: tue(10, 0), size: 3 });
});

test('a slot exactly at now is not upcoming (strictly after)', () => {
  assert.deepEqual(nextMeal(LIVE, tue(7, 0)), { at: tue(9, 0), size: 3 });
});

test('after the last slot of the day rolls over to tomorrow', () => {
  assert.deepEqual(nextMeal(LIVE, tue(21, 0)), { at: day(21, 2), size: 3 });
});

test('empty or missing schedule gives null', () => {
  assert.equal(nextMeal([], tue(8)), null);
  assert.equal(nextMeal(null, tue(8)), null);
});

test('workdays skips the weekend', () => {
  // Friday 23rd 20:00 -> next workday slot is Monday 26th 08:00.
  const s = [{ days: 'workdays', hour: 8, minute: 0, size: 2 }];
  assert.deepEqual(nextMeal(s, day(23, 20)), { at: day(26, 8), size: 2 });
});

test('weekend only fires Saturday and Sunday', () => {
  const s = [{ days: 'weekend', hour: 9, minute: 30, size: 1 }];
  assert.deepEqual(nextMeal(s, tue(12)), { at: day(24, 9, 30), size: 1 });
  assert.deepEqual(nextMeal(s, day(24, 10)), { at: day(25, 9, 30), size: 1 });
});

test('single days and hyphen-joined day lists', () => {
  assert.deepEqual(nextMeal([{ days: 'thu', hour: 5, minute: 0, size: 4 }], tue(12)), { at: day(22, 5), size: 4 });
  const s = [{ days: 'mon-wed-fri-sun', hour: 18, minute: 0, size: 2 }];
  assert.deepEqual(nextMeal(s, tue(19)), { at: day(21, 18), size: 2 });
  assert.deepEqual(nextMeal(s, day(21, 19)), { at: day(23, 18), size: 2 });
});

test('a weekly slot earlier today is found next week (within 7 days)', () => {
  const s = [{ days: 'tue', hour: 6, minute: 0, size: 1 }];
  assert.deepEqual(nextMeal(s, tue(12)), { at: day(27, 6), size: 1 });
});

test('unknown day spec never matches', () => {
  assert.equal(nextMeal([{ days: 'someday', hour: 6, minute: 0, size: 1 }], tue(1)), null);
});
