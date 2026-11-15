const copy = value => structuredClone(value);

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

export function scheduleSaveData(entryId, draft) {
  return { entry_id: entryId, entries: copy(draft.entries), base_revision: draft.baseRevision };
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
    freshnessLabel: schedule.source_state === 'current' ? 'Current' : schedule.source_state === 'last_known' ? 'Last known' : 'Unknown',
    lastSeen: schedule.observed_at,
    writeState: s.state ?? status?.state ?? 'blocked', operationId: s.operation_id ?? null,
    operation: s.operation ?? null, sessionId: s.session_id ?? null, reason: s.reason ?? null,
    observedFailure: s.observed_failure && ['operation_id', 'operation', 'session_id'].every(key => typeof s.observed_failure[key] === 'string' && s.observed_failure[key]) ? { operationId: s.observed_failure.operation_id, operation: s.observed_failure.operation, sessionId: s.observed_failure.session_id } : null,
    storageFault: s.storage_fault === true, integrityFault: s.integrity_fault === true,
    recoveryCanStart: s.recovery_can_start === true, recoveryPhase: s.recovery_phase ?? 'idle',
    canFeed: s.can_feed === true, canDefrost: s.can_defrost === true, canRefilled: s.can_refilled === true,
    blockedReason: s.blocked_reason ?? null, canCancel: s.can_cancel === true, cancelReason: s.cancel_reason ?? null,
    quickFeed: { status: ['idle', 'pending', 'feeding', 'ready', 'failed'].includes(quick?.state) ? quick.state : null, command: ['none', 'start', 'cancel', 'now'].includes(q.command) ? q.command : null, minutes: ['idle', 'pending', 'feeding', 'ready', 'failed'].includes(quick?.state) && Number.isFinite(q.minutes) ? q.minutes : null, haUpdated: typeof quick?.last_updated === 'string' && Number.isFinite(Date.parse(quick.last_updated)) ? quick.last_updated : null },
    history: { basis: 'ha_observed', events: Array.isArray(history?.events) ? copy(history.events).reverse() : [], dp151Supported: false },
  };
}
