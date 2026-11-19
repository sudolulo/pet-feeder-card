import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
const read = p => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
test('ported: card sibling module imports resolve', () => {
  const names = readdirSync(new URL('../dist/', import.meta.url)).filter(n => n.endsWith('.js'));
  assert.ok(names.length);
  for (const name of names) for (const m of read(`dist/${name}`).matchAll(/['"](\.\/[^'"]+\.js)(?:\?[^'"]*)?['"]/g)) assert.ok(existsSync(new URL(`../dist/${m[1]}`, import.meta.url)), `${name}: ${m[1]}`);
});
test('ported: release documentation examples and install closure', async () => {
  assert.doesNotMatch(read('README.md'), /scp /);
  const spec = read('docs/card-spec.md');
  assert.doesNotMatch(spec, /No visual editor\.|One deployable ES module:/);
  for (const phrase of ['0.4.0', 'getConfigElement', 'advisory', 'Estimated', 'aria-modal']) assert.ok(spec.includes(phrase), phrase);
  const blocks = [...read('README.md').matchAll(/```yaml\n([\s\S]*?)```/g)].map(m => m[1]);
  const parsed = spawnSync(process.env.PETSAFE_YAML_PYTHON || 'python3', ['-c', 'import sys,json,yaml; print(json.dumps(list(yaml.safe_load_all(sys.stdin.read()))))'], {input: blocks.join('\n---\n'), encoding:'utf8'});
  assert.equal(parsed.status, 0, parsed.stderr);
  const examples = JSON.parse(parsed.stdout).filter(x => x && x.freshfeed); assert.equal(examples.length, 1);
  const config = examples[0]; assert.deepEqual(Object.keys(config.freshfeed).sort(), ['entry_id','schedule_entity','write_status_entity','quick_feed_entity','history_entity'].sort());
  assert.ok(Object.keys(config.entities).length); assert.ok(!config.actions);
  config.freshfeed.entry_id = 'synthetic_release_entry_42';
  const {validateConfig} = await import('../dist/pet-feeder-card.js'); validateConfig(config);
});
