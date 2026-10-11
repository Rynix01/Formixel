import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createDragon } from '../scripts/generate-dragon.mjs';
import {
  validate,
  analyzeQuality,
  serialize,
  exportBBModel,
  importBBModel,
  sampleAnimation,
  bonePoint,
  geometry,
  LIMITS,
} from '../packages/core/dist/index.js';

const { model, rig, layout, evaluate } = createDragon();
const near = (a, b, tolerance) =>
  assert.ok(
    Math.hypot(...a.map((n, i) => n - b[i])) <= tolerance,
    `${JSON.stringify(a)} differs from ${JSON.stringify(b)}`,
  );

test('dragon native asset reproduces deterministically with complete bounded UVs and six clips', async () => {
  assert.deepEqual(validate(model), []);
  assert.deepEqual(analyzeQuality(model).issues, []);
  assert.equal(serialize(importBBModel(exportBBModel(model))), serialize(model));
  assert.equal(
    serialize(
      importBBModel(JSON.parse(await readFile('examples/obsidian_crimson_dragon.bbmodel', 'utf8'))),
    ),
    serialize(model),
  );
  assert.deepEqual(model.animations.map((a) => a.id).sort(), [
    'bite_lunge',
    'fire_breath',
    'idle',
    'tail_whip',
    'walk',
    'wing_slam',
  ]);
  assert.ok(
    model.animations.reduce(
      (n, a) => n + a.tracks.reduce((v, t) => v + t.keyframes.length, 0),
      0,
    ) <= LIMITS.keyframes,
  );
  for (const animation of model.animations)
    for (const track of animation.tracks)
      near(track.keyframes[0].value, track.keyframes.at(-1).value, 1e-6);
  const occupied = new Uint8Array(512 * 512);
  for (const r of layout)
    for (let y = r.y - 1; y <= r.y + r.height; y++)
      for (let x = r.x - 1; x <= r.x + r.width; x++) {
        assert.equal(occupied[y * 512 + x], 0, 'Unique atlas allocations cannot overlap');
        occupied[y * 512 + x] = 1;
      }
  for (const cube of model.cubes) {
    const physical = [cube.to[0] - cube.from[0], cube.to[1] - cube.from[1]];
    const uv = cube.faces.north.uv;
    const region = layout.find((r) => r.uv.every((n, i) => n === uv[i]));
    const density = ['eye', 'gem'].includes(region.material) ? 6 : 2;
    // Focal gem surfaces also include the tongue; ordinary shared regions preserve physical ratios.
    for (let i = 0; i < 2; i++)
      assert.ok(
        Math.abs(uv[i + 2] - uv[i] - Math.max(2, physical[i] * density)) <= 1.01,
        `Unexpected texel density: ${cube.id}`,
      );
  }
});

test('dragon four-foot rig is reachable and stays above the floor at keys and between keys', () => {
  let maxError = 0,
    minFloor = Infinity;
  for (const animation of model.animations) {
    const keys = [...new Set(animation.tracks.flatMap((t) => t.keyframes.map((k) => k.time)))].sort(
      (a, b) => a - b,
    );
    const times = keys.filter((_, i) => i % 7 === 0);
    times.push(
      ...keys
        .filter((_, i) => i % 7 === 1)
        .map((t, i) => (t + keys[Math.min(i * 7 + 2, keys.length - 1)]) / 2),
    );
    times.push(animation.length);
    for (const time of times) {
      const targets = evaluate(time, animation.id),
        poses = sampleAnimation(model, animation.id, time);
      for (const [i, leg] of rig.legs.entries()) {
        assert.equal(targets.contacts[i].clamped, false, `${animation.id}:${time}:${leg.foot}`);
        const point = bonePoint(model, leg.foot, leg.ankle, poses);
        maxError = Math.max(
          maxError,
          Math.hypot(...point.map((n, j) => n - targets.contacts[i].target[j])),
        );
      }
      for (const sole of geometry(model, poses).filter((c) => c.id.endsWith('/sole'))) {
        const ys = sole.vertices.map((p) => p[1]);
        minFloor = Math.min(minFloor, ...ys);
        assert.ok(Math.max(...ys) - Math.min(...ys) < 0.9, 'Soles must remain level');
      }
    }
  }
  assert.ok(maxError < 0.15, `Maximum interpolated ankle error: ${maxError}`);
  assert.ok(minFloor >= -0.015, `Floor penetration: ${minFloor}`);
});

test('dragon attacks open jaw downward, sweep tail, raise wings and recover geometric fire effects', () => {
  const jawCube = model.cubes.find((c) => c.id.endsWith('/lower_jaw'));
  const marker = [jawCube.origin[0], jawCube.origin[1], jawCube.from[2]];
  const p = sampleAnimation(model, 'bite_lunge', 0.66);
  const jaw = bonePoint(model, rig.jaw, marker, p),
    fixed = bonePoint(model, rig.head, marker, p);
  assert.ok(jaw[1] < fixed[1] - 3, 'Jaw must open downward from the skull');
  const tailGroup = model.groups.find((g) => g.id === rig.tail.at(-1));
  const tail1 = bonePoint(
    model,
    tailGroup.id,
    tailGroup.origin,
    sampleAnimation(model, 'tail_whip', 0.55),
  );
  const tail2 = bonePoint(
    model,
    tailGroup.id,
    tailGroup.origin,
    sampleAnimation(model, 'tail_whip', 0.99),
  );
  assert.ok(Math.hypot(...tail1.map((n, i) => n - tail2[i])) > 25);
  const wing = model.cubes.find((c) => c.id.includes('leading_1') && c.parent === rig.wings[0].fan);
  const rest = bonePoint(model, wing.parent, wing.origin, sampleAnimation(model, 'wing_slam', 0));
  const raised = bonePoint(
    model,
    wing.parent,
    wing.origin,
    sampleAnimation(model, 'wing_slam', 0.27),
  );
  assert.ok(raised[1] > rest[1] + 2);
  const active = sampleAnimation(model, 'fire_breath', 1.2);
  assert.ok(active.get(rig.fire).scale[0] > 1000);
  assert.ok(sampleAnimation(model, 'fire_breath', 2.14).get(rig.smoke).scale[0] > 800);
  for (const group of [rig.fire, rig.smoke, rig.charge])
    near(sampleAnimation(model, 'fire_breath', 2.4).get(group).scale, [1, 1, 1], 1e-7);
});
