import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
const cli = resolve('packages/cli/dist/index.js');
const run = (args) => spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8' });
test('usable local pipeline with overwrite protection and atomic failure', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'formixel-cli-'));
  const bb = join(dir, 'golem.bbmodel'),
    ir = join(dir, 'golem.json'),
    svg = join(dir, 'golem.svg'),
    patch = join(dir, 'patch.json');
  try {
    assert.equal(run(['build', 'examples/golem.fxl', '-o', bb]).status, 0);
    assert.equal(run(['build', 'examples/golem.fxl', '-o', bb]).status, 1);
    assert.equal(run(['import', bb, '-o', ir]).status, 0);
    assert.equal(run(['validate', ir]).status, 0);
    assert.equal(JSON.parse(run(['inspect', ir]).stdout).cubes, 6);
    assert.equal(run(['render', ir, '-o', svg]).status, 0);
    assert.ok((await readFile(svg, 'utf8')).startsWith('<svg'));
    await writeFile(patch, JSON.stringify([{ op: 'remove', id: 'missing' }]));
    const before = await readFile(ir, 'utf8');
    assert.equal(run(['patch', ir, '--patch', patch, '-o', ir, '--force']).status, 1);
    assert.equal(await readFile(ir, 'utf8'), before);
    assert.equal(
      run(['generate', 'thing', '--provider', 'unknown', '-o', join(dir, 'generated.fxl')]).status,
      1,
    );
    assert.equal(run(['inspect', ir, '--provider', 'codex']).status, 1);
    assert.equal(run(['quality', ir]).status, 0);
    assert.equal(run(['render', ir, '--view', 'front', '-o', join(dir, 'front.png')]).status, 0);
    assert.equal(run(['render', ir, '--view', 'front', '-o', join(dir, 'front.svg')]).status, 1);
    assert.equal(run(['render', ir, '--view', 'unknown', '-o', join(dir, 'bad.png')]).status, 1);
    assert.equal(run(['render', ir, '--cache', dir, '-o', join(dir, 'bad-cache.png')]).status, 1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
