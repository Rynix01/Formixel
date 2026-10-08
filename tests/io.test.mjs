import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { atomicWrite } from '../packages/cli/dist/index.js';
test('atomic output prevents clobber even without a prior existence check', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'formixel-io-'));
  const path = join(dir, 'model.json');
  try {
    await atomicWrite(path, 'original');
    await assert.rejects(atomicWrite(path, 'replacement'), (e) => e.code === 'EEXIST');
    assert.equal(await readFile(path, 'utf8'), 'original');
    assert.deepEqual(await readdir(dir), ['model.json']);
    await atomicWrite(path, 'replacement', true);
    assert.equal(await readFile(path, 'utf8'), 'replacement');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
