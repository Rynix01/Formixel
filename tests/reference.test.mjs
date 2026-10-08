import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, access } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { PNG } from 'pngjs';
import { encodePNG, decodePNG } from '../packages/core/dist/index.js';
import {
  normalizeReferencePNG,
  validateGenerationRequest,
  cliArguments,
  PLANNER_INSTRUCTIONS,
  REFERENCE_INSTRUCTIONS,
} from '../packages/providers/dist/index.js';
import { main } from '../packages/cli/dist/index.js';

const image = (r) =>
  encodePNG({ width: 2, height: 1, pixels: Uint8Array.from([r, 20, 30, 255, 40, 50, 60, 255]) });
test('reference input is bounded, decoded and normalized; incompatible providers fail locally', () => {
  const rgb = new PNG({ width: 2, height: 1, colorType: 2 });
  rgb.data.set([120, 20, 30, 255, 40, 50, 60, 255]);
  const bytes = PNG.sync.write(rgb, { colorType: 2 });
  assert.deepEqual(decodePNG(normalizeReferencePNG(bytes)).pixels, decodePNG(image(120)).pixels);
  for (const data of [new Uint8Array(1_000_001), new Uint8Array(12), image(120).slice(0, -1)])
    assert.throws(() => normalizeReferencePNG(data));
  const corrupt = image(120);
  corrupt[40] ^= 1;
  assert.throws(() => normalizeReferencePNG(corrupt), /CRC/);
  for (const name of ['claude-code', 'openai', 'anthropic'])
    assert.throws(
      () =>
        validateGenerationRequest(name, {
          prompt: 'knight',
          model: 'model',
          referencePNG: image(120),
        }),
      /require the Codex/,
    );
  const args = cliArguments('codex', undefined, join(tmpdir(), 'a path', 'reference.png'));
  assert.equal(args[args.indexOf('--image') + 1], join(tmpdir(), 'a path', 'reference.png'));
  assert.equal(args.at(-1), '-');
  assert.ok(args.includes('read-only'));
  assert.throws(() => cliArguments('claude-code', undefined, join(tmpdir(), 'reference.png')));
  assert.throws(() => cliArguments('codex', undefined, '--untrusted-flag'));
});

test('reference cache follows pixel content across paths and changes at the same path, including task run', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'formixel-reference-'));
  const oldLog = console.log,
    logs = [];
  console.log = (v) => logs.push(v);
  const cache = join(dir, 'cache');
  const prompt = 'silver knight with a red plume';
  const hash = (data) => createHash('sha256').update(data).digest('hex');
  const seed = async (bytes, source) => {
    const key = hash(
      JSON.stringify([
        1,
        'codex',
        null,
        PLANNER_INSTRUCTIONS + '\n' + REFERENCE_INSTRUCTIONS,
        prompt,
        hash(normalizeReferencePNG(bytes)),
      ]),
    );
    await writeFile(join(cache, key + '.json'), JSON.stringify({ version: 1, source }));
  };
  const ref = join(dir, 'reference.png'),
    ref2 = join(dir, 'copy.png');
  const args = (out, path = ref) => [
    'generate',
    prompt,
    '--reference',
    path,
    '--cache',
    cache,
    '-o',
    join(dir, out),
  ];
  try {
    await mkdir(cache);
    await seed(image(10), 'model first cube c [0,0,0] [1,2,1]');
    await seed(image(200), 'model second cube c [0,0,0] [2,3,2]');
    await writeFile(ref, image(10));
    await writeFile(ref2, image(10));
    await main(args('a.fxl'));
    await main(args('b.fxl', ref2));
    assert.equal(
      await readFile(join(dir, 'a.fxl'), 'utf8'),
      await readFile(join(dir, 'b.fxl'), 'utf8'),
    );
    await writeFile(ref, image(200));
    await writeFile(
      join(dir, 'task.json'),
      JSON.stringify({ version: 1, provider: 'codex', prompt }),
    );
    await main([
      'run',
      join(dir, 'task.json'),
      '--reference',
      ref,
      '--cache',
      cache,
      '-o',
      join(dir, 'c.fxl'),
    ]);
    assert.match(await readFile(join(dir, 'c.fxl'), 'utf8'), /model second/);
    assert.ok(logs.every((l) => JSON.parse(l).generation.requests === 0));
    await writeFile(ref, 'invalid image');
    await assert.rejects(main(args('invalid.fxl')), /PNG/);
    await assert.rejects(access(join(dir, 'invalid.fxl')));
    await assert.rejects(
      main([...args('unsupported.fxl'), '--provider', 'claude-code']),
      /require the Codex/,
    );
    await assert.rejects(
      main(['render', join(dir, 'a.fxl'), '--reference', ref, '-o', join(dir, 'r.png')]),
      /not valid for render/,
    );
  } finally {
    console.log = oldLog;
    await rm(dir, { recursive: true, force: true });
  }
});
