import { test } from 'node:test';
import assert from 'node:assert/strict';
import { relativeTime } from '../card/pet-feeder-card.js';

const now = new Date(2026, 9, 20, 12, 0, 0);
const ago = (ms) => new Date(now.getTime() - ms);
const ahead = (ms) => new Date(now.getTime() + ms);
const S = 1000;
const M = 60 * S;
const H = 60 * M;
const D = 24 * H;

test('under 45 seconds either way is just now', () => {
  assert.equal(relativeTime(now, now), 'just now');
  assert.equal(relativeTime(ago(44 * S), now), 'just now');
  assert.equal(relativeTime(ahead(30 * S), now), 'just now');
});

test('past minutes, hours and days', () => {
  assert.equal(relativeTime(ago(45 * S), now), '1 minute ago');
  assert.equal(relativeTime(ago(51 * M), now), '51 minutes ago');
  assert.equal(relativeTime(ago(90 * M), now), '2 hours ago');
  assert.equal(relativeTime(ago(1 * H), now), '1 hour ago');
  assert.equal(relativeTime(ago(23 * H), now), '23 hours ago');
  assert.equal(relativeTime(ago(36 * H), now), '2 days ago');
  assert.equal(relativeTime(ago(1 * D), now), '1 day ago');
});

test('future minutes, hours and days', () => {
  assert.equal(relativeTime(ahead(5 * M), now), 'in 5 minutes');
  assert.equal(relativeTime(ahead(1 * M), now), 'in 1 minute');
  assert.equal(relativeTime(ahead(3 * H), now), 'in 3 hours');
  assert.equal(relativeTime(ahead(2 * D), now), 'in 2 days');
});

test('accepts ISO strings and timestamps; invalid input gives empty string', () => {
  assert.equal(relativeTime(ago(10 * M).toISOString(), now), '10 minutes ago');
  assert.equal(relativeTime(ago(10 * M).getTime(), now), '10 minutes ago');
  assert.equal(relativeTime('garbage', now), '');
  assert.equal(relativeTime(null, now), '');
});
