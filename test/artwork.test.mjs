import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderArt } from '../dist/pet-feeder-card.js';

const ff = (over = {}) => renderArt({ model: 'freshfeed', color: 'black', artLevel: 'hopper', statusKey: 'ready', foodPct: 100, ...over });
const aq = (over = {}) => renderArt({ model: 'aqara_c1', color: 'white', artLevel: 'hopper', statusKey: 'ready', foodPct: 100, ...over });

// Pull an attribute off the first element carrying a given class.
function attrOf(svg, cls, attr) {
  const el = new RegExp(`<[^>]*class="[^"]*\\b${cls}\\b[^"]*"[^>]*>`).exec(svg);
  if (!el) return null;
  const m = new RegExp(`\\b${attr}="([^"]*)"`).exec(el[0]);
  return m ? m[1] : null;
}

test('renders a single svg root with a soft floor shadow', () => {
  for (const svg of [ff(), aq()]) {
    assert.match(svg, /^<svg[\s>]/);
    assert.match(svg, /class="[^"]*\bfloor-shadow\b/);
  }
});

test('FreshFeed LED follows status and food level, with a snowflake glyph', () => {
  assert.equal(attrOf(ff(), 'led', 'stroke'), '#3b82f6');
  assert.equal(attrOf(ff({ foodPct: 20 }), 'led', 'stroke'), '#f59e0b');
  assert.equal(attrOf(ff({ statusKey: 'fault' }), 'led', 'stroke'), '#ef4444');
  assert.equal(attrOf(ff({ statusKey: 'offline' }), 'led', 'stroke'), '#6b7280');
  assert.match(ff(), /class="[^"]*\bsnowflake\b/);
});

test('FreshFeed has serving window food, vent grille and three feet', () => {
  const svg = ff();
  assert.match(svg, /class="[^"]*\bwindow-food\b/);
  assert.ok((svg.match(/class="vent-slot"/g) || []).length >= 6);
  assert.equal((svg.match(/class="foot"/g) || []).length, 3);
});

test('root carries state classes for feeding and offline', () => {
  assert.match(ff({ statusKey: 'feeding' }), /^<svg[^>]*class="[^"]*\bis-feeding\b/);
  assert.match(aq({ statusKey: 'offline' }), /^<svg[^>]*class="[^"]*\bis-offline\b/);
  assert.doesNotMatch(ff(), /^<svg[^>]*class="[^"]*\bis-feeding\b/);
});

test('artwork colour changes the body palette', () => {
  assert.notEqual(ff({ color: 'black' }), ff({ color: 'white' }));
  assert.notEqual(aq({ color: 'black' }), aq({ color: 'white' }));
});

test('Aqara hopper fill height is proportional to the food percentage', () => {
  const full = Number(attrOf(aq({ foodPct: 100 }), 'hopper-food', 'height'));
  const quarter = Number(attrOf(aq({ foodPct: 25 }), 'hopper-food', 'height'));
  assert.ok(full > 0);
  assert.ok(Math.abs(quarter - full / 4) < 0.01, `${quarter} vs ${full / 4}`);
  assert.equal(Number(attrOf(aq({ foodPct: 0 }), 'hopper-food', 'height')), 0);
});

test('Aqara bowl mode heaps food in the bowl only when level > 0', () => {
  assert.match(aq({ artLevel: 'bowl', foodPct: 100 }), /class="[^"]*\bbowl-heap\b/);
  assert.doesNotMatch(aq({ artLevel: 'bowl', foodPct: 0 }), /bowl-heap/);
  assert.doesNotMatch(aq({ artLevel: 'bowl', foodPct: null }), /bowl-heap/);
});

test('Aqara feeding drops 3-5 kibble pieces into the bowl', () => {
  const n = (aq({ statusKey: 'feeding' }).match(/class="kibble-drop"/g) || []).length;
  assert.ok(n >= 3 && n <= 5, `got ${n}`);
  assert.doesNotMatch(aq(), /kibble-drop/);
});
