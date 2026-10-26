import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { unzipSync } from 'fflate';
import {
  parseFXL,
  renderPixels,
  renderGIF,
  serialize,
  particleModelDigest,
  createEmissionDocument,
  decodePNG,
} from '../packages/core/dist/index.js';

const model = () => {
  const m = parseFXL(
    'model Effects skin s cloth "#809080" "#809080" seed 1 group body { cube box [-1,0,0] [2,2,2] surface s } animation idle 1 loop { rotate body 0 [0,0,0] rotate body 1 [0,0,0] }',
  );
  m.textures[0].pixels = m.textures[0].pixels.map((_, i) => [128, 144, 128, 255][i % 4]);
  return m;
};
const effects = (m, z = -2) => ({
  version: 1,
  modelDigest: particleModelDigest(m),
  recipes: [
    {
      id: 'spark',
      seed: 5,
      shape: 'cone',
      direction: [0, 0, -1],
      spread: 0,
      speed: [0, 0],
      lifetime: [0.5, 0.5],
      acceleration: [0, 0, 0],
      drag: 0,
      size: [
        [0, 0.6],
        [1, 0.6],
      ],
      color: [
        [0, '#ff2000ff'],
        [1, '#ff2000ff'],
      ],
      render: 'voxel',
      blend: 'alpha',
    },
  ],
  events: [
    {
      id: 'burst',
      animation: 'idle',
      time: 0,
      recipe: 'spark',
      duration: 0,
      rate: 0,
      burst: 1,
      attachment: { group: 'body', point: [0, 1, z] },
      space: 'world',
    },
  ],
});
const options = { width: 64, height: 64, view: 'front', animation: 'idle', time: 0.1 };
test('independent particles respect model depth, seek deterministically, and expire without touching model data', () => {
  const m = model(),
    original = serialize(m),
    baseline = renderPixels(m, options);
  const front = renderPixels(m, { ...options, particles: effects(m) });
  const behind = renderPixels(m, { ...options, particles: effects(m, 3) });
  const at = (32 * 64 + 32) * 4;
  assert.deepEqual(Array.from(front.pixels.slice(at, at + 4)), [255, 32, 0, 255]);
  assert.deepEqual(behind.pixels, baseline.pixels);
  assert.deepEqual(
    renderPixels(m, { ...options, time: 0.6, particles: effects(m) }).pixels,
    baseline.pixels,
  );
  assert.deepEqual(renderPixels(m, { ...options, particles: effects(m) }), front);
  assert.equal(serialize(m), original);
  assert.throws(() => renderPixels(m, { particles: effects(m) }), /animation/);
  let work = 0;
  renderPixels(m, {
    ...options,
    particles: effects(m),
    onWork: (n) => {
      work += n;
    },
  });
  assert.ok(work > (64 * 64) / 2);
});
test('emission changes only shading for explicitly masked texels and cutout coverage stays unchanged', () => {
  const m = model(),
    texture = m.textures[0];
  const mask = (strength) =>
    createEmissionDocument(m, [
      {
        texture: texture.id,
        width: texture.width,
        height: texture.height,
        pixels: new Array(texture.width * texture.height).fill(strength),
      },
    ]);
  const baseline = renderPixels(m, options),
    full = renderPixels(m, { ...options, emission: mask(255) });
  assert.deepEqual(renderPixels(m, { ...options, emission: mask(0) }), baseline);
  const at = (32 * 64 + 32) * 4;
  assert.deepEqual(Array.from(full.pixels.slice(at, at + 4)), [128, 144, 128, 255]);
  assert.ok(full.pixels[at] > baseline.pixels[at]);
  for (let i = 3; i < full.pixels.length; i += 4) assert.equal(full.pixels[i], baseline.pixels[i]);
  const changed = structuredClone(m);
  changed.textures[0].pixels[0] ^= 1;
  assert.throws(() => renderPixels(changed, { ...options, emission: mask(255) }), /Stale/);
});
test('additive particles store straight alpha and particle-only previews have finite default framing', () => {
  const m = model();
  m.cubes = [];
  m.textures = [];
  const doc = effects(m, 0);
  doc.recipes[0].blend = 'additive';
  doc.recipes[0].color = [
    [0, '#ff000080'],
    [1, '#ff000080'],
  ];
  doc.recipes[0].size = [
    [0, 2],
    [1, 2],
  ];
  const renderOptions = { ...options, background: '#00000000', particles: doc };
  const image = renderPixels(m, renderOptions),
    at = (32 * 64 + 32) * 4;
  assert.deepEqual(Array.from(image.pixels.slice(at, at + 4)), [255, 0, 0, 128]);
  const original = String.prototype.localeCompare;
  try {
    String.prototype.localeCompare = () => {
      throw new Error('locale-sensitive particle order');
    };
    doc.recipes.push({
      ...structuredClone(doc.recipes[0]),
      id: 'blue',
      color: [
        [0, '#0000ff80'],
        [1, '#0000ff80'],
      ],
      blend: 'alpha',
    });
    doc.events.push({ ...structuredClone(doc.events[0]), id: 'I', recipe: 'blue' });
    assert.ok(renderPixels(m, renderOptions).pixels.some((v, i) => i % 4 === 3 && v > 0));
  } finally {
    String.prototype.localeCompare = original;
  }
});
test('effect PNG/GIF and explicit target archives work through the CLI', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'formixel-effects-'));
  try {
    const m = model(),
      particle = effects(m);
    particle.recipes[0].render = 'sprite';
    const input = join(dir, 'model.bbir.json'),
      sidecar = join(dir, 'particles.json'),
      output = join(dir, 'burst.zip');
    await writeFile(input, serialize(m));
    await writeFile(sidecar, JSON.stringify(particle));
    const cli = (...args) =>
      execFileSync(process.execPath, ['packages/cli/dist/index.js', ...args], { encoding: 'utf8' });
    assert.equal(JSON.parse(cli('effects', input, '--particles', sidecar)).valid, true);
    assert.throws(
      () => cli('effects', input, '--particles', sidecar, '--target', ''),
      /target must not be empty/,
    );
    cli(
      'effects',
      input,
      '--particles',
      sidecar,
      '--target',
      'bedrock',
      '--namespace',
      'formixel',
      '--entity',
      'effects',
      '-o',
      output,
    );
    assert.ok(
      Object.keys(unzipSync(await readFile(output))).some((p) => p.startsWith('particles/')),
    );
    const png = join(dir, 'preview.png');
    cli(
      'render',
      input,
      '--particles',
      sidecar,
      '--animation',
      'idle',
      '--time',
      '.1',
      '--view',
      'front',
      '--size',
      '64',
      '-o',
      png,
    );
    assert.equal(decodePNG(await readFile(png)).width, 64);
    const gif = renderGIF(m, { ...options, particles: particle, fps: 4 });
    assert.equal(Buffer.from(gif).subarray(0, 6).toString(), 'GIF89a');
    assert.deepEqual(renderGIF(m, { ...options, particles: particle, fps: 4 }), gif);
    particle.recipes[0].drag = 1;
    await writeFile(sidecar, JSON.stringify(particle));
    assert.throws(
      () =>
        cli(
          'effects',
          input,
          '--particles',
          sidecar,
          '--target',
          'bedrock',
          '--namespace',
          'formixel',
          '--entity',
          'effects',
          '-o',
          join(dir, 'unsupported.zip'),
        ),
      /unsupported|Unsupported|drag/i,
    );
    await assert.rejects(readFile(join(dir, 'unsupported.zip')), /ENOENT/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
