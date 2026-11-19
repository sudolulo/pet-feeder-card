import test from 'node:test';
import assert from 'node:assert/strict';
import { scheduleLeadTimeWarning } from '../dist/freshfeed-model.js';

const WARNING = 'A meal is due within 5 minutes. The feeder may already be preparing it; changes may not affect that meal. Saving is still allowed.';
const UNAVAILABLE = 'Meal timing is unavailable. The feeder may already be preparing a meal; saving is still allowed.';
const SUN = 1, SAT = 2, WED = 16, MON = 64;
const meal = (hour, minute, weekmask = 127, enabled = true) => ({ weekmask, hour, minute, enabled, audible: false });
const at = iso => new Date(iso);

test('test_warning_boundaries', () => {
  // 2026-11-18 is a Wednesday (bit4) in UTC.
  const rows = [meal(8, 0, WED)];
  assert.deepEqual(scheduleLeadTimeWarning(rows, at('2026-11-18T08:00:00Z'), 'UTC'), { minutes: 0, text: WARNING });
  assert.deepEqual(scheduleLeadTimeWarning(rows, at('2026-11-18T07:59:00Z'), 'UTC'), { minutes: 1, text: WARNING });
  assert.deepEqual(scheduleLeadTimeWarning(rows, at('2026-11-18T07:55:00Z'), 'UTC'), { minutes: 5, text: WARNING });
  assert.equal(scheduleLeadTimeWarning(rows, at('2026-11-18T07:54:00Z'), 'UTC'), null);
  assert.equal(scheduleLeadTimeWarning(rows, at('2026-11-18T07:54:30Z'), 'UTC'), null);
  // Disabled, past, no-day and non-matching weekday rows do not warn.
  assert.equal(scheduleLeadTimeWarning([meal(8, 0, WED, false)], at('2026-11-18T07:58:00Z'), 'UTC'), null);
  assert.equal(scheduleLeadTimeWarning([meal(7, 59, WED)], at('2026-11-18T08:00:00Z'), 'UTC'), null);
  assert.equal(scheduleLeadTimeWarning([meal(8, 0, 0)], at('2026-11-18T07:58:00Z'), 'UTC'), null);
  assert.equal(scheduleLeadTimeWarning([meal(8, 0, 127 & ~WED)], at('2026-11-18T07:58:00Z'), 'UTC'), null);
  assert.equal(scheduleLeadTimeWarning([], at('2026-11-18T07:58:00Z'), 'UTC'), null);
  // The earliest qualifying meal is reported once.
  assert.deepEqual(scheduleLeadTimeWarning([meal(8, 3), meal(8, 1), meal(8, 4)], at('2026-11-18T08:00:00Z'), 'UTC'), { minutes: 1, text: WARNING });
});

test('test_midnight_week_rollover_uses_ha_zone', () => {
  // Saturday 23:57 in Auckland is Saturday 10:57 UTC: a browser-UTC weekday/hour would never warn.
  const saturdayNight = at('2026-11-21T10:57:00Z');
  assert.deepEqual(scheduleLeadTimeWarning([meal(0, 0, SUN)], saturdayNight, 'Pacific/Auckland'), { minutes: 3, text: WARNING });
  assert.equal(scheduleLeadTimeWarning([meal(0, 0, SAT)], saturdayNight, 'Pacific/Auckland'), null);
  assert.equal(scheduleLeadTimeWarning([meal(0, 0, SUN)], saturdayNight, 'UTC'), null);
  // Sunday 23:58 rolls over into Monday (bit6).
  const sundayNight = at('2026-11-22T10:58:00Z');
  assert.deepEqual(scheduleLeadTimeWarning([meal(0, 1, MON)], sundayNight, 'Pacific/Auckland'), { minutes: 3, text: WARNING });
  assert.equal(scheduleLeadTimeWarning([meal(0, 1, SUN)], sundayNight, 'Pacific/Auckland'), null);
});

test('test_dst_gap_fold', () => {
  const zone = 'America/New_York';
  // 2026-03-08 (Sunday): 02:00 EST jumps to 03:00 EDT; 01:58 EST is 06:58Z.
  const beforeGap = at('2026-03-08T06:58:00Z');
  assert.equal(scheduleLeadTimeWarning([meal(2, 0, SUN)], beforeGap, zone), null);
  assert.equal(scheduleLeadTimeWarning([meal(2, 2, SUN)], beforeGap, zone), null);
  assert.deepEqual(scheduleLeadTimeWarning([meal(3, 0, SUN)], beforeGap, zone), { minutes: 2, text: WARNING });
  // 2026-11-01 (Sunday): 01:30 occurs at 05:30Z (EDT) and 06:30Z (EST).
  assert.deepEqual(scheduleLeadTimeWarning([meal(1, 30, SUN)], at('2026-11-01T05:27:00Z'), zone), { minutes: 3, text: WARNING });
  assert.deepEqual(scheduleLeadTimeWarning([meal(1, 30, SUN)], at('2026-11-01T06:27:00Z'), zone), { minutes: 3, text: WARNING });
  assert.equal(scheduleLeadTimeWarning([meal(1, 30, SUN)], at('2026-11-01T06:00:00Z'), zone), null);
});

test('test_invalid_time_information_advises_without_throw', () => {
  const unavailable = { minutes: null, text: UNAVAILABLE };
  const now = at('2026-11-18T07:58:00Z');
  const rows = [meal(8, 0)];
  for (const badNow of [new Date('invalid'), null, undefined, '2026-11-18T07:58:00Z', 0]) {
    assert.deepEqual(scheduleLeadTimeWarning(rows, badNow, 'UTC'), unavailable);
  }
  for (const badZone of ['Not/A_Zone', '', null, undefined, 42]) {
    assert.deepEqual(scheduleLeadTimeWarning(rows, now, badZone), unavailable);
  }
  for (const badEntries of [null, undefined, 'rows', {}]) {
    assert.deepEqual(scheduleLeadTimeWarning(badEntries, now, 'UTC'), unavailable);
  }
  for (const badRow of [null, 'row', { ...meal(8, 0), hour: null }, { ...meal(8, 0), hour: 24 }, { ...meal(8, 0), minute: 1.5 }, { ...meal(8, 0), weekmask: 128 }, { ...meal(8, 0), enabled: 'yes' }]) {
    assert.deepEqual(scheduleLeadTimeWarning([meal(9, 0), badRow], now, 'UTC'), unavailable);
  }
});
