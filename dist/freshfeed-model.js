const copy = value => structuredClone(value);

const eventLabels = { dispensed: 'Meal dispensed (observed)', refilled: 'Tray refilled (observed)', skipped_empty: 'Meal skipped: estimated empty tray', skipped_fault: 'Meal skipped: fault', meal_report: 'Meal report', all_meals_report: 'All meals report', interrupted: 'Feeding interrupted' };
export function feedingEventLabel(kind) { return Object.hasOwn(eventLabels, kind) ? eventLabels[kind] : 'Unknown feeding event'; }

const knownReasons = new Set('invalid_request confirmation_required invalid_operation admin_required unknown_entry source_unavailable recovery_rejected stopped storage_fault integrity_fault busy recovery_in_progress intent_uncertain source_incompatible schedule_unknown stale_schedule quick_feed_active defrost_active feeding_active status_unavailable cancel_not_pending empty_tray already_refilled controls_disabled source_not_ready schedule_conflict request_refused'.split(' '));
export function freshfeedErrorText(error, action) {
  const candidates = typeof error === 'string' ? [error] : [error?.translation_key, error?.reason, error?.code, error?.message];
  const reason = candidates.find(value => typeof value === 'string' && knownReasons.has(value)) ?? 'request_refused';
  let text = 'Check the feeder connection, controls and write status before trying again.';
  if (reason === 'request_refused') text = 'The request could not be confirmed. Check device and write status before trying again.';
  else if (reason === 'admin_required') text = 'Use an administrator account.';
  else if (['stale_schedule', 'schedule_conflict'].includes(reason)) text = 'Reload the schedule before saving again.';
  else if (['storage_fault', 'integrity_fault'].includes(reason)) text = 'Check storage and write status; do not delete retained intent.';
  else if (['intent_uncertain', 'recovery_in_progress', 'recovery_rejected'].includes(reason)) text = 'Inspect the feeder and use the existing recovery controls.';
  return text + (action === 'save' ? ' Your edits have been retained.' : '');
}

export function formatFreshfeedTimestamp(value, language, timeZone) {
  if (typeof value !== 'string' || !value.trim()) return 'Unknown time';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return 'Unknown time';
  try { if (language) new Intl.DateTimeFormat(language); } catch { language = undefined; }
  try { if (timeZone) new Intl.DateTimeFormat(undefined, { timeZone }); } catch { timeZone = undefined; }
  return new Intl.DateTimeFormat(language || undefined, { dateStyle: 'medium', timeStyle: 'short', timeZone: timeZone || undefined }).format(date);
}

export function createScheduleDraft(view) {
  if (!['current', 'last_known'].includes(view?.source_state) || !Array.isArray(view?.entries) || typeof view.revision !== 'string') return null;
  return { entries: copy(view.entries), baseRevision: view.revision };
}

export function validateScheduleDraft(entries) {
  if (!Array.isArray(entries) || entries.length > 10) return { valid: false, error: 'Schedule must contain at most 10 meals.' };
  const bounded = (value, min, max) => Number.isInteger(value) && value >= min && value <= max;
  for (const row of entries) {
    if (!row || Object.keys(row).length !== 5 || !bounded(row.weekmask, 1, 127) || !bounded(row.hour, 0, 23) || !bounded(row.minute, 0, 59) || typeof row.enabled !== 'boolean' || typeof row.audible !== 'boolean') {
      return { valid: false, error: 'Each meal needs days, a valid time, and boolean flags.' };
    }
  }
  return { valid: true, error: null };
}

export const LEAD_TIME_WARNING = 'A meal is due within 5 minutes. The feeder may already be preparing it; changes may not affect that meal. Saving is still allowed.';
export const LEAD_TIME_UNAVAILABLE = 'Meal timing is unavailable. The feeder may already be preparing a meal; saving is still allowed.';
const LEAD_WINDOW_MS = 5 * 60000;

// Wall-clock parts of an instant in an IANA zone, independent of the browser zone.
function zoneParts(format, ms) {
  const p = {};
  for (const { type, value } of format.formatToParts(new Date(ms))) if (type !== 'literal') p[type] = Number(value);
  return p;
}

// Every instant whose wall time in the zone is exactly y-m-d h:min: none in a DST gap, two in a fold.
function wallInstants(format, y, m, d, h, min) {
  const wall = Date.UTC(y, m - 1, d, h, min);
  const offsetAt = ms => { const p = zoneParts(format, ms); return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute) - Math.floor(ms / 60000) * 60000; };
  const candidates = new Set([wall - offsetAt(wall - 86400000), wall - offsetAt(wall), wall - offsetAt(wall + 86400000)]);
  return [...candidates].filter(ms => { const p = zoneParts(format, ms); return p.year === y && p.month === m && p.day === d && p.hour === h && p.minute === min; });
}

/**
 * Advisory only: the earliest enabled meal due 0..5 minutes (inclusive) after `now`
 * in the HA zone, or a timing-unavailable notice. Never a save gate.
 * Weekmask bits: Sun bit0, Sat bit1, Fri bit2, Thu bit3, Wed bit4, Tue bit5, Mon bit6.
 */
export function scheduleLeadTimeWarning(entries, now, timeZone) {
  const unavailable = { minutes: null, text: LEAD_TIME_UNAVAILABLE };
  try {
    if (!Array.isArray(entries) || !(now instanceof Date) || !Number.isFinite(now.getTime()) || typeof timeZone !== 'string' || !timeZone) return unavailable;
    const format = new Intl.DateTimeFormat('en-US', { timeZone, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric' });
    const bounded = (value, min, max) => Number.isInteger(value) && value >= min && value <= max;
    for (const row of entries) {
      if (!row || typeof row !== 'object' || typeof row.enabled !== 'boolean') return unavailable;
      if (row.enabled && (!bounded(row.weekmask, 0, 127) || !bounded(row.hour, 0, 23) || !bounded(row.minute, 0, 59))) return unavailable;
    }
    const nowMs = now.getTime();
    const today = zoneParts(format, nowMs);
    if (![today.year, today.month, today.day].every(Number.isInteger)) return unavailable;
    let best = null;
    // Yesterday..tomorrow covers a five-minute window across local midnight and DST shifts.
    for (const offset of [-1, 0, 1]) {
      const date = new Date(Date.UTC(today.year, today.month - 1, today.day + offset));
      const y = date.getUTCFullYear(), m = date.getUTCMonth() + 1, d = date.getUTCDate(), weekday = date.getUTCDay();
      const bit = weekday === 0 ? 0 : 7 - weekday;
      for (const row of entries) {
        if (!row.enabled || !(row.weekmask & (1 << bit))) continue;
        for (const at of wallInstants(format, y, m, d, row.hour, row.minute)) {
          const delta = at - nowMs;
          // A meal in the current minute counts as due now (0 minutes).
          if (delta > -60000 && delta <= LEAD_WINDOW_MS && (best === null || delta < best)) best = delta;
        }
      }
    }
    return best === null ? null : { minutes: Math.max(0, Math.ceil(best / 60000)), text: LEAD_TIME_WARNING };
  } catch {
    return unavailable;
  }
}

export function scheduleSaveData(entryId, draft) {
  return { entry_id: entryId, entries: copy(draft.entries), base_revision: draft.baseRevision };
}

function recoveryResolution(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== 4
      || !['operation_id', 'session_id', 'operation', 'outcome'].every(key => Object.hasOwn(value, key))
      || !['operation_id', 'session_id'].every(key => typeof value[key] === 'string' && value[key].length > 0 && value[key].length <= 128)
      || !['feed', 'cancel', 'defrost', 'refilled', 'schedule', 'settings'].includes(value.operation)
      || !['observed_safe', 'abandoned'].includes(value.outcome)) return null;
  return { operationId: value.operation_id, sessionId: value.session_id, operation: value.operation, outcome: value.outcome };
}

export function freshfeedView(config, hass) {
  const routes = config?.freshfeed ?? {};
  const entity = id => {
    const value = id ? hass?.states?.[id] : null;
    return value && value.state !== 'unavailable' && value.state !== 'unknown' ? value : null;
  };
  const scheduleEntity = entity(routes.schedule_entity);
  const a = scheduleEntity?.attributes ?? {};
  const schedule = {
    entries: Array.isArray(a.entries) ? copy(a.entries) : null,
    source_state: a.source_state ?? 'unknown', observed_at: a.observed_at ?? null,
    revision: a.revision ?? null, source_entity_id: a.source_entity_id ?? null, error: a.error ?? null,
  };
  const status = entity(routes.write_status_entity);
  const s = status?.attributes ?? {};
  const quick = entity(routes.quick_feed_entity);
  const q = quick?.attributes ?? {};
  const history = entity(routes.history_entity)?.attributes;
  return {
    schedule, draftAvailable: createScheduleDraft(schedule) !== null,
    freshnessLabel: a.provenance === 'cloud' ? 'Read from the PetSafe cloud' : schedule.source_state === 'current' ? 'Current' : schedule.source_state === 'last_known' ? 'Last known' : 'Unknown',
    lastSeen: schedule.observed_at,
    writeState: s.state ?? status?.state ?? 'blocked', operationId: s.operation_id ?? null,
    operation: s.operation ?? null, sessionId: s.session_id ?? null, reason: s.reason ?? null,
    observedFailure: s.observed_failure && ['operation_id', 'operation', 'session_id'].every(key => typeof s.observed_failure[key] === 'string' && s.observed_failure[key]) ? { operationId: s.observed_failure.operation_id, operation: s.observed_failure.operation, sessionId: s.observed_failure.session_id } : null,
    storageFault: s.storage_fault === true, integrityFault: s.integrity_fault === true,
    recoveryCanStart: s.recovery_can_start === true, recoveryPhase: s.recovery_phase ?? 'idle',
    recoveryResolutionPresent: Object.hasOwn(s, 'recovery_resolution'),
    recoveryResolution: recoveryResolution(s.recovery_resolution),
    canFeed: s.can_feed === true, canDefrost: s.can_defrost === true, canRefilled: s.can_refilled === true,
    blockedReason: s.blocked_reason ?? null, canCancel: s.can_cancel === true, cancelReason: s.cancel_reason ?? null,
    quickFeed: { status: ['idle', 'pending', 'feeding', 'ready', 'failed'].includes(quick?.state) ? quick.state : null, command: ['none', 'start', 'cancel', 'now'].includes(q.command) ? q.command : null, minutes: ['idle', 'pending', 'feeding', 'ready', 'failed'].includes(quick?.state) && Number.isFinite(q.minutes) ? q.minutes : null, haUpdated: typeof quick?.last_updated === 'string' && Number.isFinite(Date.parse(quick.last_updated)) ? quick.last_updated : null },
    history: { basis: 'ha_observed', events: Array.isArray(history?.events) ? copy(history.events).reverse() : [], dp151Supported: false },
  };
}
