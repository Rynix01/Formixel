import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdtemp, mkdir, rm } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { unzipSync } from 'fflate';
import { PNG } from 'pngjs';
test('release archive runs standalone outside checkout with verified hashes', async () => {
  const { version } = JSON.parse(await readFile('package.json', 'utf8'));
  const archive = unzipSync(await readFile(`dist/release/formixel-${version}.zip`));
  const root = await mkdtemp(join(tmpdir(), 'formixel-release-'));
  try {
    const manifest = JSON.parse(new TextDecoder().decode(archive['checksums.json']));
    assert.equal(manifest.version, version);
    for (const [name, bytes] of Object.entries(archive)) {
      assert.ok(!name.includes('..') && !name.startsWith('/') && !name.includes('\\'));
      if (name !== 'checksums.json')
        assert.equal(createHash('sha256').update(bytes).digest('hex'), manifest.files[name]);
      await mkdir(dirname(join(root, name)), { recursive: true });
      await writeFile(join(root, name), bytes);
    }
    const run = (args) => {
      const r = spawnSync(process.execPath, ['formixel.mjs', ...args], {
        cwd: root,
        encoding: 'utf8',
        timeout: 10000,
      });
      assert.equal(r.status, 0, r.stderr);
      return r.stdout;
    };
    assert.equal(run(['--version']).trim(), version);
    run(['build', 'examples/forest_golem.fxl', '-o', 'golem.bbmodel']);
    assert.equal(
      JSON.parse(await readFile(join(root, 'golem.bbmodel'), 'utf8')).elements.length,
      11,
    );
    run([
      'render',
      'examples/forest_golem.fxl',
      '--animation',
      'idle',
      '--time',
      '0.5',
      '-o',
      'golem.png',
    ]);
    const image = PNG.sync.read(await readFile(join(root, 'golem.png')));
    assert.equal(image.width, 512);
    run(['import', 'golem.bbmodel', '-o', 'golem.bbir.json']);
    run(['validate', 'golem.bbir.json']);
    run(['build', 'examples/ironroot_knight.fxl', '-o', 'knight.bbmodel']);
    assert.equal(
      JSON.parse(await readFile(join(root, 'knight.bbmodel'), 'utf8')).elements.length,
      85,
    );
    assert.deepEqual(JSON.parse(run(['quality', 'knight.bbmodel'])).issues, []);
    run(['render', 'knight.bbmodel', '--view', 'front', '-o', 'knight-front.png']);
    assert.equal(PNG.sync.read(await readFile(join(root, 'knight-front.png'))).width, 512);
    const doctor = JSON.parse(run(['doctor', 'openai']));
    assert.equal(doctor.providers[0].liveTest, false);
    const rpc = spawnSync(process.execPath, ['formixel-mcp.mjs'], {
      cwd: root,
      input: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }) + '\n',
      encoding: 'utf8',
      timeout: 10000,
    });
    assert.equal(rpc.status, 0, rpc.stderr);
    assert.equal(JSON.parse(rpc.stdout).result.tools.length, 3);
  } finally {
    await rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  }
});
