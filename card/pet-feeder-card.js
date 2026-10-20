/*
 * pet-feeder-card -- Home Assistant Lovelace custom card for pet feeders.
 */

// ---------------------------------------------------------------------------
// Pure helpers (exported for unit tests)
// ---------------------------------------------------------------------------

/** "self_cleaning mode" -> "Self Cleaning Mode" */
export function titleCase(raw) {
  return String(raw)
    .replace(/[_-]+/g, ' ')
    .trim()
    .split(/\s+/)
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1).toLowerCase() : w))
    .join(' ');
}

const STATUS = {
  ready: { key: 'ready', label: 'Ready', icon: 'mdi:check-circle-outline', color: 'var(--success-color)' },
  feeding: { key: 'feeding', label: 'Feeding', icon: 'mdi:food-drumstick', color: 'var(--info-color)' },
  done: { key: 'done', label: 'Fed', icon: 'mdi:check-all', color: 'var(--success-color)' },
  empty: { key: 'empty', label: 'Out of food', icon: 'mdi:alert-circle-outline', color: 'var(--error-color)' },
  fault: { key: 'fault', label: 'Fault', icon: 'mdi:alert-octagon-outline', color: 'var(--error-color)' },
  offline: { key: 'offline', label: 'Offline', icon: 'mdi:wifi-off', color: 'var(--disabled-color)' },
};

const STATUS_ALIASES = {
  standby: 'ready',
  idle: 'ready',
  ready: 'ready',
  feeding: 'feeding',
  dispensing: 'feeding',
  feeding_complete: 'done',
  done: 'done',
  no_food: 'empty',
  last_meal: 'empty',
  empty: 'empty',
  run_out: 'empty',
};

function isOn(v) {
  return v === true || (typeof v === 'string' && v.toLowerCase() === 'on');
}

/**
 * Map raw feeder state to a display status.
 * Precedence: offline > fault > status string.
 */
export function normalizeStatus({ status, error, available } = {}) {
  const raw = status == null ? '' : String(status).trim();
  const lower = raw.toLowerCase();
  if (available === false || lower === 'unavailable' || lower === 'unknown') return { ...STATUS.offline };
  if (isOn(error)) return { ...STATUS.fault };
  if (raw === '') return { ...STATUS.ready };
  const alias = STATUS_ALIASES[lower];
  if (alias) return { ...STATUS[alias] };
  return {
    key: 'ready',
    label: titleCase(raw),
    icon: 'mdi:information-outline',
    color: 'var(--secondary-text-color)',
  };
}

const FOOD_ALIASES = {
  high: [100, 'Full'],
  enough: [100, 'Full'],
  full: [100, 'Full'],
  medium: [50, 'Half'],
  half: [50, 'Half'],
  low: [20, 'Low'],
  insufficient: [20, 'Low'],
  empty: [0, 'Empty'],
  run_out: [0, 'Empty'],
};

/** Map an enum or numeric food level state to { pct: 0-100 | null, label }. */
export function normalizeFoodLevel(state) {
  const raw = state == null ? '' : String(state).trim();
  const lower = raw.toLowerCase();
  if (raw === '' || lower === 'unavailable' || lower === 'unknown' || lower === 'none') {
    return { pct: null, label: 'Unknown' };
  }
  const n = Number(raw);
  if (Number.isFinite(n)) {
    const pct = Math.round(Math.min(100, Math.max(0, n)));
    return { pct, label: `${pct}%` };
  }
  const alias = FOOD_ALIASES[lower];
  if (alias) return { pct: alias[0], label: alias[1] };
  return { pct: null, label: titleCase(raw) };
}

/**
 * Convert a Python literal (repr of list/dict/str/int/bool/None) into JSON text.
 * Single pass over tokens so quotes inside strings and the words True/False/None
 * inside strings are left alone.
 */
function pythonLiteralToJson(text) {
  return text.replace(/"(?:[^"\\]|\\.)*"|'((?:[^'\\]|\\.)*)'|\b(True|False|None)\b/g, (m, single, word) => {
    if (single !== undefined) {
      // Unescape Python's \' and re-encode as a JSON string.
      return JSON.stringify(single.replace(/\\'/g, "'"));
    }
    if (word) return { True: 'true', False: 'false', None: 'null' }[word];
    return m;
  });
}

/**
 * Parse an Aqara C1 (Zigbee2MQTT) schedule state, e.g.
 * "[{'days': 'everyday', 'hour': 7, 'minute': 0, 'size': 3}, {'hour': 9, 'size': 3}]".
 * Returns [{ days, hour, minute, size }]; invalid input -> [].
 */
export function parseAqaraSchedule(str) {
  if (typeof str !== 'string' || !str.trim().startsWith('[')) return [];
  let list;
  try {
    list = JSON.parse(pythonLiteralToJson(str));
  } catch {
    // Not a parseable literal (e.g. truncated state) -- treat as no schedule.
    return [];
  }
  if (!Array.isArray(list)) return [];
  const out = [];
  for (const e of list) {
    if (!e || typeof e !== 'object') continue;
    const hour = Number(e.hour);
    const minute = e.minute == null ? 0 : Number(e.minute);
    const size = e.size == null ? 1 : Number(e.size);
    if (!Number.isInteger(hour) || hour < 0 || hour > 23) continue;
    if (!Number.isInteger(minute) || minute < 0 || minute > 59) continue;
    out.push({
      days: e.days == null || e.days === '' ? 'everyday' : String(e.days),
      hour,
      minute,
      size: Number.isFinite(size) ? size : 1,
    });
  }
  return out;
}

const DAY_INDEX = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };

/** Does a Zigbee2MQTT Aqara C1 `days` value include weekday `dow` (0 = Sunday)? */
function daysInclude(days, dow) {
  const d = String(days).toLowerCase();
  if (d === 'everyday') return true;
  if (d === 'workdays') return dow >= 1 && dow <= 5;
  if (d === 'weekend') return dow === 0 || dow === 6;
  // Single day ("mon") or hyphen-joined list ("mon-wed-fri-sun").
  return d.split('-').some((part) => DAY_INDEX[part] === dow);
}

/**
 * Earliest scheduled slot strictly after `now`, looking at today plus the next 7 days
 * (so a once-a-week slot earlier today is found a week out). Local time.
 * Dates are built from calendar fields, not by adding milliseconds, so DST shifts
 * do not move meal times.
 */
export function nextMeal(schedule, now) {
  if (!Array.isArray(schedule) || schedule.length === 0) return null;
  let best = null;
  for (let offset = 0; offset <= 7; offset++) {
    const base = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset);
    const dow = base.getDay();
    for (const slot of schedule) {
      if (!daysInclude(slot.days, dow)) continue;
      const at = new Date(base.getFullYear(), base.getMonth(), base.getDate(), slot.hour, slot.minute, 0, 0);
      if (at <= now) continue;
      if (!best || at < best.at) best = { at, size: slot.size };
    }
    // Slots on a later day can never beat one found on an earlier day.
    if (best) return best;
  }
  return null;
}

/** Coerce Date | ISO string | epoch ms into a valid Date, or null. */
export function toDate(v) {
  if (v == null || v === '') return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** "just now", "N minutes ago", "in N hours", ... (values rounded to nearest unit). */
export function relativeTime(date, now = new Date()) {
  const d = toDate(date);
  if (!d) return '';
  const diff = (d.getTime() - now.getTime()) / 1000;
  const secs = Math.abs(diff);
  if (secs < 45) return 'just now';
  const plural = (n, unit) => `${n} ${unit}${n === 1 ? '' : 's'}`;
  let text;
  const mins = Math.round(secs / 60);
  const hours = Math.round(secs / 3600);
  if (mins < 60) text = plural(mins, 'minute');
  else if (hours < 24) text = plural(hours, 'hour');
  else text = plural(Math.round(secs / 86400), 'day');
  return diff < 0 ? `${text} ago` : `in ${text}`;
}
