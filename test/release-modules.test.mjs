import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

test('runtime card version matches release package', async () => {
  const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  const source = await readFile(new URL('../dist/pet-feeder-card.js', import.meta.url), 'utf8');
  assert.equal(pkg.version, '0.4.2');
  assert.equal(source.match(/const CARD_VERSION = ['"]([^'"]+)['"]/)?.[1], pkg.version);
});

test('0.4.2 sibling modules load with their shipped import graph', async () => {
  const card = await import('../dist/pet-feeder-card.js?v=0.4.2');
  const model = await import('../dist/freshfeed-model.js?v=0.4.2');
  const editorModel = await import('../dist/freshfeed-editor-model.js?v=0.4.2');
  const editor = await import('../dist/pet-feeder-card-editor.js?v=0.4.2');
  assert.equal(typeof card.validateConfig, 'function');
  assert.equal(typeof model.scheduleLeadTimeWarning, 'function');
  assert.equal(typeof editorModel.discoverFreshfeedBindings, 'function');
  assert.equal(typeof editor.PetFeederCardEditor, 'function');
  for (const name of ['pet-feeder-card.js', 'freshfeed-editor-model.js', 'pet-feeder-card-editor.js']) {
    const source = await readFile(new URL(`../dist/${name}`, import.meta.url), 'utf8');
    for (const match of source.matchAll(/['"]\.\/[^'"]+\.js\?v=([^'"]+)['"]/g)) assert.equal(match[1], '0.4.2');
  }
});

test('release notes preserve history and describe recovery', async () => {
  const text = await readFile(new URL('../CHANGELOG.md', import.meta.url), 'utf8');
  assert.match(text, /## Card \[0\.4\.1\] - 2026-11-19/);
  assert.match(text, /abandonment/i);
  assert.match(text, /0\.5\.0.*strict fallback/i);
  const marker = '## Card [0.4.0] - 2026-11-18';
  const index = text.indexOf(marker);
  assert.notEqual(index, -1);
  const historical = '# Changelog\n\n' + text.slice(index);
  assert.equal(createHash('sha256').update(historical).digest('hex'),
    'f13f065cbdc31e59938951bb4d5271d24cfac2091355b6f21364915309413bcb');
});
