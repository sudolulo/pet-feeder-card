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

/** Gauge bar colour: green >= 50, amber 20-49, red < 20, neutral when unknown. */
export function gaugeColor(pct) {
  if (pct == null) return 'var(--disabled-color, #bdbdbd)';
  if (pct >= 50) return 'var(--success-color, #43a047)';
  if (pct >= 20) return 'var(--warning-color, #ffa600)';
  return 'var(--error-color, #db4437)';
}

/**
 * FreshFeed LED strip colour. These are product colours (the physical LED), not
 * theme colours, so they are fixed hex values.
 */
export function ledColor(statusKey, foodPct) {
  if (statusKey === 'offline') return '#6b7280';
  if (statusKey === 'fault' || statusKey === 'empty' || foodPct === 0) return '#ef4444';
  if (foodPct != null && foodPct < 50) return '#f59e0b';
  return '#3b82f6';
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export const MODELS = {
  freshfeed: { name: 'FreshFeed', color: 'black' },
  aqara_c1: { name: 'Aqara C1', color: 'white' },
};

export const ENTITY_KEYS = [
  'status',
  'food_level',
  'error',
  'last_feed',
  'last_fed',
  'portions_today',
  'weight_today',
  'counter',
  'schedule',
  'next_meal',
  'temperature',
  'camera',
];

// Keys that make sense as a chip or footer item (a displayable value).
const VALUE_KEYS = ['last_feed', 'last_fed', 'portions_today', 'weight_today', 'counter', 'next_meal', 'temperature', 'food_level'];

/** Validate a card config and fill defaults. Throws Error with a readable message. */
export function validateConfig(config) {
  if (!config || !config.model) {
    throw new Error("pet-feeder-card: 'model' is required (freshfeed or aqara_c1)");
  }
  const model = MODELS[config.model];
  if (!model) {
    throw new Error(`pet-feeder-card: unknown model '${config.model}'; supported: ${Object.keys(MODELS).join(', ')}`);
  }
  const c = {
    name: model.name,
    color: model.color,
    food_label: 'Food',
    art_level: 'hopper',
    chip: 'last_feed',
    footer: ['last_fed', 'portions_today', 'next_meal'],
    ...config,
  };
  if (!['black', 'white'].includes(c.color)) {
    throw new Error(`pet-feeder-card: color must be black or white, got '${c.color}'`);
  }
  if (!['hopper', 'bowl'].includes(c.art_level)) {
    throw new Error(`pet-feeder-card: art_level must be hopper or bowl, got '${c.art_level}'`);
  }
  if (c.entities != null && (typeof c.entities !== 'object' || Array.isArray(c.entities))) {
    throw new Error('pet-feeder-card: entities must be a mapping of key -> entity_id');
  }
  c.entities = { ...(c.entities || {}) };
  for (const k of Object.keys(c.entities)) {
    if (!ENTITY_KEYS.includes(k)) throw new Error(`pet-feeder-card: unknown entities key '${k}'`);
  }
  if (c.chip != null && c.chip !== false && !VALUE_KEYS.includes(c.chip)) {
    throw new Error(`pet-feeder-card: chip '${c.chip}' is not a displayable entity key`);
  }
  if (!Array.isArray(c.footer)) throw new Error('pet-feeder-card: footer must be a list of entity keys');
  if (c.footer.length > 3) throw new Error('pet-feeder-card: footer takes at most 3 items');
  for (const k of c.footer) {
    if (!VALUE_KEYS.includes(k)) throw new Error(`pet-feeder-card: footer key '${k}' is not a displayable entity key`);
  }
  const actions = c.actions == null ? [] : c.actions;
  if (!Array.isArray(actions)) throw new Error('pet-feeder-card: actions must be a list');
  if (actions.length > 3) throw new Error('pet-feeder-card: actions takes at most 3 buttons');
  c.actions = actions.map((a, i) => {
    if (!a || typeof a.action !== 'string' || !/^[a-z0-9_]+\.[a-z0-9_]+$/.test(a.action)) {
      throw new Error(`pet-feeder-card: actions[${i}].action must be 'domain.service'`);
    }
    return { icon: 'mdi:gesture-tap-button', name: a.action, ...a, confirm: a.confirm !== false };
  });
  const controls = c.controls == null ? [] : c.controls;
  if (!Array.isArray(controls)) throw new Error('pet-feeder-card: controls must be a list of entity ids');
  c.controls = [...controls];
  return c;
}

// ---------------------------------------------------------------------------
// View model: config + hass -> everything the renderer needs. Pure, tested.
// ---------------------------------------------------------------------------

const ITEM_ICONS = {
  last_feed: 'mdi:bowl-mix-outline',
  last_fed: 'mdi:history',
  portions_today: 'mdi:food-drumstick-outline',
  weight_today: 'mdi:scale',
  counter: 'mdi:counter',
  next_meal: 'mdi:calendar-clock',
  temperature: 'mdi:thermometer',
  food_level: 'mdi:food-variant',
};

const UNAVAILABLE = new Set(['unavailable', 'unknown', '']);

/** "3.0" -> "3", "2.50" -> "2.5"; non-numeric strings are returned as-is. */
function formatNumber(raw) {
  const n = Number(raw);
  if (raw === '' || raw == null || !Number.isFinite(n)) return String(raw);
  return String(Math.round(n * 100) / 100);
}

function pluralUnit(n, unit) {
  return `${formatNumber(n)} ${unit}${Number(n) === 1 ? '' : 's'}`;
}

/** Format a value-type entity for the chip/footer. */
function formatValue(key, stateObj) {
  const raw = stateObj.state;
  if (raw == null || UNAVAILABLE.has(String(raw).toLowerCase())) return 'Unknown';
  const unit = stateObj.attributes?.unit_of_measurement;
  const numeric = Number.isFinite(Number(raw));
  if (numeric && (key === 'last_feed' || key === 'portions_today') && (!unit || /^portions?$/i.test(unit))) {
    return pluralUnit(raw, 'portion');
  }
  if (numeric && key === 'counter' && (!unit || /^meals?$/i.test(unit))) return pluralUnit(raw, 'meal');
  if (key === 'food_level') return normalizeFoodLevel(raw).label;
  const v = numeric ? formatNumber(raw) : titleCase(raw);
  return unit ? `${v} ${unit}` : v;
}

/**
 * Parse an HA datetime-like state into a Date, or null:
 * ISO timestamps (sensor device_class timestamp), input_datetime "YYYY-MM-DD HH:MM:SS"
 * (local time), and time-only "HH:MM[:SS]" (next occurrence after now).
 */
export function parseStateDate(state, now = new Date()) {
  if (state == null) return null;
  const s = String(state).trim();
  const t = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(s);
  if (t) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate(), +t[1], +t[2], +(t[3] || 0));
    if (d <= now) d.setDate(d.getDate() + 1);
    return d;
  }
  // Date-like strings only; a bare number such as "2.0" must not become year 2000.
  if (!/^\d{4}-\d{2}-\d{2}/.test(s)) return null;
  // "YYYY-MM-DD HH:MM:SS" without zone is local time; the "T" form parses as local too.
  return toDate(s.replace(' ', 'T'));
}

/**
 * Build the render model. `hass` may be undefined (config set first) and any
 * configured entity may be missing from hass.states; neither throws.
 */
export function buildModel(config, hass, now = new Date()) {
  const states = (hass && hass.states) || {};
  const ent = config.entities || {};
  const get = (key) => (ent[key] ? states[ent[key]] : undefined);

  // --- status ---------------------------------------------------------------
  const statusObj = get('status');
  const errorObj = get('error');
  // The "primary" entity decides availability: the status entity, else the error entity.
  const primaryKey = ent.status ? 'status' : ent.error ? 'error' : null;
  const primaryObj = primaryKey ? get(primaryKey) : undefined;
  let status;
  if (primaryKey && !primaryObj) {
    // Configured but not present in hass.states (typo, removed integration).
    status = { key: 'offline', label: 'Unknown', icon: 'mdi:help-circle-outline', color: 'var(--disabled-color)' };
  } else {
    status = normalizeStatus({
      status: statusObj?.state,
      error: errorObj?.state,
      available: primaryObj ? primaryObj.state !== 'unavailable' : undefined,
    });
  }
  status.entity = primaryKey ? ent[primaryKey] : null;

  // --- food gauge -------------------------------------------------------------
  let food = null;
  if (ent.food_level) {
    const lvl = normalizeFoodLevel(get('food_level')?.state);
    food = { label: config.food_label, pct: lvl.pct, text: lvl.label, color: gaugeColor(lvl.pct), entity: ent.food_level };
  }

  // --- value items (chip + footer) ------------------------------------------------
  const item = (key) => {
    const entityKey = key === 'next_meal' && !ent.next_meal && ent.schedule ? 'schedule' : key;
    const entity = ent[entityKey];
    if (!entity) return null; // not configured -> hidden
    const so = states[entity];
    const base = { key, icon: ITEM_ICONS[key], entity };
    if (!so || UNAVAILABLE.has(String(so.state).toLowerCase())) return { ...base, value: 'Unknown' };
    let value;
    if (key === 'last_fed') {
      // A timestamp state wins; otherwise the moment the entity last changed.
      const d = parseStateDate(so.state, now) || toDate(so.last_changed);
      value = d ? relativeTime(d, now) : 'Unknown';
    } else if (key === 'next_meal') {
      let d = null;
      if (entityKey === 'schedule') d = nextMeal(parseAqaraSchedule(so.state), now)?.at ?? null;
      else d = parseStateDate(so.state, now) || toDate(so.attributes?.timestamp && so.attributes.timestamp * 1000);
      value = d ? relativeTime(d, now) : 'None scheduled';
    } else {
      value = formatValue(key, so);
    }
    return { ...base, value };
  };

  const chip = config.chip ? item(config.chip) : null;
  const footer = (config.footer || []).map(item).filter(Boolean);

  return {
    name: config.name,
    status,
    food,
    chip,
    footer,
    camera: ent.camera || null,
    art: {
      model: config.model,
      color: config.color,
      artLevel: config.art_level,
      statusKey: status.key,
      foodPct: food ? food.pct : null,
    },
  };
}
