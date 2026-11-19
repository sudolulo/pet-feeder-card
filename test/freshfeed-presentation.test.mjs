import test from 'node:test';
import assert from 'node:assert/strict';
import * as model from '../dist/freshfeed-model.js';

test('event_labels_cover_seven_kinds_and_unknown', () => {
  for (const [kind,label] of Object.entries({dispensed:'Meal dispensed (observed)',refilled:'Tray refilled (observed)',skipped_empty:'Meal skipped: estimated empty tray',skipped_fault:'Meal skipped: fault',meal_report:'Meal report',all_meals_report:'All meals report',interrupted:'Feeding interrupted',other:'Unknown feeding event'})) assert.equal(model.feedingEventLabel(kind),label);
});
test('timestamp_uses_ha_zone_and_locale_with_safe_fallbacks', () => {
  const value='2026-01-01T00:00:00Z';
  assert.equal(model.formatFreshfeedTimestamp(value,'en-US','America/New_York'),new Intl.DateTimeFormat('en-US',{dateStyle:'medium',timeStyle:'short',timeZone:'America/New_York'}).format(new Date(value)));
  assert.equal(model.formatFreshfeedTimestamp(null),'Unknown time'); assert.equal(model.formatFreshfeedTimestamp('bad'),'Unknown time');
  assert.doesNotThrow(()=>model.formatFreshfeedTimestamp(value,'invalid_locale','invalid/zone'));
});
test('error_mapping_is_actionable_without_raw_text', () => {
  assert.equal(model.freshfeedErrorText({translation_key:'admin_required'},'command'),'Use an administrator account.');
  assert.match(model.freshfeedErrorText({reason:'schedule_conflict'},'save'),/Reload the schedule.*Your edits have been retained/);
  assert.match(model.freshfeedErrorText('storage_fault','command'),/do not delete retained intent/);
  assert.match(model.freshfeedErrorText('intent_uncertain','recover'),/existing recovery controls/);
  assert.match(model.freshfeedErrorText('source_unavailable','command'),/feeder connection/);
  assert.doesNotMatch(model.freshfeedErrorText(new Error('secret admin_required'),'command'),/secret|administrator/);
});
