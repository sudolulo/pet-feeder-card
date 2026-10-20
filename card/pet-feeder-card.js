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

// ---------------------------------------------------------------------------
// Artwork: inline SVG, product colours (theme-independent), soft shading.
// Animations are driven by CSS in the card's shadow root via the root classes
// is-feeding / is-offline.
// ---------------------------------------------------------------------------

const r1 = (n) => Math.round(n * 10) / 10;

/** Vertical offset from an ellipse's centre line to its front edge at x. */
function ellipseDy(x, cx, rx, ry) {
  const t = (x - cx) / rx;
  return t >= 1 || t <= -1 ? 0 : ry * Math.sqrt(1 - t * t);
}

/** Front-visible band of a vertical cylinder between two ellipse centre lines. */
function bandPath(cx, rx, ry, yTop, yBot) {
  return (
    `M${cx - rx},${yTop} A${rx},${ry} 0 0 0 ${cx + rx},${yTop} ` +
    `L${cx + rx},${yBot} A${rx},${ry} 0 0 1 ${cx - rx},${yBot} Z`
  );
}

/** Open path following the front edge of an ellipse between x0 and x1. */
function frontArc(cx, cy, rx, ry, x0, x1, steps = 12) {
  const pts = [];
  for (let i = 0; i <= steps; i++) {
    const x = x0 + ((x1 - x0) * i) / steps;
    pts.push(`${r1(x)},${r1(cy + ellipseDy(x, cx, rx, ry))}`);
  }
  return `M${pts.join(' L')}`;
}

function stops(list) {
  return list.map(([o, c, a]) => `<stop offset="${o}" stop-color="${c}"${a != null ? ` stop-opacity="${a}"` : ''}/>`).join('');
}

const PALETTES = {
  black: {
    top: ['#55585f', '#2a2c31', '#17181b'],
    side: ['#0c0d0f', '#25272b', '#3b3e44', '#2a2c31', '#141518', '#08090a'],
    sideDark: ['#08090a', '#1b1d20', '#2d3034', '#202226', '#0f1012', '#050506'],
    edge: '#6a6e76',
    seam: '#050506',
    foot: '#0b0b0c',
    detail: '#5d6067',
  },
  white: {
    top: ['#ffffff', '#f3f4f6', '#dcdfe3'],
    side: ['#aeb4bb', '#d9dde1', '#fbfcfc', '#eceef0', '#d2d6da', '#a3a9b0'],
    sideDark: ['#a0a6ad', '#cdd1d6', '#eef0f2', '#e1e4e7', '#c5cad0', '#959ca4'],
    edge: '#ffffff',
    seam: '#9aa1a8',
    foot: '#3a3d42',
    detail: '#c3c8cd',
  },
};

function sideGradient(id, cols) {
  return `<linearGradient id="${id}" x1="0" x2="1" y1="0" y2="0">${stops([
    [0, cols[0]],
    [0.12, cols[1]],
    [0.36, cols[2]],
    [0.62, cols[3]],
    [0.88, cols[4]],
    [1, cols[5]],
  ])}</linearGradient>`;
}

function floorShadow(cx, cy, rx, ry) {
  return (
    `<radialGradient id="pf-shadow" cx="0.5" cy="0.5" r="0.5">${stops([
      [0, '#000', 0.34],
      [0.6, '#000', 0.14],
      [1, '#000', 0],
    ])}</radialGradient>` +
    `<ellipse class="floor-shadow" cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="url(#pf-shadow)"/>`
  );
}

function snowflake(x, y, s, color) {
  // Six-armed snowflake: three strokes through the centre plus a tick pair on each arm.
  let d = '';
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI / 3) * i - Math.PI / 2;
    const ex = x + Math.cos(a) * s;
    const ey = y + Math.sin(a) * s;
    d += `M${x},${y} L${r1(ex)},${r1(ey)} `;
    const mx = x + Math.cos(a) * s * 0.55;
    const my = y + Math.sin(a) * s * 0.55;
    for (const side of [-1, 1]) {
      const b = a + (side * Math.PI) / 4;
      d += `M${r1(mx)},${r1(my)} L${r1(mx + Math.cos(b) * s * 0.35)},${r1(my + Math.sin(b) * s * 0.35)} `;
    }
  }
  return `<path class="snowflake" d="${d.trim()}" stroke="${color}" stroke-width="1.1" stroke-linecap="round" fill="none"/>`;
}

/** PetSafe FreshFeed: low, wide, round puck with a serving window, vent and LED strip. */
function freshfeedSvg(art) {
  const p = PALETTES[art.color] || PALETTES.black;
  const cx = 160;
  const rx = 128;
  const ry = 32;
  const topY = 84; // centre line of the lid's top ellipse
  const seamY = 116; // lid / base seam
  const lowSeamY = 166; // thin seam near the base bottom
  const botY = 176; // bottom of the base
  const led = ledColor(art.statusKey, art.foodPct);
  const showFood = art.statusKey !== 'empty' && art.foodPct !== 0;

  // Feet on a tripod at 30, 150 and 270 degrees (270 is the back foot, hidden by the
  // body exactly as on the real unit, where only the two front feet are visible).
  const feet = [30, 150, 270]
    .map((deg) => {
      const a = (deg * Math.PI) / 180;
      const fx = r1(cx + rx * 0.8 * Math.cos(a));
      const fy = r1(botY + ry * 0.8 * Math.sin(a)); // attachment point on the bottom face
      const len = 21; // every foot has the same length, so the back one stays occluded
      return (
        `<g class="foot"><rect x="${fx - 3.5}" y="${fy}" width="7" height="${len}" rx="2" fill="${p.foot}"/>` +
        `<ellipse cx="${fx}" cy="${r1(fy + len)}" rx="9.5" ry="3.2" fill="${p.foot}"/>` +
        `<ellipse cx="${fx - 1.5}" cy="${r1(fy + len - 1)}" rx="5" ry="1.2" fill="#fff" fill-opacity="0.12"/></g>`
      );
    })
    .join('');

  // Vent grille on the left of the base: slots foreshortened by the curvature.
  let vents = '';
  for (let i = 0; i < 9; i++) {
    const x = cx - rx + 10 + i * 4.6;
    const dy = ellipseDy(x, cx, rx, ry);
    const w = r1(1.2 + 1.6 * (dy / ry));
    const y0 = r1(seamY + dy + 12);
    const y1 = r1(lowSeamY + dy - 10);
    vents += `<rect class="vent-slot" x="${r1(x)}" y="${y0}" width="${w}" height="${r1(y1 - y0)}" rx="${r1(w / 2)}" fill="#000" fill-opacity="0.85"/>`;
  }

  // LED strip on the front right, following the base's curvature.
  const ledY = (seamY + lowSeamY) / 2 + 4;
  const ledPath = frontArc(cx, ledY, rx, ry, 198, 240, 10);
  const flakeX = 188;
  const flakeY = r1(ledY + ellipseDy(flakeX, cx, rx, ry));

  // Serving window: a notch in the front of the lid, cut through the rim.
  const wx0 = 122;
  const wx1 = 198;
  const backY = topY + 4;
  const frontPts = [];
  for (let i = 0; i <= 8; i++) {
    const x = wx1 + 6 - ((wx1 - wx0 + 12) * i) / 8;
    frontPts.push(`${r1(x)},${r1(topY + ellipseDy(x, cx, rx, ry) + 7)}`);
  }
  const windowPath = `M${wx0 + 4},${backY} L${wx1 - 4},${backY} Q${wx1},${backY} ${wx1 + 2},${backY + 4} L${frontPts.join(' L')} L${wx0 - 2},${backY + 4} Q${wx0},${backY} ${wx0 + 4},${backY} Z`;
  const windowFrontY = topY + ry + 7;

  // Wet food chunks visible through the window.
  const chunks = [
    [138, 112, 9, 5, '#c8743a'],
    [152, 108, 8, 4.5, '#e09a5b'],
    [166, 113, 10, 5.5, '#b4602e'],
    [180, 109, 8, 4.5, '#d9874a'],
    [146, 117, 7, 4, '#a85a2b'],
    [172, 118, 8, 4, '#e8a468'],
    [190, 114, 6, 3.5, '#c06a34'],
    [131, 105, 6, 3.5, '#d48a4f'],
    [160, 103, 7, 3.5, '#bd6a35'],
  ];
  const food =
    `<ellipse cx="160" cy="114" rx="40" ry="11" fill="#9a4f22"/>` +
    chunks.map(([x, y, a, b, c]) => `<ellipse cx="${x}" cy="${y}" rx="${a}" ry="${b}" fill="${c}"/>`).join('') +
    chunks
      .slice(0, 6)
      .map(([x, y, a, b]) => `<ellipse cx="${x - a * 0.3}" cy="${y - b * 0.45}" rx="${r1(a * 0.35)}" ry="${r1(b * 0.25)}" fill="#fff" fill-opacity="0.35"/>`)
      .join('');

  const classes = ['pf-art', 'art-freshfeed', `is-${art.statusKey}`].join(' ');
  return (
    `<svg class="${classes}" viewBox="14 42 292 196" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="PetSafe FreshFeed">` +
    `<defs>` +
    `<radialGradient id="pf-top" cx="0.35" cy="0.25" r="0.85">${stops([[0, p.top[0]], [0.55, p.top[1]], [1, p.top[2]]])}</radialGradient>` +
    sideGradient('pf-side', p.side) +
    sideGradient('pf-side-dark', p.sideDark) +
    `<linearGradient id="pf-vshade" x1="0" x2="0" y1="0" y2="1">${stops([[0, '#fff', 0.06], [0.5, '#000', 0], [1, '#000', 0.28]])}</linearGradient>` +
    `<linearGradient id="pf-well" x1="0" x2="0" y1="0" y2="1">${stops([[0, '#050506'], [0.6, '#1c1d20'], [1, '#2e3035']])}</linearGradient>` +
    `<clipPath id="pf-window-clip"><path d="${windowPath}"/></clipPath>` +
    `<filter id="pf-glow" x="-30%" y="-200%" width="160%" height="500%"><feGaussianBlur stdDeviation="2.4"/></filter>` +
    `</defs>` +
    floorShadow(cx, botY + 28, rx + 16, 15) +
    feet +
    // Base band (seam to bottom), with vertical shading.
    `<path d="${bandPath(cx, rx, ry, seamY, botY)}" fill="url(#pf-side-dark)"/>` +
    `<path d="${bandPath(cx, rx, ry, seamY, botY)}" fill="url(#pf-vshade)"/>` +
    `<path d="${frontArc(cx, lowSeamY, rx, ry, cx - rx + 1, cx + rx - 1, 40)}" stroke="${p.seam}" stroke-width="1.4" fill="none" stroke-opacity="0.8"/>` +
    `<g class="vent">${vents}</g>` +
    // LED strip: blurred glow under a crisp core line.
    `<path class="led-glow" d="${ledPath}" stroke="${led}" stroke-width="7" stroke-linecap="round" fill="none" opacity="0.55" filter="url(#pf-glow)"/>` +
    `<path class="led" d="${ledPath}" stroke="${led}" stroke-width="2.8" stroke-linecap="round" fill="none"/>` +
    snowflake(flakeX, flakeY, 5, art.color === 'white' ? '#7b8794' : '#9aa3ad') +
    // Lid band (top to seam).
    `<path d="${bandPath(cx, rx, ry, topY, seamY)}" fill="url(#pf-side)"/>` +
    `<path d="${frontArc(cx, seamY, rx, ry, cx - rx + 1, cx + rx - 1, 40)}" stroke="${p.seam}" stroke-width="2" fill="none"/>` +
    `<path d="${frontArc(cx, seamY + 2, rx, ry, cx - rx + 4, cx + rx - 4, 40)}" stroke="${p.edge}" stroke-width="0.8" fill="none" stroke-opacity="0.18"/>` +
    // Domed lid top: the back edge is raised a little above a flat ellipse.
    `<path d="M${cx - rx},${topY} A${rx},${ry + 6} 0 0 1 ${cx + rx},${topY} A${rx},${ry} 0 0 1 ${cx - rx},${topY} Z" fill="url(#pf-top)"/>` +
    `<path d="${frontArc(cx, topY, rx, ry, cx - rx + 3, cx + rx - 3, 40)}" stroke="${p.edge}" stroke-width="1.2" fill="none" stroke-opacity="0.35"/>` +
    // Brand plate at the back of the lid.
    `<rect x="142" y="${topY - ry + 1}" width="36" height="7" rx="2" fill="${p.detail}" fill-opacity="0.9"/>` +
    `<rect x="148" y="${topY - ry + 3.5}" width="24" height="2" rx="1" fill="${p.top[2]}" fill-opacity="0.8"/>` +
    // Serving window: dark well, food (slides in while feeding), bevel.
    `<path d="${windowPath}" fill="url(#pf-well)"/>` +
    // The serving bowl inside the window, visible whether or not it holds food.
    `<g clip-path="url(#pf-window-clip)"><ellipse cx="160" cy="114" rx="44" ry="12" fill="#3a3d43"/>` +
    `<ellipse cx="160" cy="113" rx="40" ry="9.5" fill="#24262a"/>` +
    `<path d="M120,114 A40,9.5 0 0 0 200,114" stroke="#6b7078" stroke-width="1" fill="none" stroke-opacity="0.6"/></g>` +
    (showFood ? `<g clip-path="url(#pf-window-clip)"><g class="window-food">${food}</g></g>` : '') +
    `<path d="M${wx0 + 4},${backY + 1} L${wx1 - 4},${backY + 1}" stroke="#000" stroke-opacity="0.6" stroke-width="3"/>` +
    `<path d="${windowPath}" fill="none" stroke="${p.edge}" stroke-opacity="0.35" stroke-width="1"/>` +
    `<path d="${frontArc(cx, topY + 7, rx, ry, wx0 - 2, wx1 + 6, 10)}" stroke="${p.edge}" stroke-opacity="0.25" stroke-width="1" fill="none" transform="translate(0 ${r1(windowFrontY - topY - ry - 7 + 1)})"/>` +
    `</svg>`
  );
}

// One tile of the hopper's kibble texture: [x, y, rotation, colour]. Hand-placed so
// the repeat is not an obvious grid; pieces on the tile edge are mirrored.
const KIBBLE_TILE = [
  [3, 3, 20, '#a56a32'], [10, 2, -35, '#8a5527'], [17, 4, 60, '#b77c3e'], [23, 2, 10, '#93592a'],
  [6, 9, -15, '#7a4a22'], [13, 8, 40, '#a3672f'], [20, 10, -60, '#8f5a2a'], [1, 14, 75, '#b47a3d'],
  [8, 15, 5, '#9b6230'], [15, 14, -40, '#6f4220'], [22, 16, 30, '#a56a32'], [26, 14, 75, '#b47a3d'],
  [4, 20, 20, '#a56a32'], [11, 21, -35, '#8a5527'], [18, 19, 60, '#b77c3e'], [25, 21, 10, '#93592a'],
];

/** Aqara C1: tall cylinder, rounded lid, tinted hopper window, bowl at the front. */
function aqaraSvg(art) {
  const p = PALETTES[art.color] || PALETTES.white;
  const cx = 160;
  const rx = 62;
  const ry = 15;
  const capTop = 44;
  const capBot = 62;
  const bodyBot = 196;
  const plinthRx = 76;
  const plinthRy = 19;
  const plinthBot = 212;
  const pct = art.foodPct == null ? 0 : Math.max(0, Math.min(100, art.foodPct));

  // Hopper window geometry; the inner height is what the fill percentage scales.
  const win = { x: 131, y: 82, w: 58, h: 84 };
  const inner = { x: win.x + 3, y: win.y + 3, w: win.w - 6, h: win.h - 6 };
  const hopperPct = art.artLevel === 'hopper' ? pct : 0;
  const fillH = (inner.h * hopperPct) / 100;
  const fillY = inner.y + inner.h - fillH;

  const bowl = { cx, cy: 222, rx: 50, ry: 13 };
  const heap = art.artLevel === 'bowl' && art.foodPct != null && art.foodPct > 0;
  const status = art.statusKey;

  // Kibble heaped in the bowl: rows of pieces narrowing towards the top of the
  // mound. Positions are jittered deterministically so renders are stable.
  const heapKibble = [];
  const kibbleCols = ['#8a5527', '#a3672f', '#6f4220', '#b47a3d', '#97602d'];
  let k = 0;
  for (let row = 0; row < 6; row++) {
    const y = bowl.cy + 3 - row * 3.1;
    const half = (bowl.rx - 9) * (1 - Math.pow(row / 6, 1.5));
    const n = Math.max(2, Math.round(half / 3.4));
    for (let j = 0; j <= n; j++) {
      const x = bowl.cx - half + (2 * half * j) / n + (((k * 7) % 5) - 2) * 0.6;
      const jy = (((k * 5) % 3) - 1) * 0.8;
      const rot = ((k * 37) % 180) - 90;
      heapKibble.push(
        `<ellipse cx="${r1(x)}" cy="${r1(y + jy)}" rx="3.3" ry="2.5" fill="${kibbleCols[k % 5]}" transform="rotate(${rot} ${r1(x)} ${r1(y + jy)})"/>` +
          `<ellipse cx="${r1(x - 1)}" cy="${r1(y + jy - 1)}" rx="1.2" ry="0.7" fill="#fff" fill-opacity="0.22"/>`,
      );
      k++;
    }
  }

  // Falling kibble while feeding: static positions are staggered down the drop so
  // the reduced-motion (no animation) frame still reads as "food falling".
  const drops =
    status === 'feeding'
      ? [
          [154, 202, 0],
          [163, 207, 0.3],
          [158, 212, 0.6],
          [166, 199, 0.9],
        ]
          .map(([x, y, delay]) => `<circle class="kibble-drop" cx="${x}" cy="${y}" r="2.7" fill="#8a5527" style="animation-delay:${delay}s"/>`)
          .join('')
      : '';

  const dot = art.statusKey === 'offline' ? '#6b7280' : art.statusKey === 'fault' || art.statusKey === 'empty' ? '#ef4444' : '#22c55e';
  const classes = ['pf-art', 'art-aqara', `is-${art.statusKey}`].join(' ');

  return (
    `<svg class="${classes}" viewBox="56 20 208 240" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Aqara Smart Pet Feeder C1">` +
    `<defs>` +
    sideGradient('pf-body', p.side) +
    sideGradient('pf-body-dark', p.sideDark) +
    `<radialGradient id="pf-cap-top" cx="0.38" cy="0.3" r="0.8">${stops([[0, p.top[0]], [0.6, p.top[1]], [1, p.top[2]]])}</radialGradient>` +
    `<linearGradient id="pf-vshade" x1="0" x2="0" y1="0" y2="1">${stops([[0, '#fff', 0.05], [0.7, '#000', 0], [1, '#000', 0.12]])}</linearGradient>` +
    `<linearGradient id="pf-tint" x1="0" x2="1" y1="0" y2="0">${stops([[0, '#3d4853'], [0.4, '#6a7884'], [1, '#3a444f']])}</linearGradient>` +
    `<linearGradient id="pf-glass" x1="0" x2="1" y1="0" y2="1">${stops([[0, '#fff', 0.38], [0.35, '#fff', 0.06], [0.36, '#fff', 0], [1, '#fff', 0]])}</linearGradient>` +
    `<linearGradient id="pf-steel" x1="0" x2="1" y1="0" y2="0">${stops([[0, '#8c939b'], [0.25, '#e7eaed'], [0.5, '#bfc5cb'], [0.78, '#f4f5f6'], [1, '#868d95']])}</linearGradient>` +
    `<radialGradient id="pf-bowl-in" cx="0.5" cy="0.35" r="0.7">${stops([[0, '#eef0f2'], [0.7, '#aab1b8'], [1, '#7e868e']])}</radialGradient>` +
    `<pattern id="pf-kibble" width="26" height="20" patternUnits="userSpaceOnUse">` +
    `<rect width="26" height="20" fill="#5a361a"/>` +
    KIBBLE_TILE.map(([x, y, rot, c]) => `<ellipse cx="${x}" cy="${y}" rx="3.4" ry="2.6" fill="${c}" transform="rotate(${rot} ${x} ${y})"/>`).join('') +
    KIBBLE_TILE.map(([x, y]) => `<ellipse cx="${x - 1}" cy="${y - 1}" rx="1.3" ry="0.7" fill="#fff" fill-opacity="0.2"/>`).join('') +
    `</pattern>` +
    `<clipPath id="pf-hopper-clip"><rect x="${inner.x}" y="${inner.y}" width="${inner.w}" height="${inner.h}" rx="9"/></clipPath>` +
    `<clipPath id="pf-bowl-clip"><ellipse cx="${bowl.cx}" cy="${bowl.cy}" rx="${bowl.rx - 4}" ry="${bowl.ry - 2.5}"/>` +
    `<rect x="${bowl.cx - bowl.rx}" y="${bowl.cy - 40}" width="${bowl.rx * 2}" height="40"/></clipPath>` +
    `</defs>` +
    floorShadow(cx, plinthBot + plinthRy + 12, plinthRx + 22, 12) +
    // Plinth (wider base) and its top surface.
    `<path d="${bandPath(cx, plinthRx, plinthRy, bodyBot, plinthBot)}" fill="url(#pf-body-dark)"/>` +
    `<ellipse cx="${cx}" cy="${bodyBot}" rx="${plinthRx}" ry="${plinthRy}" fill="url(#pf-cap-top)"/>` +
    // Body cylinder.
    `<path d="${bandPath(cx, rx, ry, capBot, bodyBot)}" fill="url(#pf-body)"/>` +
    `<path d="${bandPath(cx, rx, ry, capBot, bodyBot)}" fill="url(#pf-vshade)"/>` +
    `<path d="${frontArc(cx, bodyBot, rx, ry, cx - rx + 1, cx + rx - 1, 30)}" stroke="#000" stroke-opacity="0.12" stroke-width="2.2" fill="none"/>` +
    // Hopper window: smoky tint, kibble fill to the food level, glass highlight.
    `<rect x="${win.x}" y="${win.y}" width="${win.w}" height="${win.h}" rx="12" fill="${p.detail}"/>` +
    `<rect x="${inner.x}" y="${inner.y}" width="${inner.w}" height="${inner.h}" rx="9" fill="url(#pf-tint)"/>` +
    `<g clip-path="url(#pf-hopper-clip)">` +
    `<rect class="hopper-food" x="${inner.x}" y="${r1(fillY)}" width="${inner.w}" height="${r1(fillH)}" fill="url(#pf-kibble)"/>` +
    (fillH > 3 ? `<ellipse cx="${cx}" cy="${r1(fillY)}" rx="${inner.w / 2}" ry="3" fill="url(#pf-kibble)"/>` : '') +
    `<rect x="${inner.x}" y="${inner.y}" width="${inner.w}" height="${inner.h}" fill="#3a4652" fill-opacity="0.32"/>` +
    `<rect x="${inner.x}" y="${inner.y}" width="${inner.w}" height="${inner.h}" fill="url(#pf-glass)"/>` +
    `</g>` +
    `<circle class="status-dot" cx="${cx}" cy="${win.y + win.h + 9}" r="2.2" fill="${dot}"/>` +
    // Food outlet above the bowl, and falling kibble while feeding.
    `<rect x="${cx - 14}" y="190" width="28" height="8" rx="4" fill="#2b3036"/>` +
    drops +
    // Rounded lid: band, top and edge highlight; seam to the body; top button.
    `<path d="${bandPath(cx, rx + 2, ry + 0.5, capTop, capBot)}" fill="url(#pf-body)"/>` +
    `<path d="${frontArc(cx, capBot, rx + 2, ry + 0.5, cx - rx - 1, cx + rx + 1, 30)}" stroke="${p.seam}" stroke-width="1.4" fill="none"/>` +
    `<ellipse cx="${cx}" cy="${capTop}" rx="${rx + 2}" ry="${ry + 0.5}" fill="url(#pf-cap-top)"/>` +
    `<path d="${frontArc(cx, capTop, rx + 2, ry + 0.5, cx - rx, cx + rx, 30)}" stroke="${p.edge}" stroke-width="2.4" fill="none" stroke-opacity="0.8"/>` +
    `<ellipse cx="${cx}" cy="${capTop}" rx="11" ry="3.4" fill="${p.detail}"/>` +
    `<ellipse cx="${cx}" cy="${capTop - 0.6}" rx="8" ry="2.2" fill="${p.top[0]}"/>` +
    // Bowl protruding at the front: steel wall, inner surface, optional heap.
    `<path d="M${bowl.cx - bowl.rx},${bowl.cy} C${bowl.cx - bowl.rx + 3},${bowl.cy + 16} ${bowl.cx - 34},${bowl.cy + 21} ${bowl.cx},${bowl.cy + 21} ` +
    `C${bowl.cx + 34},${bowl.cy + 21} ${bowl.cx + bowl.rx - 3},${bowl.cy + 16} ${bowl.cx + bowl.rx},${bowl.cy} Z" fill="url(#pf-steel)"/>` +
    `<ellipse cx="${bowl.cx}" cy="${bowl.cy}" rx="${bowl.rx}" ry="${bowl.ry}" fill="url(#pf-steel)"/>` +
    `<ellipse cx="${bowl.cx}" cy="${bowl.cy + 0.5}" rx="${bowl.rx - 4}" ry="${bowl.ry - 2.5}" fill="url(#pf-bowl-in)"/>` +
    (heap
      ? `<g class="bowl-heap" clip-path="url(#pf-bowl-clip)">` +
        `<path d="M${bowl.cx - bowl.rx + 6},${bowl.cy + 4} Q${bowl.cx},${bowl.cy - 30} ${bowl.cx + bowl.rx - 6},${bowl.cy + 4} Z" fill="#5e3a1c"/>` +
        heapKibble.join('') +
        `</g>`
      : '') +
    `<path d="${frontArc(bowl.cx, bowl.cy, bowl.rx, bowl.ry, bowl.cx - bowl.rx + 1, bowl.cx + bowl.rx - 1, 24)}" stroke="#fff" stroke-opacity="0.7" stroke-width="1.2" fill="none"/>` +
    `</svg>`
  );
}

/** Render the product illustration for a model's art state (see buildModel().art). */
export function renderArt(art) {
  return art.model === 'aqara_c1' ? aqaraSvg(art) : freshfeedSvg(art);
}

// ---------------------------------------------------------------------------
// Custom element
// ---------------------------------------------------------------------------

const CARD_VERSION = '0.1.0';
const CONFIRM_MS = 4000;
const TICK_MS = 60000; // refresh relative times once a minute

// Fallbacks for theme variables, so the card still renders outside a themed page.
const VAR_FALLBACK = {
  '--success-color': '#43a047',
  '--info-color': '#039be5',
  '--warning-color': '#ffa600',
  '--error-color': '#db4437',
  '--disabled-color': '#9e9e9e',
  '--secondary-text-color': '#727272',
};
const withFallback = (color) => color.replace(/var\((--[\w-]+)\)/, (m, v) => (VAR_FALLBACK[v] ? `var(${v}, ${VAR_FALLBACK[v]})` : m));

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

const STYLES = `
:host { display: block; }
ha-card { display: block; position: relative; overflow: hidden; height: 100%; box-sizing: border-box; }
.header {
  display: flex; align-items: center; justify-content: space-between; gap: 12px;
  padding: 18px 24px 16px; border-bottom: 1px solid var(--divider-color, rgba(0,0,0,.12));
}
.name {
  font-size: 22px; font-weight: 500; line-height: 28px; color: var(--primary-text-color, #212121);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.status {
  display: flex; align-items: center; gap: 10px; flex: none; cursor: pointer;
  font-size: 18px; color: var(--primary-text-color, #212121); border-radius: 18px; padding: 2px 2px 2px 8px;
}
.status ha-icon { --mdc-icon-size: 30px; width: 30px; height: 30px; }
.body { position: relative; padding: 76px 16px 8px; min-height: 150px; }
.round {
  display: inline-flex; align-items: center; justify-content: center; box-sizing: border-box;
  border-radius: 50%; padding: 0; margin: 0; cursor: pointer; font: inherit;
  background: var(--card-background-color, #fff); color: var(--primary-text-color, #212121);
  border: 1px solid var(--divider-color, rgba(0,0,0,.12));
  transition: background-color .2s, color .2s, box-shadow .2s, transform .1s;
}
.round:active { transform: scale(.94); }
.round:focus-visible, .status:focus-visible, .chip:focus-visible, .gauge:focus-visible, .item:focus-visible {
  outline: 2px solid var(--primary-color, #03a9f4); outline-offset: 2px;
}
.round.menu, .round.camera {
  position: absolute; top: 14px; width: 44px; height: 44px;
  box-shadow: 0 2px 5px rgba(0,0,0,.16);
}
.round.menu { left: 16px; }
.round.camera { right: 16px; }
.round.menu ha-icon, .round.camera ha-icon { --mdc-icon-size: 26px; }
.actions { position: absolute; top: 12px; left: 0; right: 0; display: flex; justify-content: center; gap: 14px; pointer-events: none; }
.actions .round { width: 52px; height: 52px; pointer-events: auto; }
.actions .round ha-icon { --mdc-icon-size: 28px; }
.actions .round.armed {
  background: var(--warning-color, #ffa600); border-color: var(--warning-color, #ffa600); color: #fff;
  box-shadow: 0 0 0 4px color-mix(in srgb, var(--warning-color, #ffa600) 25%, transparent);
}
.art { width: 60%; margin: 0 auto; }
.art svg { display: block; width: 100%; height: auto; max-height: 216px; overflow: visible; }
/* A wide product (FreshFeed puck) would sit under a side chip, so the chip moves
   below the illustration, still on the left edge. */
.body { container-type: inline-size; }
.body.wide { padding-bottom: 70px; min-height: 0; }
.body.wide .chip { top: auto; bottom: 10px; transform: none; }
.chip {
  position: absolute; left: 16px; top: 64%; transform: translateY(-50%);
  display: flex; align-items: center; gap: 8px; height: 48px; padding: 0 16px 0 13px; box-sizing: border-box;
  border: 1px solid var(--divider-color, rgba(0,0,0,.12));
  border-radius: 25px; background: var(--card-background-color, #fff); cursor: pointer;
  box-shadow: 0 2px 6px rgba(0,0,0,.18); color: var(--primary-text-color, #212121); font-size: 14px; white-space: nowrap;
}
.chip ha-icon { --mdc-icon-size: 22px; color: var(--state-icon-color, #44739e); }
/* Must follow the .chip rules: same specificity, so order decides. */
/* Narrow cards: the chip would cover even the slim C1, so it moves below too. */
@container (max-width: 380px) {
  .art { padding-bottom: 62px; }
  .chip { top: auto; bottom: 10px; transform: none; }
  .body.wide .art { padding-bottom: 0; width: 78%; }
}
.gauges { width: 60%; margin: 4px auto 16px; display: flex; flex-direction: column; gap: 10px; }
.gauge { cursor: pointer; }
.gauge-head { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 5px; }
.gauge-label {
  font-size: 13px; font-weight: 500; letter-spacing: .06em; text-transform: uppercase;
  color: var(--secondary-text-color, #727272);
}
.gauge-text { font-size: 13px; color: var(--secondary-text-color, #727272); }
.bar { height: 8px; border-radius: 4px; background: var(--divider-color, rgba(0,0,0,.12)); overflow: hidden; }
.bar > div { height: 100%; border-radius: 4px; transition: width .6s ease; }
.footer {
  display: flex; flex-wrap: wrap; justify-content: space-between; align-items: center; gap: 10px 12px;
  padding: 14px 24px 16px; border-top: 1px solid var(--divider-color, rgba(0,0,0,.12));
}
.footer.single { justify-content: flex-start; }
.item {
  display: flex; align-items: center; gap: 10px; min-width: 0; cursor: pointer; border-radius: 8px;
  color: var(--secondary-text-color, #727272); font-size: 15px;
}
.item ha-icon { --mdc-icon-size: 24px; color: var(--state-icon-color, #44739e); flex: none; }
.item span { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.overlay {
  position: absolute; inset: 0; z-index: 5; display: flex; align-items: flex-start; justify-content: center;
  background: rgba(0,0,0,.32); padding: 60px 16px 16px; box-sizing: border-box;
}
.panel {
  width: 100%; max-width: 420px; background: var(--card-background-color, #fff); border-radius: 16px;
  box-shadow: 0 8px 28px rgba(0,0,0,.3); padding: 8px 16px 16px; box-sizing: border-box;
}
.panel-head { display: flex; align-items: center; justify-content: space-between; padding: 6px 0 8px; }
.panel-title { font-size: 18px; font-weight: 500; color: var(--primary-text-color, #212121); }
.panel .round { width: 40px; height: 40px; border-color: transparent; }
.rows > * { display: block; margin: 4px 0; }

/* Artwork state */
.pf-art.is-offline { opacity: .4; filter: grayscale(1); }
.pf-art.is-feeding .window-food { animation: pf-slide 2.4s cubic-bezier(.3,.7,.3,1) infinite; }
.pf-art.is-feeding .led, .pf-art.is-feeding .led-glow { animation: pf-pulse 1.4s ease-in-out infinite; }
.pf-art .kibble-drop { animation: pf-drop 1.2s ease-in infinite; }
@keyframes pf-slide {
  0% { transform: translateX(-80px); opacity: 0; }
  15% { opacity: 1; }
  60%, 100% { transform: translateX(0); opacity: 1; }
}
@keyframes pf-pulse { 0%, 100% { opacity: 1; } 50% { opacity: .3; } }
@keyframes pf-drop {
  0% { transform: translateY(0); opacity: 0; }
  15% { opacity: 1; }
  80% { opacity: 1; }
  100% { transform: translateY(18px); opacity: 0; }
}
@media (prefers-reduced-motion: reduce) {
  .pf-art *, .bar > div { animation: none !important; transition: none !important; }
}
`;

const Base = globalThis.HTMLElement ?? class {};

export class PetFeederCard extends Base {
  constructor() {
    super();
    this._config = null;
    this._hass = undefined;
    this._seen = new Map(); // entity_id -> last state object, for change detection
    this._armed = -1; // index of the action awaiting confirmation
    this._armTimer = null;
    this._tick = null;
    this._dialogRows = [];
    // The single controls dialog: { el, kind: 'ha' | 'overlay' } or null. A dialog
    // that is still being built (rows load asynchronously) is tracked by
    // _dialogOpening; _dialogGen invalidates an in-flight open when the dialog is
    // closed (setConfig, disconnect) before it finished building.
    this._dialog = null;
    this._dialogOpening = null;
    this._dialogGen = 0;
    this._root = null;
  }

  static getStubConfig() {
    return { model: 'freshfeed', entities: {} };
  }

  getCardSize() {
    return 7;
  }

  getGridOptions() {
    return { columns: 12, min_columns: 6, rows: 'auto' };
  }

  setConfig(config) {
    this._config = validateConfig(config); // throws a readable Error for HA's error card
    this._closeControls(); // its rows belong to the old config
    this._disarm(false);
    this._seen.clear();
    this._render();
  }

  set hass(hass) {
    this._hass = hass;
    for (const row of this._dialogRows) row.hass = hass;
    if (!this._config) return; // setConfig not called yet; it will render
    if (this._changed()) this._render();
  }

  get hass() {
    return this._hass;
  }

  connectedCallback() {
    if (!this._tick) this._tick = setInterval(() => this._render(), TICK_MS);
    this._render();
  }

  disconnectedCallback() {
    clearInterval(this._tick);
    this._tick = null;
    this._disarm(false);
    this._closeControls();
  }

  /** Entity ids whose state objects drive the render. */
  _watched() {
    const c = this._config;
    const ids = new Set(Object.values(c.entities || {}).filter(Boolean));
    return [...ids];
  }

  /** True when any watched entity's state object changed identity since last render. */
  _changed() {
    const states = (this._hass && this._hass.states) || {};
    for (const id of this._watched()) {
      if (states[id] !== this._seen.get(id)) return true;
    }
    return !this._root; // nothing rendered yet
  }

  _remember() {
    const states = (this._hass && this._hass.states) || {};
    this._seen.clear();
    for (const id of this._watched()) this._seen.set(id, states[id]);
  }

  _ensureRoot() {
    if (this._root) return;
    if (!this.shadowRoot) this.attachShadow({ mode: 'open' });
    this.shadowRoot.innerHTML = `<style>${STYLES}</style><ha-card></ha-card>`;
    this._root = this.shadowRoot.querySelector('ha-card');
    this._root.addEventListener('click', (ev) => this._onClick(ev));
    this._root.addEventListener('keydown', (ev) => {
      if ((ev.key === 'Enter' || ev.key === ' ') && ev.target.getAttribute?.('role') === 'button') {
        ev.preventDefault();
        this._onClick(ev);
      }
    });
  }

  _render() {
    if (!this._config || typeof this.attachShadow !== 'function') return;
    this._ensureRoot();
    this._remember();
    const c = this._config;
    const m = buildModel(c, this._hass, new Date());
    const icon = (name, style = '') => `<ha-icon icon="${esc(name)}"${style ? ` style="${style}"` : ''}></ha-icon>`;
    const more = (entity) => (entity ? ` data-more="${esc(entity)}" role="button" tabindex="0"` : '');

    const actions = c.actions
      .map((a, i) => {
        const armed = this._armed === i;
        const title = armed ? 'Tap again to confirm' : a.name;
        return `<button class="round action${armed ? ' armed' : ''}" data-action="${i}" title="${esc(title)}" aria-label="${esc(title)}">${icon(armed ? 'mdi:check' : a.icon)}</button>`;
      })
      .join('');

    const gauge = m.food
      ? `<div class="gauge"${more(m.food.entity)} title="${esc(m.food.label)}: ${esc(m.food.text)}">
           <div class="gauge-head"><span class="gauge-label">${esc(m.food.label)}</span><span class="gauge-text">${esc(m.food.text)}</span></div>
           <div class="bar"><div style="width:${m.food.pct ?? 0}%;background:${m.food.color}"></div></div>
         </div>`
      : '';

    // innerHTML replaces every element; remember which action button had keyboard
    // focus so a keyboard user can confirm an armed action with a second Enter/Space.
    const focusedAction = this.shadowRoot.activeElement?.dataset?.action;

    const footer = m.footer.length
      ? `<div class="footer${m.footer.length === 1 ? ' single' : ''}">${m.footer
          .map((f) => `<div class="item" data-key="${esc(f.key)}"${more(f.entity)} title="${esc(f.key.replace(/_/g, ' '))}">${icon(f.icon)}<span>${esc(f.value)}</span></div>`)
          .join('')}</div>`
      : '';

    this._root.innerHTML = `
      <div class="header">
        <div class="name">${esc(m.name)}</div>
        <div class="status"${more(m.status.entity)} title="${esc(m.status.label)}">
          <span class="status-label">${esc(m.status.label)}</span>${icon(m.status.icon, `color:${withFallback(m.status.color)}`)}
        </div>
      </div>
      <div class="body${c.model === 'freshfeed' ? ' wide' : ''}">
        ${c.controls.length ? `<button class="round menu" data-menu title="Controls" aria-label="Controls">${icon('mdi:menu')}</button>` : ''}
        ${actions ? `<div class="actions">${actions}</div>` : ''}
        ${m.camera ? `<button class="round camera"${more(m.camera)} title="Camera" aria-label="Camera">${icon('mdi:cctv')}</button>` : ''}
        <div class="art">${renderArt(m.art)}</div>
        ${m.chip ? `<div class="chip"${more(m.chip.entity)} title="${esc(m.chip.key.replace(/_/g, ' '))}">${icon(m.chip.icon)}<span>${esc(m.chip.value)}</span></div>` : ''}
      </div>
      ${gauge ? `<div class="gauges">${gauge}</div>` : ''}
      ${footer}`;
    if (this._dialog?.kind === 'overlay') this._root.appendChild(this._dialog.el); // keep an open fallback dialog
    if (focusedAction != null) {
      this._root.querySelector(`.actions .round[data-action="${focusedAction}"]`)?.focus();
    }
  }

  _onClick(ev) {
    const path = ev.composedPath ? ev.composedPath() : [ev.target];
    const el = path.find((n) => n && n.dataset && (n.dataset.more || n.dataset.action || 'menu' in n.dataset || 'close' in n.dataset));
    if (!el) return;
    if (el.dataset.action != null) return this._onAction(Number(el.dataset.action));
    if ('menu' in el.dataset) return this._openControls();
    if ('close' in el.dataset) return this._closeControls();
    if (el.dataset.more) this._moreInfo(el.dataset.more);
  }

  _moreInfo(entityId) {
    this.dispatchEvent(new CustomEvent('hass-more-info', { detail: { entityId }, bubbles: true, composed: true }));
  }

  _onAction(i) {
    const a = this._config.actions[i];
    if (!a) return;
    if (a.confirm && this._armed !== i) {
      // First tap only arms the button; dispensing needs a second tap within CONFIRM_MS.
      this._disarm(false);
      this._armed = i;
      this._armTimer = setTimeout(() => this._disarm(true), CONFIRM_MS);
      this._render();
      return;
    }
    this._disarm(false);
    this._render();
    const [domain, service] = a.action.split('.');
    if (!this._hass || typeof this._hass.callService !== 'function') {
      console.error(`pet-feeder-card: hass is not available, cannot call ${a.action}`);
      return;
    }
    // Surface a rejected service call in the console rather than losing it.
    Promise.resolve(this._hass.callService(domain, service, a.data || {}, a.target)).catch((err) => {
      console.error(`pet-feeder-card: ${a.action} failed`, err);
    });
  }

  _disarm(render) {
    clearTimeout(this._armTimer);
    this._armTimer = null;
    const was = this._armed;
    this._armed = -1;
    if (render && was !== -1) this._render();
  }

  _openControls() {
    if (this._dialog) {
      // Already open: bring it forward instead of stacking a second one.
      const target = this._dialog.kind === 'overlay' ? this._dialog.el.querySelector('[data-close]') : this._dialog.el;
      target?.focus?.();
      return this._dialogOpening || Promise.resolve();
    }
    if (this._dialogOpening) return this._dialogOpening; // still building
    const gen = ++this._dialogGen;
    const opening = this._buildControls(gen).finally(() => {
      if (this._dialogOpening === opening) this._dialogOpening = null;
    });
    this._dialogOpening = opening;
    return opening;
  }

  async _buildControls(gen) {
    const c = this._config;
    const rows = await this._createRows(c.controls);
    if (gen !== this._dialogGen) return; // closed (setConfig/disconnect) while loading
    this._dialogRows = rows;
    const title = `${c.name} controls`;
    if (customElements.get('ha-dialog')) {
      const dlg = document.createElement('ha-dialog');
      // ha-dialog's title API has changed across HA releases: older ones read
      // `heading`, current ones `header-title` / headerTitle. Set all of them.
      dlg.setAttribute('heading', title);
      dlg.setAttribute('header-title', title);
      dlg.headerTitle = title;
      dlg.setAttribute('aria-label', title);
      dlg.hideActions = true; // harmless where unsupported; not relied on
      const box = document.createElement('div');
      box.className = 'rows';
      rows.forEach((r) => box.appendChild(r));
      dlg.appendChild(box);
      dlg.addEventListener('closed', (ev) => {
        // Rows (e.g. select menus) fire their own bubbling 'closed' events.
        if (ev.target !== dlg) return;
        if (this._dialog?.el === dlg) {
          this._dialog = null;
          this._dialogRows = [];
        }
        dlg.remove();
      });
      this._dialog = { el: dlg, kind: 'ha' };
      this.shadowRoot.appendChild(dlg);
      dlg.open = true;
      return;
    }
    // Fallback: a simple in-card overlay.
    const ov = document.createElement('div');
    ov.className = 'overlay';
    ov.innerHTML = `<div class="panel" role="dialog" aria-label="${esc(title)}"><div class="panel-head"><span class="panel-title">${esc(title)}</span>
      <button class="round" data-close title="Close" aria-label="Close"><ha-icon icon="mdi:close"></ha-icon></button></div><div class="rows"></div></div>`;
    const box = ov.querySelector('.rows');
    rows.forEach((r) => box.appendChild(r));
    ov.addEventListener('click', (e) => {
      if (e.target === ov) this._closeControls();
    });
    this._dialog = { el: ov, kind: 'overlay' };
    this._root.appendChild(ov);
  }

  /** Close and remove the controls dialog, including one still being built. */
  _closeControls() {
    this._dialogGen++;
    this._dialogOpening = null;
    const d = this._dialog;
    this._dialog = null;
    this._dialogRows = [];
    if (!d) return;
    if (d.kind === 'ha') d.el.open = false; // its 'closed' handler sees _dialog already cleared
    d.el.remove();
  }

  async _createRows(entities) {
    let helpers = null;
    if (typeof window.loadCardHelpers === 'function') {
      try {
        helpers = await window.loadCardHelpers();
      } catch (err) {
        console.error('pet-feeder-card: loadCardHelpers failed, using plain rows', err);
      }
    }
    return entities.map((entity) => {
      let row;
      if (helpers) {
        row = helpers.createRowElement({ entity });
      } else {
        // Without HA's helpers (e.g. outside HA), show the raw state.
        row = document.createElement('div');
        const s = this._hass?.states?.[entity];
        row.textContent = `${s?.attributes?.friendly_name || entity}: ${s ? s.state : 'Unknown'}`;
      }
      row.hass = this._hass;
      return row;
    });
  }
}

if (globalThis.customElements && !globalThis.customElements.get('pet-feeder-card')) {
  globalThis.customElements.define('pet-feeder-card', PetFeederCard);
}

if (typeof window !== 'undefined') {
  window.customCards = window.customCards || [];
  if (!window.customCards.some((c) => c.type === 'pet-feeder-card')) {
    window.customCards.push({
      type: 'pet-feeder-card',
      name: 'Pet Feeder Card',
      description: 'Pet feeder status card with product artwork (PetSafe FreshFeed, Aqara C1).',
      preview: true,
    });
  }
  console.info(`%c PET-FEEDER-CARD %c ${CARD_VERSION} `, 'background:#3b82f6;color:#fff', 'background:#ddd;color:#000');
}
