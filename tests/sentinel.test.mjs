import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createSentinel } from '../scripts/generate-sentinel.mjs';
import {
  validate,
  exportBBModel,
  importBBModel,
  serialize,
  analyzeQuality,
  renderPNG,
  inspect,
  geometry,
  sampleAnimation,
} from '../packages/core/dist/index.js';

test('authored sentinel stays reproducible with embedded textures, grounded geometry and a connected animation rig', async () => {
  const m = createSentinel();
  assert.deepEqual(validate(m), []);
  assert.equal(serialize(m), serialize(createSentinel()));
  assert.equal(serialize(importBBModel(exportBBModel(m))), serialize(m));
  assert.equal(
    serialize(
      importBBModel(JSON.parse(await readFile('examples/crimson_sentinel.bbmodel', 'utf8'))),
    ),
    serialize(m),
  );
  assert.deepEqual(analyzeQuality(m).issues, []);
  assert.equal(analyzeQuality(m).textureCoverage, 1);
  assert.ok(Math.abs(inspect(m).bounds.min[1]) < 1e-9);
  const groups = new Map(m.groups.map((g) => [g.id, g]));
  const pole = m.cubes.find((c) => c.name === 'shaft');
  let parent = groups.get(pole.parent),
    chain = [];
  while (parent) {
    chain.push(parent.id);
    parent = groups.get(parent.parent);
  }
  assert.ok(chain.some((id) => id.endsWith('right_arm/forearm')));
  for (const a of m.animations) {
    const t = a.id === 'idle' ? 2 : a.id === 'walk' ? 0.25 : 0.65;
    assert.notDeepEqual(
      renderPNG(m, { width: 128, height: 128, animation: a.id, time: 0 }),
      renderPNG(m, { width: 128, height: 128, animation: a.id, time: t }),
    );
    assert.ok(
      geometry(m, sampleAnimation(m, a.id, t)).every((c) =>
        c.vertices.flat().every(Number.isFinite),
      ),
    );
  }
});
