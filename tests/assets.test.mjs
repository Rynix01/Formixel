import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PNG } from 'pngjs';
import {
  parseFXL,
  exportBBModel,
  importBBModel,
  serialize,
  encodePNG,
  decodePNG,
  renderPNG,
  renderPixels,
  sampleAnimation,
  geometry,
  validate,
  applyPatch,
} from '../packages/core/dist/index.js';
const source = readFileSync('examples/forest_golem.fxl', 'utf8');
test('materials, UVs, symmetry, repetition and bone animation survive native file roundtrip', () => {
  const model = parseFXL(source);
  assert.equal(model.cubes.length, 11);
  assert.equal(model.textures.length, 2);
  assert.equal(model.animations.length, 1);
  assert.equal(serialize(importBBModel(exportBBModel(model))), serialize(model));
  const pose = sampleAnimation(model, 'idle', 0.5);
  assert.deepEqual(pose.get('torso/head').rotation, [0, 0, 0]);
  const at0 = geometry(model, sampleAnimation(model, 'idle', 0)),
    at1 = geometry(model, sampleAnimation(model, 'idle', 1));
  assert.notDeepEqual(
    at0.find((c) => c.id === 'torso/head/skull').vertices,
    at1.find((c) => c.id === 'torso/head/skull').vertices,
  );
});
test('PNG interoperability with independent encoder and CRC/budget rejection', () => {
  const pixels = Uint8Array.from([255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 0, 0, 0, 0]);
  const ours = encodePNG({ width: 2, height: 2, pixels });
  const independent = PNG.sync.read(Buffer.from(ours));
  assert.deepEqual(Array.from(independent.data), Array.from(pixels));
  for (const filterType of [0, 1, 2, 3, 4]) {
    const png = PNG.sync.write({ width: 2, height: 2, data: Buffer.from(pixels) }, { filterType });
    assert.deepEqual(Array.from(decodePNG(png).pixels), Array.from(pixels));
  }
  const corrupt = Uint8Array.from(ours);
  corrupt[40] ^= 1;
  assert.throws(() => decodePNG(corrupt), /CRC/);
  assert.throws(() => decodePNG(ours.slice(0, -3)), /Incomplete/);
});
test('software PNG renderer uses textures, deterministic pixels, depth and animation', () => {
  const m = parseFXL(source);
  const png = renderPNG(m, { width: 128, height: 128, animation: 'idle', time: 0.5 });
  assert.equal(PNG.sync.read(Buffer.from(png)).width, 128);
  assert.deepEqual(png, renderPNG(m, { width: 128, height: 128, animation: 'idle', time: 0.5 }));
  const textured = renderPixels(
    parseFXL('model x pattern p 2 2 "#ff0000" "#00ff00" cube box [0,0,0] [4,4,4] surface p'),
    { width: 64, height: 64 },
  );
  assert.ok(textured.pixels.some((v, i) => i % 4 === 0 && v > 100));
  assert.ok(textured.pixels.some((v, i) => i % 4 === 1 && v > 100));
  const reversed = structuredClone(m);
  reversed.cubes.reverse();
  assert.deepEqual(
    renderPNG(m, { width: 64, height: 64 }),
    renderPNG(reversed, { width: 64, height: 64 }),
  );
  assert.throws(() => renderPNG(m, { width: 10000 }), /size/);
});
test('macro resource guards and animation/texture contracts reject malformed state', () => {
  assert.throws(
    () =>
      parseFXL(
        'model x repeat 1000 offset [1,0,0] { repeat 1000 offset [0,1,0] { cube a [0,0,0] [1,1,1] } }',
      ),
    /budget/,
  );
  assert.throws(() => parseFXL('model x mirror q { cube a [0,0,0] [1,1,1] }'), /macro/);
  const m = parseFXL(source);
  m.animations[0].tracks[0].keyframes[1].time = 0;
  assert.ok(validate(m).some((e) => e.message.includes('increase')));
  const t = parseFXL(source);
  t.textures[0].pixels[0] = 999;
  assert.ok(validate(t).some((e) => e.message.includes('RGBA8')));
});
test('add and replace patches remain transactional and validate full model state', () => {
  const m = parseFXL('model x cube a [0,0,0] [1,1,1]');
  const node = { ...m.cubes[0], id: 'b', name: 'b' };
  const added = applyPatch(m, [{ op: 'add', id: 'b', kind: 'cube', node }]);
  assert.equal(added.cubes.length, 2);
  const replaced = applyPatch(added, [
    { op: 'replace', id: 'b', node: { ...node, to: [2, 2, 2] } },
  ]);
  assert.deepEqual(replaced.cubes.find((c) => c.id === 'b').to, [2, 2, 2]);
  assert.throws(
    () =>
      applyPatch(m, [
        { op: 'add', id: 'b', kind: 'cube', node },
        { op: 'replace', id: 'a', node: { ...m.cubes[0], to: [0, 0, 0] } },
      ]),
    /positive/,
  );
  assert.equal(m.cubes.length, 1);
});
