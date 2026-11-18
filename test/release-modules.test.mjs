import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('runtime card version matches release package', async () => {
  const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  const source = await readFile(new URL('../card/pet-feeder-card.js', import.meta.url), 'utf8');
  assert.equal(pkg.version, '0.4.0');
  assert.equal(source.match(/const CARD_VERSION = ['"]([^'"]+)['"]/)?.[1], pkg.version);
});

test('0.4.0 sibling modules load with their shipped import graph', async () => {
  const card = await import('../card/pet-feeder-card.js?v=0.4.0');
  const model = await import('../card/freshfeed-model.js?v=0.4.0');
  const editorModel = await import('../card/freshfeed-editor-model.js?v=0.4.0');
  const editor = await import('../card/pet-feeder-card-editor.js?v=0.4.0');
  assert.equal(typeof card.validateConfig, 'function');
  assert.equal(typeof model.scheduleLeadTimeWarning, 'function');
  assert.equal(typeof editorModel.discoverFreshfeedBindings, 'function');
  assert.equal(typeof editor.PetFeederCardEditor, 'function');
});
