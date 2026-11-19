import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
const read = p => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const modules = ['pet-feeder-card.js', 'freshfeed-model.js', 'pet-feeder-card-editor.js', 'freshfeed-editor-model.js'];
test('all shipped sibling imports resolve', () => {
  assert.deepEqual(readdirSync(new URL('../dist/', import.meta.url)).sort(), [...modules].sort());
  for (const name of modules) for (const match of read(`dist/${name}`).matchAll(/['"](\.\/[^'"]+\.js)(?:\?[^'"]*)?['"]/g)) assert.ok(existsSync(new URL(`../dist/${match[1]}`, import.meta.url)));
});
test('README synthetic example validates against shipped card', async () => {
  const blocks = [...read('README.md').matchAll(/```yaml\n([\s\S]*?)```/g)].map(m => m[1]);
  const parsed = spawnSync(process.env.PETSAFE_YAML_PYTHON || 'python3', ['-c', 'import sys,json,yaml; print(json.dumps(list(yaml.safe_load_all(sys.stdin.read()))))'], {input: blocks.join('\n---\n'), encoding: 'utf8'});
  assert.equal(parsed.status, 0, parsed.stderr);
  const examples = JSON.parse(parsed.stdout).filter(x => x && x.freshfeed);
  assert.equal(examples.length, 1);
  const config = examples[0];
  assert.deepEqual(Object.keys(config.freshfeed).sort(), ['entry_id','schedule_entity','write_status_entity','quick_feed_entity','history_entity'].sort());
  assert.ok(Object.keys(config.entities).length); assert.ok(!config.actions);
  config.freshfeed.entry_id = 'synthetic_release_entry_42';
  const {validateConfig} = await import('../dist/pet-feeder-card.js'); validateConfig(config);
});
test('plugin manifest, release metadata, public notice and unfiltered CI', () => {
  assert.deepEqual(JSON.parse(read('hacs.json')), {name: 'Pet Feeder Card', content_in_root: false, filename: 'pet-feeder-card.js', zip_release: false});
  for (const f of modules) assert.ok(existsSync(new URL(`../dist/${f}`, import.meta.url)));
  assert.equal(JSON.parse(read('package.json')).version, '0.4.2');
  const lock = JSON.parse(read('package-lock.json')); assert.equal(lock.version, '0.4.2'); assert.equal(lock.packages[''].version, '0.4.2');
  assert.match(read('README.md'), /0\.4\.2/); assert.doesNotMatch(read('NOTICE'), /[\w.+-]+@[\w.-]+\.[A-Za-z]+/);
  assert.equal(existsSync(new URL('../distribution/', import.meta.url)), false); assert.equal(existsSync(new URL('../custom_components/', import.meta.url)), false);
  assert.ok(read('.github/workflows/validate.yml').startsWith('name: Validate\non:\n  push:\n  pull_request:\n  workflow_dispatch:\n'));
  assert.match(read('test/live-card-config.test.mjs'), /test\/fixtures\/live-card\.json|\.\/fixtures\/live-card\.json/);
});
