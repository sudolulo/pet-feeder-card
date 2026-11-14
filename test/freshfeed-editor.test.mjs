import test from 'node:test';
import assert from 'node:assert/strict';
import { createScheduleDraft, validateScheduleDraft, scheduleSaveData, freshfeedView } from '../card/freshfeed-model.js';

const row = { weekmask: 127, hour: 8, minute: 0, enabled: true, audible: false };

test('unknown schedules have no draft; observed empty schedules are editable', () => {
  assert.equal(createScheduleDraft({ entries: null, source_state: 'unknown', revision: null }), null);
  assert.equal(createScheduleDraft({ entries: [], source_state: 'unknown', revision: 'stale' }), null);
  assert.deepEqual(createScheduleDraft({ entries: [], source_state: 'current', revision: 'rev' }), { entries: [], baseRevision: 'rev' });
});

test('draft and save payload preserve order and flags without sharing rows', () => {
  const view = { entries: [row, { ...row, enabled: false }], source_state: 'last_known', revision: 'abc' };
  const draft = createScheduleDraft(view);
  const payload = scheduleSaveData('entry', draft);
  assert.deepEqual(payload, { entry_id: 'entry', entries: view.entries, base_revision: 'abc' });
  payload.entries[0].hour = 12;
  draft.entries[1].enabled = true;
  assert.equal(view.entries[0].hour, 8);
  assert.equal(view.entries[1].enabled, false);
  assert.equal(payload.entries[1].enabled, false);
});

test('validation requires bounded integer fields, boolean flags, and at most ten rows', () => {
  assert.deepEqual(validateScheduleDraft([]), { valid: true, error: null });
  assert.equal(validateScheduleDraft(Array(10).fill(row)).valid, true);
  assert.equal(validateScheduleDraft(Array(11).fill(row)).valid, false);
  for (const [key, values] of Object.entries({ weekmask: [0, 128, true, 1.5, '1'], hour: [-1, 24, false, '', 1.5], minute: [-1, 60, true, '', 1.5], enabled: [0, null, 'true'], audible: [1, null] })) {
    for (const value of values) assert.equal(validateScheduleDraft([{ ...row, [key]: value }]).valid, false, `${key}=${value}`);
  }
  assert.equal(validateScheduleDraft(null).valid, false);
  assert.equal(validateScheduleDraft([{ ...row, extra: true }]).valid, false);
});

test('missing entities yield the complete safe view', () => {
  assert.deepEqual(freshfeedView({ freshfeed: {} }, { states: {} }), {
    schedule: { entries: null, source_state: 'unknown', observed_at: null, revision: null, source_entity_id: null, error: null },
    draftAvailable: false, freshnessLabel: 'Unknown', lastSeen: null,
    writeState: 'blocked', operationId: null, operation: null, sessionId: null, reason: null,
    storageFault: false, integrityFault: false, recoveryCanStart: false, recoveryPhase: 'idle',
    canFeed: false, canDefrost: false, canRefilled: false, blockedReason: null,
    quickFeed: { status: null, command: null, minutes: null },
    history: { basis: 'ha_observed', events: [], dp151Supported: false },
  });
});

test('projects sensor data and copies history newest first', () => {
  const config = { freshfeed: { schedule_entity: 's', write_status_entity: 'w', quick_feed_entity: 'q', history_entity: 'h' } };
  const schedule = { entries: [row], source_state: 'last_known', observed_at: 'then', revision: 'r', source_entity_id: 's', error: null };
  const events = [{ kind: 'first' }, { kind: 'second' }];
  const states = { s: { state: '1', attributes: schedule }, w: { state: 'uncertain', attributes: { operation_id: 'o', operation: 'feed', session_id: 'x', can_feed: true } }, q: { state: 'feeding', attributes: { command: 'start', minutes: 3 } }, h: { state: '2', attributes: { events } } };
  const view = freshfeedView(config, { states });
  assert.equal(view.draftAvailable, true);
  assert.equal(view.freshnessLabel, 'Last known');
  assert.equal(view.lastSeen, 'then');
  assert.equal(view.writeState, 'uncertain');
  assert.equal(view.canFeed, true);
  assert.deepEqual(view.quickFeed, { status: 'feeding', command: 'start', minutes: 3 });
  assert.deepEqual(view.history.events.map(e => e.kind), ['second', 'first']);
  view.schedule.entries[0].hour = 1;
  view.history.events[0].kind = 'changed';
  assert.equal(schedule.entries[0].hour, 8);
  assert.equal(events[1].kind, 'second');
});

test('recovery phase and eligibility are projected independently of evidence', () => {
  for (const phase of ['idle', 'collecting', 'awaiting_user_confirmation', 'resolved', 'failed']) {
    const view = freshfeedView({ freshfeed: { write_status_entity: 'w' } }, { states: { w: { state: 'uncertain', attributes: { recovery_phase: phase, recovery_can_start: true, operation_id: 'op', session_id: 'session' } } } });
    assert.equal(view.recoveryPhase, phase);
    assert.equal(view.recoveryCanStart, true);
    assert.equal(view.operationId, 'op');
    assert.equal(view.sessionId, 'session');
  }
});
