import { mkdir, mkdtemp } from 'node:fs/promises';
import path from 'node:path';

export async function createOutputDirectory(root) {
  const parent = path.resolve(root, 'harness', 'out');
  await mkdir(parent, { recursive: true });
  return mkdtemp(path.join(parent, 'parity-'));
}
