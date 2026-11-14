import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { createOutputDirectory } from '../harness/output.mjs';

test('allocates distinct empty output directories without removing existing artifacts', async () => {
  const root = await mkdtemp(path.join(process.cwd(), 'harness-test-'));
  try {
    const out = path.join(root, 'harness', 'out');
    await mkdir(out, { recursive: true });
    await writeFile(path.join(out, 'sentinel.txt'), 'preserve');
    await writeFile(path.join(out, 'old.png'), 'screenshot');
    const first = await createOutputDirectory(root);
    const second = await createOutputDirectory(root);
    assert.notEqual(first, second);
    assert.equal(path.dirname(first), out);
    assert.equal(path.dirname(second), out);
    assert.deepEqual(await readdir(first), []);
    assert.deepEqual(await readdir(second), []);
    assert.equal(await readFile(path.join(out, 'sentinel.txt'), 'utf8'), 'preserve');
    assert.equal(await readFile(path.join(out, 'old.png'), 'utf8'), 'screenshot');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
