// Pure registry binding and immutable configuration edits. No device operations.
import { validateConfig, ENTITY_KEYS } from './pet-feeder-card.js?v=0.4.1';
const DOMAIN = 'petsafe_freshfeed';
const SEMANTIC = ['schedule', 'write_status', 'quick_feed', 'history'];
const clone = value => structuredClone(value);
function ownedEntries({ entities, configEntries } = {}, deviceId) {
  if (!Array.isArray(entities) || !Array.isArray(configEntries)) return [];
  const entries = new Set(configEntries.filter(e => e.domain === DOMAIN).map(e => e.entry_id));
  return [...new Set(entities.filter(e => e.device_id === deviceId && e.platform === DOMAIN && entries.has(e.config_entry_id)).map(e => e.config_entry_id))];
}
export function freshfeedDevices(registry = {}) {
  const { devices, configEntries } = registry;
  if (!Array.isArray(devices) || !Array.isArray(configEntries)) return [];
  const entries = new Set(configEntries.filter(e => e.domain === DOMAIN).map(e => e.entry_id));
  return devices.filter(d => !d.disabled_by && (entries.has(d.config_entry_id) || ownedEntries(registry, d.id).length > 0));
}
export function discoverFreshfeedBindings(registry, deviceId) {
  const fail = () => ({config:null,error:'Feeder bindings are missing, disabled or ambiguous. Use manual fields.'});
  const devices = freshfeedDevices(registry).filter(d => d.id === deviceId);
  if (devices.length !== 1 || !Array.isArray(registry.entities)) return fail();
  const entries = ownedEntries(registry, deviceId);
  if (entries.length !== 1) return fail();
  const entry = entries[0];
  const rows = registry.entities.filter(e => e.device_id === deviceId && e.config_entry_id === entry && e.platform === DOMAIN);
  const matches = key => rows.filter(e => e.unique_id === `${entry}_${key}`);
  // A single enabled row with a consistent translation key and domain is the only accepted route.
  const usable = (found, key, pattern) => found.length === 1 && !found[0].disabled_by && (!found[0].translation_key || found[0].translation_key === key) && pattern.test(found[0].entity_id);
  const freshfeed = {entry_id:entry};
  for (const key of SEMANTIC) {
    const found = matches(key);
    if (!usable(found, key, /^sensor\.[a-z0-9_]+$/)) return fail();
    freshfeed[`${key}_entity`] = found[0].entity_id;
  }
  const entities = {};
  for (const key of ENTITY_KEYS) {
    const found = matches(key);
    if (!found.length) continue; // Optional visible route the feeder does not expose.
    if (!usable(found, key, /^(sensor|binary_sensor|camera)\.[a-z0-9_]+$/)) return fail();
    entities[key] = found[0].entity_id;
  }
  return {config:{model:'freshfeed',mode:'standard',freshfeed,entities},error:null};
}
// Apply a discovered binding. Re-selecting the bound feeder keeps the existing
// explicit routes and advanced fields; a different feeder replaces entry-bound routes.
export function bindDiscoveredFeeder(config, discovered) {
  const same = config.model === 'freshfeed' && (config.mode || 'standard') === 'standard' && config.freshfeed?.entry_id === discovered.freshfeed.entry_id;
  const first = config.model === 'freshfeed' && (config.mode || 'standard') === 'standard' && !config.freshfeed?.entry_id;
  if (same || first) {
    const patch = {freshfeed:{...config.freshfeed, ...discovered.freshfeed}};
    if (!config.entities) patch.entities = discovered.entities;
    return patchEditorConfig(config, patch);
  }
  return patchEditorConfig(config, clone(discovered));
}
export function patchEditorConfig(config, patch) {
  const next = {...clone(config), ...clone(patch)};
  const switched = (patch.model !== undefined && patch.model !== config.model) || (patch.mode !== undefined && patch.mode !== (config.mode || 'standard'));
  if (switched) {
    for (const key of ['freshfeed','entities','raw_entities','actions','controls','meal_slots','chip','footer']) {
      if (!Object.hasOwn(patch,key)) delete next[key];
    }
  }
  if (Object.hasOwn(patch,'freshfeed') && config.freshfeed?.entry_id && config.freshfeed.entry_id !== patch.freshfeed?.entry_id) {
    next.actions = []; next.controls = [];
    const previous = config.freshfeed;
    if (previous?.entry_id) {
      // Routes of the previous feeder must never survive into a new binding.
      if (SEMANTIC.some(key => previous[`${key}_entity`] && patch.freshfeed?.[`${key}_entity`] === previous[`${key}_entity`])) {
        throw new Error('pet-feeder-card editor: new feeder still uses routes of the previous feeder');
      }
      if (!Object.hasOwn(patch,'entities')) delete next.entities;
    }
  }
  for (const key of Object.keys(next)) if (next[key] === undefined) delete next[key];
  validateConfig(next); // Validate, but do not persist normalized defaults over advanced YAML.
  return next;
}
