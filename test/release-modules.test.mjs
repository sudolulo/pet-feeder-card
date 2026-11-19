import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

test('runtime card version matches release package', async () => {
  const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  const source = await readFile(new URL('../card/pet-feeder-card.js', import.meta.url), 'utf8');
  assert.equal(pkg.version, '0.4.1');
  assert.equal(source.match(/const CARD_VERSION = ['"]([^'"]+)['"]/)?.[1], pkg.version);
});

test('0.4.1 sibling modules load with their shipped import graph', async () => {
  const card = await import('../card/pet-feeder-card.js?v=0.4.1');
  const model = await import('../card/freshfeed-model.js?v=0.4.1');
  const editorModel = await import('../card/freshfeed-editor-model.js?v=0.4.1');
  const editor = await import('../card/pet-feeder-card-editor.js?v=0.4.1');
  assert.equal(typeof card.validateConfig, 'function');
  assert.equal(typeof model.scheduleLeadTimeWarning, 'function');
  assert.equal(typeof editorModel.discoverFreshfeedBindings, 'function');
  assert.equal(typeof editor.PetFeederCardEditor, 'function');
  for (const name of ['pet-feeder-card.js', 'freshfeed-editor-model.js', 'pet-feeder-card-editor.js']) {
    const source = await readFile(new URL(`../card/${name}`, import.meta.url), 'utf8');
    for (const match of source.matchAll(/['"]\.\/[^'"]+\.js\?v=([^'"]+)['"]/g)) assert.equal(match[1], '0.4.1');
  }
});

test('release notes preserve history and describe recovery', async () => {
  const text = await readFile(new URL('../CHANGELOG.md', import.meta.url), 'utf8');
  assert.match(text, /## Integration \[0\.5\.1\] - 2026-11-18/);
  assert.match(text, /## Card \[0\.4\.1\] - 2026-11-18/);
  assert.match(text, /abandonment/i);
  assert.match(text, /0\.5\.0.*strict fallback/i);
  const marker = '## Integration [0.5.0] - 2026-11-18';
  const index = text.indexOf(marker);
  assert.notEqual(index, -1);
  const historical = '# Changelog\n\n' + text.slice(index);
  assert.equal(createHash('sha256').update(historical).digest('hex'),
    '2136bfdf14dbe8731678aff6aba43c054b1557496245b0ca4ad28c34d20fb1f4');
});
