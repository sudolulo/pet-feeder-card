import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { ENTITY_KEYS, validateConfig } from '../dist/pet-feeder-card.js';

const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8');
const sections = [...readme.matchAll(/^## (.+)\n([\s\S]*?)(?=^## |$(?![\s\S]))/gm)];
function yamlUnder(heading) {
  const section = sections.find((m) => m[1] === heading);
  assert.ok(section, `missing heading: ${heading}`);
  const blocks = [...section[2].matchAll(/```yaml\n([\s\S]*?)```/g)];
  assert.equal(blocks.length, 1, `expected one YAML block under ${heading}`);
  const result = spawnSync(process.env.PETSAFE_YAML_PYTHON || 'python3', ['-c', 'import sys, yaml, json; print(json.dumps(yaml.safe_load(sys.stdin.read())))'], { input: blocks[0][1], encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

test('published examples validate and Feed fragment is guarded', () => {
  const raw = yamlUnder('FreshFeed raw example');
  const aqara = yamlUnder('Aqara example');
  const semantic = yamlUnder('FreshFeed semantic example');
  const fragment = yamlUnder('Confirmed Feed fragment');
  for (const example of [raw, aqara, semantic]) validateConfig(example);
  assert.equal(validateConfig(raw).actions.length, 0);
  assert.equal(validateConfig(aqara).actions.length, 0);
  assert.equal(validateConfig(semantic).actions.length, 0);
  const [action] = validateConfig({ ...semantic, ...fragment }).actions;
  assert.equal(action.action, 'petsafe_freshfeed.command');
  assert.deepEqual(action.data, { operation: 'feed' });
  assert.equal(action.confirm, true);
  assert.equal(action.target, undefined);
});

test('reference covers runtime keys and honest semantic controls', () => {
  for (const key of [...ENTITY_KEYS, 'entry_id', 'schedule_entity', 'write_status_entity', 'quick_feed_entity', 'history_entity']) assert.ok(readme.includes(`\`${key}\``), key);
  const fresh = validateConfig({ model: 'freshfeed' });
  const aqara = validateConfig({ model: 'aqara_c1' });
  assert.deepEqual([fresh.mode, fresh.name, fresh.color, fresh.meal_slots, fresh.food_label, fresh.art_level, fresh.chip, fresh.footer], ['standard', 'FreshFeed', 'black', 6, 'Food', 'hopper', 'last_feed', ['last_fed', 'portions_today', 'next_meal']]);
  assert.deepEqual([aqara.name, aqara.color, aqara.meal_slots], ['Aqara C1', 'white', null]);
  assert.equal(validateConfig({model: 'aqara_c1', actions: [{action: 'button.press'}]}).actions[0].confirm, true);
  for (const text of ['not inherently read-only', 'save schedules', 'guarded commands', 'recovery', 'defrost', 'refilled', '1 to 32', '1 to 12', 'at most 3', 'last_feed', 'last_fed', 'portions_today', 'next_meal']) assert.ok(readme.includes(text), text);
});
