import test from 'node:test';
import assert from 'node:assert/strict';
import { PNG } from 'pngjs';
import { GifReader } from 'omggif';
import { readFile } from 'node:fs/promises';
import {
  PixelAtlas,
  solveTwoBone,
  inverseRotateVector,
  rotate,
  parseFXL,
  renderGIF,
  renderPixels,
  animationBounds,
  geometry,
  bonePoint,
  sampleAnimation,
  validate,
  exportBBModel,
  importBBModel,
  serialize,
} from '../packages/core/dist/index.js';
import { createPaladin } from '../scripts/generate-paladin.mjs';
const near = (a, b, tolerance = 1e-7) =>
  assert.ok(Math.hypot(...a.map((n, i) => n - b[i])) < tolerance, JSON.stringify({ a, b }));

test('two-bone solver reaches 3D targets under independent forward transforms and reports clamping', () => {
  for (const target of [
    [2, -5, -2],
    [-3, -3, 2],
    [0, -6, 0],
    [0, -0.2, 0],
  ]) {
    const root = [1, 3, -1],
      ik = solveTwoBone(root, target, [0, 1, -8], 5, 5);
    const localKnee = rotate([0, -5, 0], [0, 0, 0], ik.upper);
    const localEnd = rotate(rotate([0, -5, 0], [0, 0, 0], ik.lower), [0, 0, 0], ik.upper);
    near(
      root.map((n, i) => n + localKnee[i]),
      ik.joint,
    );
    near(
      root.map((n, i) => n + localKnee[i] + localEnd[i]),
      target,
    );
    assert.equal(ik.clamped, false);
  }
  const outside = solveTwoBone([0, 0, 0], [0, -20, 0], [0, 0, -1], 4, 5);
  assert.equal(outside.clamped, true);
  assert.ok(Math.hypot(...outside.end) < 9);
  const inside = solveTwoBone([0, 0, 0], [0, -0.1, 0], [0, 0, -1], 2, 5);
  assert.equal(inside.clamped, true);
  assert.ok(Math.hypot(...inside.end) > 3);
  const v = [2, 3, 4],
    r = [25, -37, 13];
  near(inverseRotateVector(rotate(v, [0, 0, 0], r), r), v);
  assert.throws(() => solveTwoBone([0, 0], [0, 1, 0], [0, 0, 0], 2, 2));
  assert.throws(() => solveTwoBone([0, 0, 0], [0, 1, 0], [0, 0, 0], 0, 2));
});

test('atlas packing preserves rectangular texels, unique padded regions and transactional paint failures', () => {
  const a = new PixelAtlas(64, 64),
    regions = [];
  for (let i = 0; i < 12; i++)
    regions.push(
      a.allocate('part' + i, i % 2 ? 4 : 18, i % 2 ? 16 : 3, (x, y) => [i * 15, x, y, 255]),
    );
  for (let i = 0; i < regions.length; i++)
    for (let j = 0; j < i; j++) {
      const r = regions[i],
        s = regions[j];
      assert.ok(
        r.x + r.width + 1 <= s.x - 1 ||
          s.x + s.width + 1 <= r.x - 1 ||
          r.y + r.height + 1 <= s.y - 1 ||
          s.y + s.height + 1 <= r.y - 1,
      );
    }
  const decoded = PNG.sync.read(Buffer.from(a.png()));
  for (const [i, r] of regions.entries()) {
    const p = (x, y) => [...decoded.data.slice((y * 64 + x) * 4, (y * 64 + x) * 4 + 4)];
    assert.deepEqual(p(r.x, r.y), [i * 15, 0, 0, 255]);
    assert.deepEqual(p(r.x - 1, r.y - 1), p(r.x, r.y));
    assert.deepEqual(p(r.x + r.width, r.y + r.height), p(r.x + r.width - 1, r.y + r.height - 1));
  }
  const before = a.png();
  assert.throws(() => a.allocate('bad', 2, 2, () => [0, 0, 0, 999]));
  assert.deepEqual(a.png(), before);
  assert.throws(() => a.allocate('part0', 1, 1, () => [0, 0, 0, 255]));
  assert.throws(() => new PixelAtlas(1024, 1024));
  assert.throws(() => new PixelAtlas(2048, 4));
});

test('GIF output independently decodes complete frames, timing and fixed-camera static anchors', () => {
  const m = parseFXL(
    'model motion material green "#00ff00" material red "#ff0000" cube anchor [-2,0,0] [1,1,1] material green group mover { cube moving [0,0,0] [1,1,1] material red } animation walk 1 loop { move "mover" 0 [0,0,0] move "mover" 1 [3,0,0] }',
  );
  const bytes = renderGIF(m, { animation: 'walk', width: 64, height: 64, fps: 3, view: 'front' });
  assert.deepEqual(
    bytes,
    renderGIF(m, { animation: 'walk', width: 64, height: 64, fps: 3, view: 'front' }),
  );
  const gif = new GifReader(Buffer.from(bytes));
  assert.equal(gif.numFrames(), 3);
  assert.equal(gif.width, 64);
  const frames = [],
    anchors = [];
  let duration = 0;
  for (let i = 0; i < 3; i++) {
    const pixels = new Uint8Array(64 * 64 * 4);
    gif.decodeAndBlitFrameRGBA(i, pixels);
    frames.push(pixels);
    anchors.push(
      [...Array(64 * 64).keys()].filter(
        (p) => pixels[p * 4 + 1] > pixels[p * 4] * 2 && pixels[p * 4 + 1] > 30,
      ),
    );
    duration += gif.frameInfo(i).delay;
  }
  assert.equal(duration, 100);
  assert.deepEqual(anchors[0], anchors[2]);
  assert.notDeepEqual(frames[0], frames[2]);
  assert.throws(() => renderGIF(m, { animation: 'walk', width: 513 }), /size/);
  assert.throws(() => renderGIF(m, { animation: 'walk', fps: 0 }), /fps/);
  m.animations[0].length = 100;
  assert.throws(() => renderGIF(m, { animation: 'walk' }), /budget/);
  assert.throws(() => renderPixels(m, { bounds: { min: [0, 0], max: [2, 2, 2] } }), /bounds/);
});

test('paladin numeric rig keeps soles level and grip attached at keys and interpolated times', async () => {
  const { model, rig, evaluate } = createPaladin(),
    groups = new Map(model.groups.map((g) => [g.id, g]));
  assert.deepEqual(validate(model), []);
  assert.equal(serialize(importBBModel(exportBBModel(model))), serialize(model));
  assert.equal(
    serialize(
      importBBModel(JSON.parse(await readFile('examples/crimson_paladin.bbmodel', 'utf8'))),
    ),
    serialize(model),
  );
  const footErrors = [],
    gripErrors = [];
  for (const a of model.animations) {
    if (a.loop)
      for (const track of a.tracks)
        near(track.keyframes[0].value, track.keyframes.at(-1).value, 1e-6);
    const times = Array.from({ length: 25 }, (_, i) => (a.length * i) / 24);
    // Offset by half the 48 fps bake interval: exercise interpolation, not only baked keys.
    times.push(...times.filter((t) => t < a.length).map((t) => t + 1 / 96));
    for (const t of times) {
      const poses = sampleAnimation(model, a.id, t),
        targets = evaluate(t, a.id);
      const hand = groups.get(rig.arms[1].hand),
        weapon = groups.get(rig.weapon);
      const hp = bonePoint(model, hand.id, hand.origin, poses),
        wp = bonePoint(model, weapon.id, weapon.origin, poses);
      gripErrors.push(Math.hypot(...hp.map((n, j) => n - wp[j])));
      assert.equal(targets.handTargets[1].clamped, false);
      for (const [j, l] of rig.legs.entries())
        if (targets.contacts[j].planted) {
          assert.equal(targets.contacts[j].clamped, false);
          const p = bonePoint(model, l.foot, groups.get(l.foot).origin, poses);
          footErrors.push(Math.abs(p[1] - rig.ankleY));
        }
      for (const sole of geometry(model, poses).filter((c) => c.id.endsWith('/sole'))) {
        assert.ok(Math.min(...sole.vertices.map((p) => p[1])) >= -0.005);
        assert.ok(
          Math.max(...sole.vertices.map((p) => p[1])) -
            Math.min(...sole.vertices.map((p) => p[1])) <
            0.451,
        );
      }
    }
  }
  assert.ok(Math.max(...gripErrors) < 0.02, `Maximum grip error: ${Math.max(...gripErrors)}`);
  assert.ok(
    Math.max(...footErrors) < 0.005,
    `Maximum planted ankle error: ${Math.max(...footErrors)}`,
  );
  const bind = geometry(model),
    idle = geometry(model, sampleAnimation(model, 'idle', 0));
  for (let i = 0; i < bind.length; i++)
    for (let j = 0; j < 8; j++) near(bind[i].vertices[j], idle[i].vertices[j], 1e-6);
});

test('paladin faces have non-overlapping explicit UV regions with predictable texel density', () => {
  const { model, layout } = createPaladin();
  assert.equal(layout.length, model.cubes.length * 6);
  for (const c of model.cubes) {
    const uv = c.faces.north.uv;
    assert.ok(Math.abs(uv[2] - uv[0] - (c.to[0] - c.from[0]) * 6) <= 1.01);
    assert.ok(Math.abs(uv[3] - uv[1] - (c.to[1] - c.from[1]) * 6) <= 1.01);
  }
  const regions = new Set(layout.map((r) => JSON.stringify(r.uv)));
  assert.equal(regions.size, layout.length);
  const occupied = new Uint8Array(512 * 512);
  for (const r of layout)
    for (let y = r.y - 1; y <= r.y + r.height; y++)
      for (let x = r.x - 1; x <= r.x + r.width; x++) {
        const i = y * 512 + x;
        assert.equal(occupied[i], 0);
        occupied[i] = 1;
      }
  const bounds = animationBounds(model, 'attack', [0, 0.5, 0.75, 1.5]);
  assert.ok(bounds.max[0] > bounds.min[0]);
});
